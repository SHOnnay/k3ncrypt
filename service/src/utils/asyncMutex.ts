/** Small FIFO mutex used only to serialize mutations for one crypto session. */
export class AsyncMutex {
    private tail: Promise<void> = Promise.resolve();

    public async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        let release!: () => void;
        const queued = new Promise<void>((resolve) => { release = resolve; });
        const previous = this.tail;
        this.tail = previous.then(() => queued);
        await previous;
        try { return await operation(); }
        finally { release(); }
    }
}
