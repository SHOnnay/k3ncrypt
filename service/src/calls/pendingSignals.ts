/** How long a call signal may wait for its receiver; also the clock tolerance for invites replayed from it. */
export const PENDING_CALL_SIGNAL_WINDOW_MS = 30_000;

/**
 * Calls milestone 2: call signals that arrive before the call receiver is installed (just after unlock, or
 * while it is being re-created) are held briefly and replayed in order, instead of being dropped. Bounded in
 * count and age; only already-authenticated input is held, and the receiver re-checks everything on replay.
 */
export class PendingSignals<T> {
    private items: { value: T; at: number }[] = [];
    constructor(private readonly now: () => number = Date.now, private readonly windowMs = PENDING_CALL_SIGNAL_WINDOW_MS, private readonly cap = 32) {}
    hold(value: T): void {
        this.items.push({ value, at: this.now() });
        if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
    }
    get size(): number { return this.items.length; }
    async drain(deliver: (value: T) => Promise<void>): Promise<void> {
        const cutoff = this.now() - this.windowMs;
        const ready = this.items.filter((item) => item.at >= cutoff); this.items = [];
        for (const item of ready) { try { await deliver(item.value); } catch { /* the receiver rejected this one; continue */ } }
    }
    clear(): void { this.items = []; }
}
