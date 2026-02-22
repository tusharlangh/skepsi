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

/**
 * Selective undo test (deterministic, no server).
 * A inserts A, B inserts B, A inserts C, A presses undo.
 * Final text must be AB on the client that has all ops.
 */
function runSelectiveUndoTest(): void {
  const siteA = "site-a";
  const siteB = "site-b";
  const docId = "doc1";
  const clientA = new CrdtClient({
    url: "ws://invalid",
    docId,
    siteId: siteA,
    siteBias: 0,
    onStateChange: () => {},
  });

  clientA.insertAt(0, "A");
  const visible = clientA.getVisibleState();
  const posA = visible.getPositions()[0];
  const right = [65535];

  const posB = generateBetween(posA, right, 100);
  const opB: WireOperation = {
    type: "insert",
    docId,
    siteId: siteB,
    opId: { site: siteB, counter: 0 },
    payload: { position: posB.slice(), value: "B" } as InsertPayload,
    timestamp: Date.now(),
  };
  clientA.injectRemoteOp(opB);
  if (clientA.getVisibleText() !== "AB") throw new Error(`after B: expected "AB", got "${clientA.getVisibleText()}"`);

  clientA.insertBetween(posB, right, "C");
  if (clientA.getVisibleText() !== "ABC") throw new Error(`after C: expected "ABC", got "${clientA.getVisibleText()}"`);

  const ok = clientA.undo();
  if (!ok) throw new Error("undo should succeed");
  const text = clientA.getVisibleText();
  if (text !== "AB") throw new Error(`after undo: expected "AB", got "${text}"`);

  console.log("Selective undo test passed.");
}

// Deterministic test (no server). Run this first.
runSelectiveUndoTest();

// Cursor test requires ws://localhost:8080/ws
// runCursorStabilityTest();
