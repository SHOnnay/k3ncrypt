import { encryptAttachment, generateAttachmentKey } from '../attachments';
import { allowedMime, MEDIA_LIMITS, type MediaKind, type PreparedMedia } from './contracts';

export const prepareEncryptedMedia = async (kind: MediaKind, bytes: Uint8Array, mimeType: string): Promise<PreparedMedia> => {
    if (!allowedMime(kind, mimeType)) throw new Error('Unsupported media type.');
    const limit = MEDIA_LIMITS[kind];
    if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('Media exceeds the allowed size.');
    const key = generateAttachmentKey();
    const encrypted = await encryptAttachment(bytes, key);
    return { kind, mimeType, size: bytes.byteLength, attachment: encrypted.reference, chunks: encrypted.chunks, key };
};

/** Browser File objects expose no filesystem path here; only bytes and an explicit MIME type are accepted. */
export const prepareEncryptedFile = async (kind: Exclude<MediaKind, 'voice'>, file: { arrayBuffer: () => Promise<ArrayBuffer>; type: string }): Promise<PreparedMedia> => prepareEncryptedMedia(kind, new Uint8Array(await file.arrayBuffer()), file.type);
