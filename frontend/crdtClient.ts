import type { Position } from "./types";
import type { WireOperation } from "./types";
import type { InsertPayload, DeletePayload } from "./types";
import { generateBetween } from "./crdt-engine";
import { EditorState } from "./editorState";
import { CollabNetwork } from "./network";
import type { ConnectionStatus } from "./network";
import { loadPersistedOps } from "./persistence";

export type { ConnectionStatus };

export type CrdtClientConfig = {
  url: string;
  docId: string;
  siteId: string;
  siteBias: number;
  onStateChange?: () => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
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
      onSyncComplete: () => this.config.onStateChange?.(),
      onConnectionStatusChange: config.onConnectionStatusChange,
      onPendingCountChange: () => this.config.onStateChange?.(),
      onJoinRequest: (join) => {
        for (const op of this.network.getOpLog()) {
          this.network.sendSyncOp(join.siteId, op);
        }
        this.network.sendSyncDone(join.siteId);
      },
    });
    this.network.setApplyOp((op, isFromSelf) => this.handleOp(op, isFromSelf));
  }

  connect(): void {
    const persisted = loadPersistedOps(this.config.docId);
    for (const op of persisted) {
      if (op.opId.site === this.config.siteId && op.opId.counter >= this.opCounter) {
        this.opCounter = op.opId.counter + 1;
      }
      this.handleOp(op, false);
      this.network.recordOp(op);
    }
    this.network.connect();
  }

  disconnect(): void {
    this.network.disconnect();
  }

  getConnectionStatus(): ConnectionStatus {
    return this.network.getConnectionStatus();
  }

  getSiteId(): string {
    return this.config.siteId;
  }

  getPendingCount(): number {
    return this.network.getPendingCount();
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
    const positions = visible.getPositions();
    const left = index <= 0 ? [0] : positions[index - 1];
    const right = index >= positions.length ? [65535] : positions[index];
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
    this.state.applyToConfirmed(op);
    this.state.recordToHistory(op, true);
    this.state.pushPending(op);
    this.network.recordOp(op);
    this.network.sendOp(op);
    this.config.onStateChange?.();
  }

  deleteAtPosition(position: Position): void {
    this.deleteRange([position]);
  }

  deleteRange(positions: Position[]): void {
    if (positions.length === 0) return;
    const visible = this.state.getVisibleState();
    const elements = visible.getElements();
    const positionToValue = new Map<string, string>();
    for (const el of elements) {
      if (!el.deleted)
        positionToValue.set(JSON.stringify(el.position), el.value);
    }
    for (const position of positions) {
      const deletedValue = positionToValue.get(JSON.stringify(position)) ?? "";
      const opId = { site: this.config.siteId, counter: this.opCounter++ };
      const op: WireOperation = {
        type: "delete",
        docId: this.config.docId,
        siteId: this.config.siteId,
        opId,
        payload: { position: position.slice() } as DeletePayload,
        timestamp: Date.now(),
      };
      this.state.applyToConfirmed(op);
      this.state.recordToHistory(op, true, deletedValue);
      this.state.pushPending(op);
      this.network.recordOp(op);
      this.network.sendOp(op);
    }
    this.config.onStateChange?.();
  }

  insertRange(startIndex: number, text: string): void {
    if (text.length === 0) return;
    const visible = this.state.getVisibleState();
    const positions = visible.getPositions();
    const runningPositions = positions.slice();
    const rightBound: Position = [65535];
    for (let i = 0; i < text.length; i++) {
      const left = startIndex + i <= 0 ? [0] : runningPositions[startIndex + i - 1];
      const right = startIndex + i >= runningPositions.length ? rightBound : runningPositions[startIndex + i];
      const bias = this.config.siteBias + this.opCounter;
      const position = generateBetween(left, right, bias);
      const opId = { site: this.config.siteId, counter: this.opCounter++ };
      const op: WireOperation = {
        type: "insert",
        docId: this.config.docId,
        siteId: this.config.siteId,
        opId,
        payload: { position: position.slice(), value: text[i] } as InsertPayload,
        timestamp: Date.now(),
      };
      this.state.applyToConfirmed(op);
      this.state.recordToHistory(op, true);
      this.state.pushPending(op);
      this.network.recordOp(op);
      this.network.sendOp(op);
      runningPositions.splice(startIndex + i, 0, position);
    }
    this.config.onStateChange?.();
  }

  undo(): boolean {
    const entry = this.state.getLastUndoableEntry(this.config.siteId);
    if (!entry) return false;
    const inverse = this.buildInverseOp(entry);
    this.state.markUndone(entry.opId);
    
    this.state.applyToConfirmed(inverse);
    this.state.recordToHistory(inverse, true);
    this.state.pushPending(inverse);

    this.network.recordOp(inverse);
    this.network.sendOp(inverse);
    this.config.onStateChange?.();
    return true;
  }

  redo(): boolean {
    const opId = this.state.popRedo();
    if (!opId) return false;
    const op = this.state.getOpByOpId(opId);
    if (!op || (op.type !== "insert" && op.type !== "delete")) return false;
    
    const redoOp = this.buildRedoOp(op);
    let deletedValue: string | undefined;
    if (redoOp.type === "delete") {
      deletedValue = this.state.getDeletedValueForOpId(opId);
    }
    
    this.state.applyToConfirmed(redoOp);
    this.state.recordToHistory(redoOp, true, deletedValue);
    this.state.pushPending(redoOp);

    this.network.recordOp(redoOp);
    this.network.sendOp(redoOp);
    this.config.onStateChange?.();
    return true;
  }

  canUndo(): boolean {
    return this.state.canUndo(this.config.siteId);
  }

  canRedo(): boolean {
    return this.state.canRedo();
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

  private buildInverseOp(entry: { opId: { site: string; counter: number }; type: "insert" | "delete"; position: Position; value: string }): WireOperation {
    const opId = { site: this.config.siteId, counter: this.opCounter++ };
    if (entry.type === "insert") {
      return {
        type: "delete",
        docId: this.config.docId,
        siteId: this.config.siteId,
        opId,
        payload: { position: entry.position.slice() } as DeletePayload,
        timestamp: Date.now(),
        inverseOpId: entry.opId,
      };
    }
    return {
      type: "insert",
      docId: this.config.docId,
      siteId: this.config.siteId,
      opId,
      payload: { position: entry.position.slice(), value: entry.value } as InsertPayload,
      timestamp: Date.now(),
      inverseOpId: entry.opId,
    };
  }

  private buildRedoOp(original: WireOperation): WireOperation {
    const opId = { site: this.config.siteId, counter: this.opCounter++ };
    if (original.type === "insert") {
      const p = original.payload as InsertPayload;
      return {
        type: "insert",
        docId: this.config.docId,
        siteId: this.config.siteId,
        opId,
        payload: { position: (p?.position ?? []).slice(), value: p?.value ?? "" } as InsertPayload,
        timestamp: Date.now(),
      };
    }
    const p = original.payload as DeletePayload;
    return {
      type: "delete",
      docId: this.config.docId,
      siteId: this.config.siteId,
      opId,
      payload: { position: (p?.position ?? []).slice() } as DeletePayload,
      timestamp: Date.now(),
    };
  }

  private handleOp(op: WireOperation, isFromSelf: boolean): void {
    if (isFromSelf) {
      this.state.removePendingByOpId(op.opId.site, op.opId.counter);
      this.state.applyToConfirmed(op);
      return;
    }
    this.state.applyToConfirmed(op);
    this.state.recordToHistory(op, false);
    this.config.onStateChange?.();
  }
}
