/**
 * Cursor stability test: run with node (or ts-node) to verify.
 * User A types "AB", cursor at 2. User B inserts "X" before A.
 * Expected: visible text "AXB", cursor index 3 (cursor stays after "B").
 */
import { CrdtClient } from "./crdtClient";
import { generateBetween } from "./crdt-engine";
import type { WireOperation } from "./types";
import type { InsertPayload } from "./types";

function runCursorStabilityTest(): void {
  const siteA = "site-a";
  const siteB = "site-b";
  const clientA = new CrdtClient({
    url: "ws://localhost:8080/ws",
    docId: "doc1",
    siteId: siteA,
    siteBias: 0,
    onStateChange: () => {},
  });

  clientA.insertAt(0, "A");
  clientA.insertAt(1, "B");
  clientA.setCursorIndex(2);
  const textBefore = clientA.getVisibleText();
  const cursorBefore = clientA.getCursorIndex();
  if (textBefore !== "AB" || cursorBefore !== 2) {
    throw new Error(`before: expected text "AB" and cursor 2, got "${textBefore}" and ${cursorBefore}`);
  }

  const visible = clientA.getVisibleState();
  const positions = visible.getPositions();
  const posA = positions[0];
  const posB = positions[1];
  const posX = generateBetween(posA, posB, 100);
  const opFromB: WireOperation = {
    type: "insert",
    docId: "doc1",
    siteId: siteB,
    opId: { site: siteB, counter: 1 },
    payload: { position: posX, value: "X" } as InsertPayload,
    timestamp: Date.now(),
  };
  clientA.injectRemoteOp(opFromB);

  const textAfter = clientA.getVisibleText();
  const cursorAfter = clientA.getCursorIndex();
  if (textAfter !== "AXB") {
    throw new Error(`after: expected text "AXB", got "${textAfter}"`);
  }
  if (cursorAfter !== 3) {
    throw new Error(`after: expected cursor index 3 (stable), got ${cursorAfter}`);
  }
  console.log("Cursor stability test passed.");
}

runCursorStabilityTest();
