export interface ReplayProtectionStore { claim(key: string, expiresAt: number, now?: number): Promise<boolean>; cleanup(now?: number): Promise<void>; }
export class MemoryReplayProtectionStore implements ReplayProtectionStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly maxEntries = 4096) {}
  async claim(key: string, expiresAt: number, now = Date.now()): Promise<boolean> { await this.cleanup(now); if (expiresAt <= now || this.entries.has(key) || this.entries.size >= this.maxEntries) return false; this.entries.set(key, expiresAt); return true; }
  async cleanup(now = Date.now()): Promise<void> { for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key); }
}
