/**
 * Calls milestone 1: each attachment request needs a fresh device proof (one round trip). During an upload the
 * next proof is fetched while the current chunk is sent. Each proof is still used once; one older than maxAgeMs
 * (proofs live 30 s) is dropped, and a failed prefetch falls back to a fresh request.
 */
export class PrefetchedHeaders<Operation extends string, Headers> {
    private readonly next = new Map<Operation, { at: number; value: Promise<Headers> }>();
    constructor(private readonly fetch: (operation: Operation) => Promise<Headers>, private readonly now: () => number = Date.now, private readonly maxAgeMs = 20_000) {}
    prefetch(operation: Operation): void {
        if (this.next.has(operation)) return;
        const value = this.fetch(operation); value.catch(() => undefined);
        this.next.set(operation, { at: this.now(), value });
    }
    take(operation: Operation): Promise<Headers> {
        const ready = this.next.get(operation); this.next.delete(operation);
        if (!ready || this.now() - ready.at > this.maxAgeMs) return this.fetch(operation);
        return ready.value.catch(() => this.fetch(operation));
    }
    clear(): void { this.next.clear(); }
}
