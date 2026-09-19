import type { AttachmentReference, EncryptedAttachmentChunk } from '../attachments';

export type MediaKind = 'image' | 'video' | 'file' | 'voice';
export interface PreparedMedia {
    kind: MediaKind;
    mimeType: string;
    size: number;
    attachment: AttachmentReference;
    chunks: EncryptedAttachmentChunk[];
    key: Uint8Array;
}

export const MEDIA_LIMITS = Object.freeze({
    image: 20 * 1024 * 1024,
    video: 50 * 1024 * 1024,
    file: 50 * 1024 * 1024,
    voice: 50 * 1024 * 1024,
});

export const allowedMime = (kind: MediaKind, mimeType: string): boolean => {
    if (kind === 'image') return /^image\/(png|jpeg|webp|gif)$/.test(mimeType);
    if (kind === 'video') return /^video\/(webm|mp4|ogg)$/.test(mimeType);
    if (kind === 'voice') return mimeType === 'audio/webm;codecs=opus';
    return mimeType.length > 0 && !mimeType.startsWith('application/x-msdownload');
};
