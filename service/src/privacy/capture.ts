/** Capture failures are classified without retaining browser-specific device details. */
export type CaptureFailureReason = 'permission-denied' | 'device-unavailable' | 'device-busy' | 'request-dismissed' | 'capture-unavailable' | 'cancelled';
export class BrowserCaptureError extends Error {
    constructor(readonly reason: CaptureFailureReason) {
        super(`Capture unavailable: ${reason}.`);
        this.name = 'BrowserCaptureError';
    }
}

const failureReason = (error: unknown): CaptureFailureReason => {
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'permission-denied';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'device-unavailable';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'device-busy';
    if (name === 'AbortError' || name === 'InvalidStateError') return 'request-dismissed';
    return 'capture-unavailable';
};

/** Sole browser capture boundary. Requests are explicit and scoped to a foreground action. */
export class BrowserCaptureController {
    private generation = 0;
    private readonly streams = new Set<MediaStream>();
    private pending = false;
    private readonly onVisibility = (): void => { if (document.visibilityState === 'hidden') this.release(); };
    public async request(constraints: MediaStreamConstraints): Promise<MediaStream> {
        if (this.pending || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) throw new BrowserCaptureError('capture-unavailable');
        this.pending = true;
        const generation = ++this.generation;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (generation !== this.generation || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
                stream.getTracks().forEach((track) => track.stop());
                throw new BrowserCaptureError('cancelled');
            }
            this.streams.add(stream);
            return stream;
        } catch (error) {
            if (error instanceof BrowserCaptureError) throw error;
            throw new BrowserCaptureError(failureReason(error));
        } finally {
            this.pending = false;
            if (this.streams.size === 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
        }
    }
    public release(): void {
        ++this.generation;
        for (const stream of this.streams) stream.getTracks().forEach((track) => track.stop());
        this.streams.clear();
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    }
}
