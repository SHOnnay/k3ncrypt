import type { VoiceRecorder, VoiceRecordingState } from './contracts';
import { BrowserCaptureController } from '../privacy/capture';

/** Browser adapter: it never requests a microphone until requestPermission/startRecording is called. */
export class BrowserVoiceRecorder implements VoiceRecorder {
    private state: VoiceRecordingState = 'idle';
    private stream?: MediaStream;
    private recorder?: MediaRecorder;
    private parts: Blob[] = [];
    private readonly capture = new BrowserCaptureController();

    getRecordingState(): VoiceRecordingState { return this.state; }

    async requestPermission(): Promise<void> {
        if (this.state !== 'idle' && this.state !== 'failed') throw new Error('Voice recorder is busy.');
        this.state = 'requesting_permission';
        try {
            this.stream = await this.capture.request({ audio: true, video: false });
            this.state = 'idle';
        } catch {
            this.state = 'failed';
            throw new Error('Microphone permission was not granted.');
        }
    }

    async startRecording(): Promise<void> {
        if (this.state !== 'idle' || !this.stream) throw new Error('Microphone permission is required before recording.');
        if (!globalThis.MediaRecorder || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) { this.releaseStream(); throw new Error('Supported voice recording is unavailable.'); }
        this.parts = [];
        try {
        this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
        this.recorder.ondataavailable = (event) => { if (event.data.size) this.parts.push(event.data); };
        this.recorder.onerror = () => { this.parts = []; this.releaseStream(); this.state = 'failed'; };
        this.recorder.start();
        this.state = 'recording';
        } catch { this.releaseStream(); this.state = 'failed'; throw new Error('Voice recording unavailable.'); }
    }

    async stopRecording(): Promise<Uint8Array> {
        if (this.state !== 'recording' || !this.recorder) throw new Error('No recording is active.');
        this.state = 'stopping';
        const recorder = this.recorder;
        try {
            await new Promise<void>((resolve, reject) => {
                recorder.addEventListener('stop', () => resolve(), { once: true });
                recorder.addEventListener('error', () => reject(new Error('Voice recording unavailable.')), { once: true });
                recorder.stop();
            });
        } finally { this.releaseStream(); }
        const data = new Uint8Array(await new Blob(this.parts, { type: 'audio/webm;codecs=opus' }).arrayBuffer());
        this.state = 'completed';
        return data;
    }

    async cancelRecording(): Promise<void> {
        if (this.recorder && this.state === 'recording') this.recorder.stop();
        this.parts = [];
        this.releaseStream();
        this.state = 'idle';
    }

    private releaseStream(): void {
        this.capture.release();
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
        this.recorder = undefined;
    }
}
