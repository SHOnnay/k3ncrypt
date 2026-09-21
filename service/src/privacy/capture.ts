/** Sole browser capture boundary. A request is scoped to an explicit foreground action. */
export class BrowserCaptureController {
    private generation = 0;
    private stream?: MediaStream;
    private pending = false;
    private readonly onVisibility = (): void => { if (document.visibilityState === 'hidden') this.release(); };
    public async request(constraints: MediaStreamConstraints): Promise<MediaStream> {
        if (this.pending || this.stream || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) throw new Error('Capture unavailable.');
        this.pending = true;
        const generation = ++this.generation;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (generation !== this.generation || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error('Capture cancelled.');
            }
            this.stream = stream;
            return stream;
        } catch { this.release(); throw new Error('Capture unavailable.'); }
        finally { this.pending = false; }
    }
    public release(): void {
        ++this.generation;
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    }
}
