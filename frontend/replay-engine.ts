import type { WireOperation } from "./types";
import { OperationLog } from "./operation-log";

export type ApplyOpFn = (op: WireOperation, isFromSelf: boolean) => void;

export class ReplayEngine {
  constructor(
    private log: OperationLog,
    private applyOp: ApplyOpFn,
  ) {}

  replayInOrder(ops: WireOperation[]): void {
    for (const op of ops) {
      if (this.log.append(op)) {
        this.applyOp(op, false);
      }
    }
  }

  applyOne(op: WireOperation, isFromSelf: boolean): boolean {
    if (!this.log.append(op)) return false;
    this.applyOp(op, isFromSelf);
    return true;
  }
}
