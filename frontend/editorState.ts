import type { Position } from "./types";
import type { WireOperation } from "./types";
import type { InsertPayload, DeletePayload } from "./types";
import { opIdKey } from "./types";
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

export type UndoableEntry = {
  opId: { site: string; counter: number };
  type: "insert" | "delete";
  position: Position;
  value: string;
};

type LogEntry = { op: WireOperation; deletedValue?: string };

export class EditorState {
  private confirmedState: CrdtEngine;
  private pendingOps: WireOperation[] = [];
  private cursorPosition: Position | null = null;

  /** Append-only operation history (never remove; tombstones in CRDT). */
  private operationLog: LogEntry[] = [];
  /** OpIds that have been undone (inverse was sent). */
  private undoneOps = new Set<string>();
  /** This site's ops in order, with data needed to generate inverse. */
  private siteLocalHistory: UndoableEntry[] = [];
  /** Stack of opIds to redo (replay original op). */
  private redoStack: { site: string; counter: number }[] = [];

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

  /**
   * Record an applied op in history. Call after applyToConfirmed.
   * For our own delete, pass the character that was deleted so undo can reinsert it.
   */
  recordToHistory(op: WireOperation, isFromSelf: boolean, deletedValue?: string): void {
    this.operationLog.push({ op: { ...op, payload: copyPayload(op.payload) }, deletedValue });

    if (!isFromSelf || (op.type !== "insert" && op.type !== "delete")) return;

    if (op.inverseOpId) {
      this.undoneOps.add(opIdKey(op.inverseOpId));
      return;
    }

    if (op.type === "insert") {
      const p = op.payload as InsertPayload;
      if (p && Array.isArray(p.position) && typeof p.value === "string") {
        this.siteLocalHistory.push({
          opId: op.opId,
          type: "insert",
          position: p.position.slice(),
          value: p.value,
        });
      }
    } else {
      const p = op.payload as DeletePayload;
      if (p && Array.isArray(p.position)) {
        this.siteLocalHistory.push({
          opId: op.opId,
          type: "delete",
          position: p.position.slice(),
          value: deletedValue ?? "",
        });
      }
    }
  }

  /** Last operation from this site that is not undone, with data to build inverse. */
  getLastUndoableEntry(siteId: string): UndoableEntry | null {
    for (let i = this.siteLocalHistory.length - 1; i >= 0; i--) {
      const e = this.siteLocalHistory[i];
      if (e.opId.site === siteId && !this.undoneOps.has(opIdKey(e.opId))) return e;
    }
    return null;
  }

  /** Mark an op as undone (inverse sent). Pushes to redo so redo is available immediately. */
  markUndone(opId: { site: string; counter: number }): void {
    this.undoneOps.add(opIdKey(opId));
    this.redoStack.push({ site: opId.site, counter: opId.counter });
  }

  canUndo(siteId: string): boolean {
    return this.getLastUndoableEntry(siteId) !== null;
  }

  getRedoOpId(): { site: string; counter: number } | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
  }

  popRedo(): { site: string; counter: number } | null {
    return this.redoStack.pop() ?? null;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getOpByOpId(opId: { site: string; counter: number }): WireOperation | null {
    const key = opIdKey(opId);
    for (const entry of this.operationLog) {
      if (opIdKey(entry.op.opId) === key) return entry.op;
    }
    return null;
  }

  getDeletedValueForOpId(opId: { site: string; counter: number }): string | undefined {
    const key = opIdKey(opId);
    for (const entry of this.operationLog) {
      if (opIdKey(entry.op.opId) === key) return entry.deletedValue;
    }
    return undefined;
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

function copyPayload(p: unknown): unknown {
  if (p != null && typeof p === "object" && Array.isArray((p as { position?: unknown }).position)) {
    const q = p as { position: number[]; value?: string };
    return { position: q.position.slice(), value: q.value };
  }
  return p;
}
