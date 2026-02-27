import type { WireOperation } from "./types";

const STORAGE_PREFIX = "skepsi:doc:";

function storageKey(docId: string): string {
  return `${STORAGE_PREFIX}${docId}:ops`;
}

export function loadPersistedOps(docId: string): WireOperation[] {
  try {
    const raw = localStorage.getItem(storageKey(docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is WireOperation =>
        o &&
        typeof o === "object" &&
        (o.type === "insert" || o.type === "delete") &&
        o.docId &&
        o.siteId &&
        o.opId &&
        typeof o.timestamp === "number"
    );
  } catch {
    return [];
  }
}

export function persistOps(docId: string, ops: readonly WireOperation[]): void {
  try {
    localStorage.setItem(storageKey(docId), JSON.stringify(ops));
  } catch {
  }
}

function pendingStorageKey(docId: string): string {
  return `${STORAGE_PREFIX}${docId}:pending`;
}

export function loadPendingOps(docId: string): WireOperation[] {
  try {
    const raw = localStorage.getItem(pendingStorageKey(docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is WireOperation =>
        o &&
        typeof o === "object" &&
        (o.type === "insert" || o.type === "delete") &&
        o.docId &&
        o.siteId &&
        o.opId &&
        typeof o.timestamp === "number"
    );
  } catch {
    return [];
  }
}

export function persistPendingOps(docId: string, ops: readonly WireOperation[]): void {
  try {
    localStorage.setItem(pendingStorageKey(docId), JSON.stringify(ops));
  } catch {
  }
}
