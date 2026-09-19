import type { VoiceRecorder, VoiceRecordingState } from './contracts';

class PermissionRecorder implements VoiceRecorder {
    state: VoiceRecordingState = 'idle';
    requestCount = 0;
    async requestPermission(): Promise<void> { this.requestCount += 1; this.state = 'idle'; }
    async startRecording(): Promise<void> { this.state = 'recording'; }
    async stopRecording(): Promise<Uint8Array> { this.state = 'completed'; return new Uint8Array([1]); }
    async cancelRecording(): Promise<void> { this.state = 'idle'; }
    getRecordingState(): VoiceRecordingState { return this.state; }
}

it('keeps permission explicit and releases recording lifecycle state', async () => {
    const recorder = new PermissionRecorder();
    expect(recorder.requestCount).toBe(0);
    expect(recorder.getRecordingState()).toBe('idle');
    await recorder.requestPermission();
    await recorder.startRecording();
    expect(recorder.getRecordingState()).toBe('recording');
    await recorder.stopRecording();
    expect(recorder.getRecordingState()).toBe('completed');
});
