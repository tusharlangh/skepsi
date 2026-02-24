import type {
  WireOperation,
  JoinMessage,
  SyncOpMessage,
  SyncDoneMessage,
  InboundMessage,
} from "./types";
import { OperationLog } from "./operation-log";
import { ReplayEngine } from "./replay-engine";
import { SyncState } from "./sync-state";
import { persistOps, loadPendingOps, persistPendingOps } from "./persistence";

/** If we don't receive sync_done within this time, assume we're first in the room. */
const SYNC_TIMEOUT_MS = 2000;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export type ConnectionStatus = "offline" | "connecting" | "syncing" | "online";

export type NetworkConfig = {
  url: string;
  docId: string;
  siteId: string;
  knownClock?: number;
  onOp: (op: WireOperation, isFromSelf: boolean) => void;
  onSyncComplete?: () => void;
  onJoinRequest?: (join: JoinMessage) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onPendingCountChange?: (count: number) => void;
};

function parseMessage(raw: string): InboundMessage | null {
  try {
    return JSON.parse(raw) as InboundMessage;
  } catch {
    return null;
  }
}

function isOperation(msg: InboundMessage): msg is WireOperation {
  return "opId" in msg && typeof (msg as WireOperation).opId === "object";
}

export class CollabNetwork {
  private ws: WebSocket | null = null;
  private readonly config: NetworkConfig;
  private readonly log = new OperationLog();
  private readonly syncState = new SyncState();
  private replay: ReplayEngine | null = null;
  private syncTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingOutbound: WireOperation[] = [];
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
  private connectionStatus: ConnectionStatus = "offline";

  constructor(config: NetworkConfig) {
    this.config = config;
  }

  setApplyOp(applyOp: (op: WireOperation, isFromSelf: boolean) => void): void {
    this.replay = new ReplayEngine(this.log, applyOp);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  getPendingCount(): number {
    return this.pendingOutbound.length;
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.config.onConnectionStatusChange?.(status);
    }
  }

  connect(): void {
    this.shouldReconnect = true;
    this.setConnectionStatus("connecting");
    this.pendingOutbound = loadPendingOps(this.config.docId);
    this.ws = new WebSocket(this.config.url);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setConnectionStatus("syncing");
      this.sendJoin();
      this.scheduleSyncTimeout();
    };
    this.ws.onmessage = (event) => this.handleMessage(event.data);
    this.ws.onclose = () => {
      this.clearSyncTimeout();
      this.ws = null;
      this.setConnectionStatus("offline");
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {};
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.setConnectionStatus("offline");
    this.clearReconnectTimer();
    this.clearSyncTimeout();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.clearReconnectTimer();
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    this.reconnectTimerId = setTimeout(() => {
      this.reconnectTimerId = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const op of this.pendingOutbound) {
      this.ws.send(JSON.stringify(op));
    }
    this.pendingOutbound = [];
    persistPendingOps(this.config.docId, []);
    this.config.onPendingCountChange?.(0);
  }

  private scheduleSyncTimeout(): void {
    this.clearSyncTimeout();
    this.syncTimeoutId = setTimeout(() => {
      this.syncTimeoutId = null;
      if (this.syncState.isSyncing()) {
        this.syncState.setLive();
        this.setConnectionStatus("online");
        this.flushPending();
        this.config.onSyncComplete?.();
      }
    }, SYNC_TIMEOUT_MS);
  }

  private clearSyncTimeout(): void {
    if (this.syncTimeoutId !== null) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }
  }

  sendJoin(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: JoinMessage = {
      type: "join",
      docId: this.config.docId,
      siteId: this.config.siteId,
      knownClock: this.config.knownClock ?? 0,
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendOp(op: WireOperation): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(op));
    } else {
      this.pendingOutbound.push(op);
      persistPendingOps(this.config.docId, this.pendingOutbound);
      this.config.onPendingCountChange?.(this.pendingOutbound.length);
    }
  }

  sendSyncOp(targetSiteId: string, op: WireOperation): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: SyncOpMessage = {
      type: "sync_op",
      docId: this.config.docId,
      target: targetSiteId,
      op,
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendSyncDone(targetSiteId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: SyncDoneMessage = {
      type: "sync_done",
      docId: this.config.docId,
      target: targetSiteId,
    };
    this.ws.send(JSON.stringify(msg));
  }

  getOpLog(): readonly WireOperation[] {
    return this.log.getAll();
  }

  recordOp(op: WireOperation): void {
    this.log.append(op);
    this.persistLog();
  }

  private persistLog(): void {
    persistOps(this.config.docId, this.log.getAll());
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== "string") return;
    const raw = data;
    const msg = parseMessage(raw);
    if (!msg || !("type" in msg)) return;

    switch (msg.type) {
      case "join":
        this.config.onJoinRequest?.(msg);
        break;
      case "sync_op":
        this.clearSyncTimeout();
        if (this.syncState.isSyncing()) {
          this.syncState.pushToBuffer(msg);
        } else if (this.replay) {
          this.replay.applyOne(msg.op, false);
          this.persistLog();
        }
        break;
      case "sync_done":
        this.clearSyncTimeout();
        if (this.syncState.isSyncing()) {
          const buffer = this.syncState.drainBuffer();
          const syncOps = buffer
            .filter(
              (m): m is SyncOpMessage =>
                typeof m === "object" &&
                m !== null &&
                (m as SyncOpMessage).type === "sync_op"
            )
            .map((m) => (m as SyncOpMessage).op);
          const liveOps = buffer.filter(
            (m): m is WireOperation =>
              typeof m === "object" &&
              m !== null &&
              isOperation(m as InboundMessage)
          );
          this.replay?.replayInOrder(syncOps);
          for (const op of liveOps) {
            const isFromSelf = op.siteId === this.config.siteId;
            this.replay?.applyOne(op, isFromSelf);
          }
          this.syncState.setLive();
          this.setConnectionStatus("online");
          this.persistLog();
          this.flushPending();
          this.config.onSyncComplete?.();
        }
        break;
      default:
        if (this.syncState.isSyncing() && isOperation(msg)) {
          this.syncState.pushToBuffer(msg);
        } else if (this.syncState.isLive() && this.replay && isOperation(msg)) {
          const isFromSelf = msg.siteId === this.config.siteId;
          this.replay.applyOne(msg, isFromSelf);
          this.persistLog();
        }
        break;
    }
  }
}
