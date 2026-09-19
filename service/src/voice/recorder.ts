import type { VoiceRecorder, VoiceRecordingState } from './contracts';

/** Browser adapter: it never requests a microphone until requestPermission/startRecording is called. */
export class BrowserVoiceRecorder implements VoiceRecorder {
    private state: VoiceRecordingState = 'idle';
    private stream?: MediaStream;
    private recorder?: MediaRecorder;
    private parts: Blob[] = [];

    getRecordingState(): VoiceRecordingState { return this.state; }

    async requestPermission(): Promise<void> {
        if (this.state !== 'idle' && this.state !== 'failed') throw new Error('Voice recorder is busy.');
        if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('Microphone recording is unavailable.');
        this.state = 'requesting_permission';
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.state = 'idle';
        } catch {
            this.state = 'failed';
            throw new Error('Microphone permission was not granted.');
        }
    }

    async startRecording(): Promise<void> {
        if (this.state !== 'idle' || !this.stream) throw new Error('Microphone permission is required before recording.');
        if (!globalThis.MediaRecorder || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw new Error('Supported voice recording is unavailable.');
        this.parts = [];
        this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
        this.recorder.ondataavailable = (event) => { if (event.data.size) this.parts.push(event.data); };
        this.recorder.start();
        this.state = 'recording';
    }

    async stopRecording(): Promise<Uint8Array> {
        if (this.state !== 'recording' || !this.recorder) throw new Error('No recording is active.');
        this.state = 'stopping';
        const recorder = this.recorder;
        await new Promise<void>((resolve) => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
        this.releaseStream();
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
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
        this.recorder = undefined;
    }
}
