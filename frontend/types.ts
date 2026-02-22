export type Position = number[];

export type OpId = { site: string; counter: number };

export type InsertPayload = { position: number[]; value: string };
export type DeletePayload = { position: number[] };

export type WireOperation = {
  type: "insert" | "delete" | "cursor" | "sync";
  docId: string;
  siteId: string;
  opId: OpId;
  payload: InsertPayload | DeletePayload | unknown;
  timestamp: number;
  /** Set when this op is the inverse of another (undo); links to the op being undone. */
  inverseOpId?: OpId;
};

export function opIdKey(opId: OpId): string {
  return `${opId.site}:${opId.counter}`;
}
