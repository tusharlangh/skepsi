import type { Operation, JoinMessage, SyncOpMessage, SyncDoneMessage, InboundMessage } from "./types";
import { OperationLog } from "./operation-log";
import { ReplayEngine } from "./replay-engine";
import { SyncState } from "./sync-state";

export type NetworkConfig = {
  url: string;
  docId: string;
  siteId: string;
  knownClock?: number;
  onOp?: (op: Operation) => void;
  onSyncComplete?: () => void;
  onJoinRequest?: (join: JoinMessage) => void;
};

function parseMessage(raw: string): InboundMessage | null {
  try {
    return JSON.parse(raw) as InboundMessage;
  } catch {
    return null;
  }
}

export class CollabNetwork {
  private ws: WebSocket | null = null;
  private readonly config: NetworkConfig;
  private readonly log = new OperationLog();
  private readonly syncState = new SyncState();
  private replay: ReplayEngine | null = null;

  constructor(config: NetworkConfig) {
    this.config = config;
  }

  setApplyOp(applyOp: (op: Operation) => void): void {
    this.replay = new ReplayEngine(this.log, applyOp);
  }

  connect(): void {
    this.ws = new WebSocket(this.config.url);
    this.ws.onopen = () => this.sendJoin();
    this.ws.onmessage = (event) => this.handleMessage(event.data);
    this.ws.onclose = () => {};
    this.ws.onerror = () => {};
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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

  sendOp(op: Operation): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(op));
  }

  sendSyncOp(targetSiteId: string, op: Operation): void {
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

  getOpLog(): readonly Operation[] {
    return this.log.getAll();
  }

  private handleMessage(data: string | Blob): void {
    const raw = typeof data === "string" ? data : "";
    if (typeof data === "Blob") return;
    const msg = parseMessage(raw);
    if (!msg || !("type" in msg)) return;
    switch (msg.type) {
      case "join":
        this.config.onJoinRequest?.(msg);
        break;
      case "sync_op":
        if (this.syncState.isSyncing()) {
          this.syncState.pushToBuffer(msg);
        } else if (this.replay) {
          this.replay.applyOne(msg.op);
        }
        break;
      case "sync_done":
        if (this.syncState.isSyncing()) {
          const buffer = this.syncState.drainBuffer();
          const ops = buffer
            .filter((m): m is SyncOpMessage => typeof m === "object" && m !== null && (m as SyncOpMessage).type === "sync_op")
            .map((m) => (m as SyncOpMessage).op);
          this.replay?.replayInOrder(ops);
          this.syncState.setLive();
          this.config.onSyncComplete?.();
        }
        break;
      default:
        if (this.syncState.isLive() && this.replay && this.isOperation(msg)) {
          this.replay.applyOne(msg as Operation);
        }
        break;
    }
  }

  private isOperation(msg: InboundMessage): msg is Operation {
    return "opId" in msg && typeof (msg as Operation).opId === "object";
  }
}
