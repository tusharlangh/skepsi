import type { Operation } from "./types";
import { OperationLog } from "./operation-log";

export type ApplyOpFn = (op: Operation) => void;

export class ReplayEngine {
  constructor(
    private log: OperationLog,
    private applyOp: ApplyOpFn,
  ) {}

  replayInOrder(ops: Operation[]): void {
    for (const op of ops) {
      if (this.log.append(op)) {
        this.applyOp(op);
      }
    }
  }

  applyOne(op: Operation): boolean {
    if (!this.log.append(op)) return false;
    this.applyOp(op);
    return true;
  }
}
