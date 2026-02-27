import type { WireOperation, InsertPayload } from "./types";
import { generateBetween } from "./crdt-engine";
import { persistOps, persistPendingOps } from "./persistence";

export function createSnapshotForNewDoc(
  text: string,
  newDocId: string,
  siteId: string
): void {
  if (!text) {
    persistOps(newDocId, []);
    persistPendingOps(newDocId, []);
    return;
  }

  const ops: WireOperation[] = [];
  let left: number[] = [0];
  const right: number[] = [65535];

  for (let i = 0; i < text.length; i++) {
    const position = generateBetween(left, right, i);
    const op: WireOperation = {
      type: "insert",
      docId: newDocId,
      siteId,
      opId: { site: siteId, counter: i },
      payload: { position: position.slice(), value: text[i] } as InsertPayload,
      timestamp: Date.now(),
    };
    ops.push(op);
    left = position;
  }

  persistOps(newDocId, ops);
  persistPendingOps(newDocId, []);
}
