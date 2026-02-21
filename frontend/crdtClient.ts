import type { Position } from "./types";
import type { WireOperation } from "./types";
import type { InsertPayload, DeletePayload } from "./types";
import { generateBetween } from "./crdt-engine";
import { EditorState } from "./editorState";
import { CollabNetwork } from "./network";

export type CrdtClientConfig = {
  url: string;
  docId: string;
  siteId: string;
  siteBias: number;
  onStateChange?: () => void;
};

export class CrdtClient {
  private readonly state: EditorState;
  private readonly network: CollabNetwork;
  private readonly config: CrdtClientConfig;
  private opCounter = 0;

  constructor(config: CrdtClientConfig) {
    this.config = config;
    this.state = new EditorState();
    this.network = new CollabNetwork({
      url: config.url,
      docId: config.docId,
      siteId: config.siteId,
      onOp: (op, isFromSelf) => this.handleOp(op, isFromSelf),
      onJoinRequest: undefined,
    });
  }

  connect(): void {
    this.network.connect();
  }

  disconnect(): void {
    this.network.disconnect();
  }

  getVisibleText(): string {
    return this.state.getVisibleText();
  }

  getCursorIndex(): number {
    return this.state.getCursorIndex();
  }

  setCursorIndex(index: number): void {
    const visible = this.state.getVisibleState();
    const pos = visible.indexToPosition(index);
    this.state.setCursorPosition(pos);
  }

  insertAt(index: number, value: string): void {
    const visible = this.state.getVisibleState();
    const left = index <= 0 ? [0] : visible.indexToPosition(index - 1);
    const right = index >= visible.getText().length ? [65535] : visible.indexToPosition(index);
    this.insertBetween(left, right, value);
  }

  insertBetween(left: Position, right: Position, value: string): void {
    const bias = this.config.siteBias + this.opCounter;
    const position = generateBetween(left, right, bias);
    const opId = { site: this.config.siteId, counter: this.opCounter++ };
    const op: WireOperation = {
      type: "insert",
      docId: this.config.docId,
      siteId: this.config.siteId,
      opId,
      payload: { position: position.slice(), value } as InsertPayload,
      timestamp: Date.now(),
    };
    this.state.pushPending(op);
    this.network.sendOp(op);
    this.config.onStateChange?.();
  }

  deleteAtPosition(position: Position): void {
    const opId = { site: this.config.siteId, counter: this.opCounter++ };
    const op: WireOperation = {
      type: "delete",
      docId: this.config.docId,
      siteId: this.config.siteId,
      opId,
      payload: { position: position.slice() } as DeletePayload,
      timestamp: Date.now(),
    };
    this.state.pushPending(op);
    this.network.sendOp(op);
    this.config.onStateChange?.();
  }

  getVisibleState(): ReturnType<EditorState["getVisibleState"]> {
    return this.state.getVisibleState();
  }

  getPositionAtIndex(index: number): Position {
    return this.state.getVisibleState().indexToPosition(index);
  }

  injectRemoteOp(op: WireOperation): void {
    this.handleOp(op, false);
  }

  private handleOp(op: WireOperation, isFromSelf: boolean): void {
    if (isFromSelf) {
      this.state.applyToConfirmed(op);
      this.state.removePendingByOpId(op.opId.site, op.opId.counter);
    } else {
      this.state.applyToConfirmed(op);
    }
    this.config.onStateChange?.();
  }
}
