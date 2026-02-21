import type { Position } from "./types";
import type { WireOperation } from "./types";
import type { InsertPayload, DeletePayload } from "./types";
import { CrdtEngine } from "./crdt-engine";

function applyOpToEngine(engine: CrdtEngine, op: WireOperation): void {
  if (op.type === "insert") {
    const p = op.payload as InsertPayload;
    if (p && Array.isArray(p.position) && typeof p.value === "string") {
      engine.applyRemote(p.position, p.value, false);
    }
  } else if (op.type === "delete") {
    const p = op.payload as DeletePayload;
    if (p && Array.isArray(p.position)) {
      const elements = engine.getElements();
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el.deleted && el.position.length === p.position.length && el.position.every((v, j) => v === p.position[j])) {
          engine.applyRemote(p.position, el.value, true);
          return;
        }
      }
      engine.delete(p.position);
    }
  }
}

export class EditorState {
  private confirmedState: CrdtEngine;
  private pendingOps: WireOperation[] = [];
  private cursorPosition: Position | null = null;

  constructor(initial?: CrdtEngine) {
    this.confirmedState = initial ? initial.clone() : new CrdtEngine();
  }

  getConfirmedState(): CrdtEngine {
    return this.confirmedState;
  }

  getPendingOps(): readonly WireOperation[] {
    return this.pendingOps;
  }

  getVisibleState(): CrdtEngine {
    const visible = this.confirmedState.clone();
    for (const op of this.pendingOps) {
      applyOpToEngine(visible, op);
    }
    return visible;
  }

  getVisibleText(): string {
    return this.getVisibleState().getText();
  }

  applyToConfirmed(op: WireOperation): void {
    applyOpToEngine(this.confirmedState, op);
  }

  pushPending(op: WireOperation): void {
    this.pendingOps.push(op);
  }

  removePendingByOpId(site: string, counter: number): void {
    this.pendingOps = this.pendingOps.filter((o) => !(o.opId.site === site && o.opId.counter === counter));
  }

  setCursorPosition(pos: Position | null): void {
    this.cursorPosition = pos === null ? null : pos.slice();
  }

  getCursorPosition(): Position | null {
    return this.cursorPosition === null ? null : this.cursorPosition.slice();
  }

  getCursorIndex(): number {
    const visible = this.getVisibleState();
    if (this.cursorPosition === null) return 0;
    return visible.positionToIndex(this.cursorPosition);
  }
}
