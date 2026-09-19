import type { AttachmentReference, EncryptedAttachmentChunk } from '../attachments';

export type VoiceRecordingState = 'idle' | 'requesting_permission' | 'recording' | 'stopping' | 'completed' | 'failed';

export interface VoiceRecorder {
    requestPermission(): Promise<void>;
    startRecording(): Promise<void>;
    stopRecording(): Promise<Uint8Array>;
    cancelRecording(): Promise<void>;
    getRecordingState(): VoiceRecordingState;
}

export interface VoiceMessageReference {
    attachment: AttachmentReference;
    chunks: EncryptedAttachmentChunk[];
    durationMs: number;
    mimeType: 'audio/webm;codecs=opus';
}
