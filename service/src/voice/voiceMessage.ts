import { encryptAttachment, generateAttachmentKey } from '../attachments';
import type { VoiceMessageReference } from './contracts';

export const createEncryptedVoiceMessage = async (audio: Uint8Array, durationMs: number): Promise<{ message: VoiceMessageReference; key: Uint8Array }> => {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 60 * 60 * 1000) throw new Error('Invalid voice duration.');
    if (!audio.byteLength) throw new Error('Voice recording is empty.');
    const key = generateAttachmentKey();
    const encrypted = await encryptAttachment(audio, key);
    return { message: { attachment: encrypted.reference, chunks: encrypted.chunks, durationMs: Math.floor(durationMs), mimeType: 'audio/webm;codecs=opus' }, key };
};
