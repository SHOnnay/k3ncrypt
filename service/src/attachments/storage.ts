import type { AttachmentStorage, AttachmentUpload, EncryptedAttachmentChunk } from './contracts';

export class MemoryAttachmentStorage implements AttachmentStorage {
    private readonly uploads = new Map<string, { upload: AttachmentUpload; chunks: Map<number, EncryptedAttachmentChunk>; finalized: boolean }>();

    async createUpload(upload: AttachmentUpload): Promise<void> {
        if (this.uploads.has(upload.id)) throw new Error('Attachment already exists.');
        this.uploads.set(upload.id, { upload, chunks: new Map(), finalized: false });
    }

    async storeChunk(chunk: EncryptedAttachmentChunk): Promise<void> {
        const record = this.uploads.get(chunk.attachmentId);
        if (!record || record.finalized || chunk.index < 0 || chunk.index >= record.upload.chunkCount || chunk.total !== record.upload.chunkCount) throw new Error('Invalid attachment chunk.');
        if (record.chunks.has(chunk.index)) throw new Error('Duplicate attachment chunk.');
        record.chunks.set(chunk.index, chunk);
    }

    async getChunk(attachmentId: string, index: number): Promise<EncryptedAttachmentChunk | undefined> { return this.uploads.get(attachmentId)?.chunks.get(index); }
    async finalizeUpload(attachmentId: string): Promise<void> {
        const record = this.uploads.get(attachmentId);
        if (!record || record.chunks.size !== record.upload.chunkCount) throw new Error('Attachment is incomplete.');
        record.finalized = true;
    }
    async deleteAttachment(attachmentId: string): Promise<void> { this.uploads.delete(attachmentId); }
    async expireAttachments(now = Date.now()): Promise<number> {
        let removed = 0;
        for (const [id, record] of this.uploads) if (record.upload.expiresAt <= now) { this.uploads.delete(id); removed += 1; }
        return removed;
    }
}
