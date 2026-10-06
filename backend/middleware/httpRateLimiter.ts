/** Bounded HTTP bookkeeping. Saturation denies new keys rather than evicting active limits. */
export class HttpRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  private sweptAt = 0;
  constructor(private readonly capacity: number, private readonly refill: number, private readonly maxBuckets = 4096, private readonly idleMs = 300_000, private readonly now: () => number = () => Date.now()) {
    if (capacity < 1 || refill < 0 || maxBuckets < 1 || idleMs < Math.max(1, refill > 0 ? capacity / refill * 1000 : 1)) throw new Error('Invalid HTTP limiter bounds.');
  }
  get bucketCount(): number { return this.buckets.size; }
  consume(key: string): boolean {
    const now = this.now();
    if (now - this.sweptAt >= 1000) {
      for (const [id, bucket] of this.buckets) if (now - bucket.last >= this.idleMs) this.buckets.delete(id);
      this.sweptAt = now;
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) return false;
      bucket = { tokens: this.capacity, last: now }; this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(this.capacity, bucket.tokens + Math.max(0, now - bucket.last) / 1000 * this.refill);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens--; return true;
  }
}
