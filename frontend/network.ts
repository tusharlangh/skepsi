import type { WireOperation } from "./types";

function parseMessage(raw: string): WireOperation | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.type === "string" && msg.docId && msg.siteId && msg.opId && typeof msg.timestamp === "number") {
      return msg as WireOperation;
    }
  } catch {
    // ignore
  }
  return null;
}

export type NetworkConfig = {
  url: string;
  docId: string;
  siteId: string;
  knownClock?: number;
  onOp: (op: WireOperation, isFromSelf: boolean) => void;
  onJoinRequest?: (join: { type: "join"; docId: string; siteId: string; knownClock: number }) => void;
};

export class CollabNetwork {
  private ws: WebSocket | null = null;
  private readonly config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
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
    this.ws.send(
      JSON.stringify({
        type: "join",
        docId: this.config.docId,
        siteId: this.config.siteId,
        knownClock: this.config.knownClock ?? 0,
      })
    );
  }

  sendOp(op: WireOperation): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(op));
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== "string") return;
    const msg = parseMessage(data);
    if (!msg) return;
    if (msg.type !== "insert" && msg.type !== "delete") return;
    const isFromSelf = msg.siteId === this.config.siteId;
    this.config.onOp(msg, isFromSelf);
  }
}
