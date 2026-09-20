export type ReplayClaimResult = 'accepted' | 'duplicate' | 'expired' | 'capacity-exceeded';
export interface ReplayProtectionStore { claim(key: string, expiresAt: number, now?: number): Promise<ReplayClaimResult>; cleanup(now?: number): Promise<void>; }

/** Deployment adapter: atomic conditional claims shared by all instances. */
export interface DurableReplayProtectionAdapter {
  atomicClaim(key: string, expiresAt: number, now: number): Promise<ReplayClaimResult>;
  cleanupExpired(now: number): Promise<void>;
}

/** Production boundary for a durable replay implementation; no database is assumed here. */
export class DurableReplayProtectionStore implements ReplayProtectionStore {
  constructor(private readonly adapter: DurableReplayProtectionAdapter) {}
  claim(key: string, expiresAt: number, now = Date.now()): Promise<ReplayClaimResult> {
    if (!key || !Number.isFinite(expiresAt) || !Number.isFinite(now)) return Promise.resolve('expired');
    return this.adapter.atomicClaim(key, expiresAt, now);
  }
  cleanup(now = Date.now()): Promise<void> { return this.adapter.cleanupExpired(now); }
}

export class MemoryReplayProtectionStore implements ReplayProtectionStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly maxEntries = 4096) {}
  async claim(key: string, expiresAt: number, now = Date.now()): Promise<ReplayClaimResult> { await this.cleanup(now); if (expiresAt <= now) return 'expired'; if (this.entries.has(key)) return 'duplicate'; if (this.entries.size >= this.maxEntries) return 'capacity-exceeded'; this.entries.set(key, expiresAt); return 'accepted'; }
  async cleanup(now = Date.now()): Promise<void> { for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key); }
}
