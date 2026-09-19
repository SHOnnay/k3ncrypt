import type { MediaKind, PreparedMedia } from './contracts';

const VERSION = 1;
export interface EncryptedMediaMessage {
    version: 1;
    kind: MediaKind;
    mimeType: string;
    size: number;
    durationMs?: number;
    attachmentId: string;
    encryptedMetadata: { nonce: number[]; ciphertext: number[] };
    attachmentKey: number[];
    /** Delivered inside the E2EE message; never exposed as a public URL or server token. */
    attachmentCapability?: string;
}

export const createEncryptedMediaMessage = (media: PreparedMedia, durationMs?: number): EncryptedMediaMessage => ({
    version: VERSION, kind: media.kind, mimeType: media.mimeType, size: media.size, durationMs,
    attachmentId: media.attachment.id,
    encryptedMetadata: { nonce: Array.from(media.attachment.encryptedMetadata.nonce), ciphertext: Array.from(media.attachment.encryptedMetadata.ciphertext) },
    attachmentKey: Array.from(media.key),
});

export const serializeEncryptedMediaMessage = (message: EncryptedMediaMessage): string => `k3ncrypt-media-v1:${JSON.stringify(message)}`;

export const parseEncryptedMediaMessage = (text: string): EncryptedMediaMessage | undefined => {
    if (!text.startsWith('k3ncrypt-media-v1:')) return undefined;
    try {
        const value = JSON.parse(text.slice('k3ncrypt-media-v1:'.length)) as EncryptedMediaMessage;
        if (value.version !== VERSION || !['image', 'video', 'file', 'voice'].includes(value.kind) || !value.attachmentId || !Array.isArray(value.attachmentKey) || value.attachmentKey.length !== 32) throw new Error('invalid');
        if (value.attachmentCapability !== undefined && (typeof value.attachmentCapability !== 'string' || !/^[a-f0-9]{64}$/.test(value.attachmentCapability))) throw new Error('invalid');
        if (!value.encryptedMetadata || !Array.isArray(value.encryptedMetadata.nonce) || !Array.isArray(value.encryptedMetadata.ciphertext)) throw new Error('invalid');
        return value;
    } catch { throw new Error('Protected attachment message is invalid.'); }
};
