import type { Operation, OpId } from "./types";
import { opIdKey } from "./types";
import type { OperationLog } from "./operation-log";

export type UndoableEntry = {
  opId: OpId;
  type: "insert" | "delete";
  position: number[];
  value: string;
};

export class HistoryManager {
  private log: OperationLog;
  private deletedValues = new Map<string, string>();
  private undoneOps = new Set<string>();
  private siteLocalHistory: UndoableEntry[] = [];
  private redoStack: OpId[] = [];

  constructor(log: OperationLog) {
    this.log = log;
  }

  record(op: Operation, isFromSelf: boolean, deletedValue?: string): void {
    if (deletedValue !== undefined) this.deletedValues.set(opIdKey(op.opId), deletedValue);

    if (!isFromSelf || (op.type !== "insert" && op.type !== "delete")) return;

    if (op.inverseOpId) {
      this.undoneOps.add(opIdKey(op.inverseOpId));
      return;
    }

    const pos = (op.payload as { position?: number[] })?.position;
    if (!Array.isArray(pos)) return;

    if (op.type === "insert") {
      const value = (op.payload as { value?: string })?.value ?? "";
      this.siteLocalHistory.push({
        opId: op.opId,
        type: "insert",
        position: pos.slice(),
        value,
      });
    } else {
      this.siteLocalHistory.push({
        opId: op.opId,
        type: "delete",
        position: pos.slice(),
        value: deletedValue ?? "",
      });
    }
  }

  getLastUndoableEntry(siteId: string): UndoableEntry | null {
    for (let i = this.siteLocalHistory.length - 1; i >= 0; i--) {
      const e = this.siteLocalHistory[i];
      if (e.opId.site === siteId && !this.undoneOps.has(opIdKey(e.opId))) return e;
    }
    return null;
  }

  markUndone(opId: OpId): void {
    this.undoneOps.add(opIdKey(opId));
    this.redoStack.push({ site: opId.site, counter: opId.counter });
  }

  canUndo(siteId: string): boolean {
    return this.getLastUndoableEntry(siteId) !== null;
  }

  getRedoOpId(): OpId | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
  }

  popRedo(): OpId | null {
    return this.redoStack.pop() ?? null;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getOpByOpId(opId: OpId): Operation | null {
    const key = opIdKey(opId);
    for (const op of this.log.getAll()) {
      if (opIdKey(op.opId) === key) return op;
    }
    return null;
  }

  getDeletedValueForOpId(opId: OpId): string | undefined {
    return this.deletedValues.get(opIdKey(opId));
  }
}
