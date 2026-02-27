export type OpId = { site: string; counter: number };

export type Operation = {
  type: "insert" | "delete" | "cursor" | "sync";
  docId: string;
  siteId: string;
  opId: OpId;
  payload: unknown;
  timestamp: number;
  inverseOpId?: OpId;
};

export type JoinMessage = {
  type: "join";
  docId: string;
  siteId: string;
  knownClock: number;
};

export type SyncOpMessage = {
  type: "sync_op";
  docId: string;
  target: string;
  op: Operation;
};

export type SyncDoneMessage = {
  type: "sync_done";
  docId: string;
  target: string;
};

export type InboundMessage =
  | Operation
  | JoinMessage
  | SyncOpMessage
  | SyncDoneMessage;

export function opIdKey(opId: OpId): string {
  return `${opId.site}:${opId.counter}`;
}
