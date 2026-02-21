export type SyncMode = "live" | "syncing";

export class SyncState {
  private mode: SyncMode = "syncing";
  private syncBuffer: unknown[] = [];

  isLive(): boolean {
    return this.mode === "live";
  }

  isSyncing(): boolean {
    return this.mode === "syncing";
  }

  pushToBuffer(msg: unknown): void {
    this.syncBuffer.push(msg);
  }

  drainBuffer(): unknown[] {
    const out = this.syncBuffer;
    this.syncBuffer = [];
    return out;
  }

  setLive(): void {
    this.mode = "live";
  }

  setSyncing(): void {
    this.mode = "syncing";
  }

  bufferLength(): number {
    return this.syncBuffer.length;
  }
}
