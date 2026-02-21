import type { Operation } from "./types";
import { opIdKey } from "./types";

export class OperationLog {
  private ops: Operation[] = [];
  private appliedKeys = new Set<string>();

  append(op: Operation): boolean {
    const key = opIdKey(op.opId);
    if (this.appliedKeys.has(key)) return false;
    this.appliedKeys.add(key);
    this.ops.push(op);
    return true;
  }

  has(opId: { site: string; counter: number }): boolean {
    return this.appliedKeys.has(opIdKey(opId));
  }

  getAll(): readonly Operation[] {
    return this.ops;
  }

  length(): number {
    return this.ops.length;
  }

  clear(): void {
    this.ops = [];
    this.appliedKeys.clear();
  }
}
