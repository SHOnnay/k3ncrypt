export const ATTACHMENT_LIMITS = Object.freeze({
    maxBytes: 50 * 1024 * 1024,
    maxChunkBytes: 256 * 1024,
    maxChunks: 256,
    ttlMs: 7 * 24 * 60 * 60 * 1000,
});

export type AttachmentId = string;

export interface EncryptedAttachmentChunk {
    attachmentId: AttachmentId;
    index: number;
    total: number;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
}

export interface EncryptedAttachmentMetadata {
    nonce: Uint8Array;
    ciphertext: Uint8Array;
}

export interface AttachmentReference {
    id: AttachmentId;
    size: number;
    chunkCount: number;
    createdAt: number;
    expiresAt: number;
    encryptedMetadata: EncryptedAttachmentMetadata;
}

export type AttachmentUpload = AttachmentReference;

export interface AttachmentStorage {
    createUpload(upload: AttachmentUpload): Promise<void>;
    storeChunk(chunk: EncryptedAttachmentChunk): Promise<void>;
    getChunk(attachmentId: AttachmentId, index: number): Promise<EncryptedAttachmentChunk | undefined>;
    finalizeUpload(attachmentId: AttachmentId): Promise<void>;
    deleteAttachment(attachmentId: AttachmentId): Promise<void>;
    expireAttachments(now?: number): Promise<number>;
}
