/**
 * Tracks the highest sequence number seen per context key and rejects
 * non-increasing values, providing replay/duplicate protection for
 * decrypted envelope payloads (each payload carries a monotonically
 * increasing `seq` chosen by its sender).
 *
 * A context is any string the caller chooses to scope sequence tracking by
 * (e.g. a call id for signaling, or a fixed key such as `'chat'` for chat
 * messages within the active room).
 */
type ReplayWindow = { highest: number; seen: Set<number> };

export class ReplayGuard {
    private readonly windows = new Map<string, ReplayWindow>();

    constructor(private readonly windowSize = 1024) {
        if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
            throw new Error('Replay window size must be a positive safe integer.');
        }
    }

    /**
     * Returns `true` (and records the sequence number) if `seq` is greater
     * than the last one accepted for `context`; returns `false` for a
     * replayed or duplicate/out-of-order message without mutating state.
     */
    public accept(context: string, seq: number): boolean {
        if (!Number.isSafeInteger(seq) || seq < 1) {
            return false;
        }

        const window = this.windows.get(context);
        if (!window) {
            this.windows.set(context, { highest: seq, seen: new Set([seq]) });
            return true;
        }
        if (window.seen.has(seq) || seq <= window.highest - this.windowSize) {
            return false;
        }

        window.seen.add(seq);
        window.highest = Math.max(window.highest, seq);
        const minimum = window.highest - this.windowSize + 1;
        for (const seen of window.seen) {
            if (seen < minimum) {
                window.seen.delete(seen);
            }
        }
        return true;
    }

    public reset(context: string): void {
        this.windows.delete(context);
    }

    public clear(): void {
        this.windows.clear();
    }
}
