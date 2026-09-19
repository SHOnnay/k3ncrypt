import type { AttachmentDeliveryRecord, AttachmentDeliveryStore } from './delivery';
import { ATTACHMENT_LIMITS, type AttachmentId, type EncryptedAttachmentChunk, type EncryptedAttachmentMetadata } from './contracts';

export interface AttachmentConversationContext { conversationId: string; participantId: string; }
export interface CreateAttachmentUpload { size: number; chunkCount: number; encryptedMetadata: EncryptedAttachmentMetadata; expiresAt: number; }
export interface CreatedAttachmentUpload { id: AttachmentId; capability: string; expiresAt: number; }

const randomCapability = (): string => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Attachment authorization is unavailable.');
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

/** Authenticated service boundary; callers must supply an existing conversation context. */
export class AttachmentService {
    constructor(private readonly store: AttachmentDeliveryStore) {}

    async createUpload(context: AttachmentConversationContext, input: CreateAttachmentUpload): Promise<CreatedAttachmentUpload> {
        this.validateContext(context);
        if (input.size < 1 || input.size > ATTACHMENT_LIMITS.maxBytes || input.chunkCount < 1 || input.chunkCount > ATTACHMENT_LIMITS.maxChunks || input.expiresAt <= Date.now() || input.expiresAt - Date.now() > ATTACHMENT_LIMITS.ttlMs) throw new Error('Invalid attachment upload.');
        const id = globalThis.crypto.randomUUID();
        const capability = randomCapability();
        const record: AttachmentDeliveryRecord = { id, encryptedMetadata: input.encryptedMetadata, chunkCount: input.chunkCount, size: input.size, createdAt: Date.now(), expiresAt: input.expiresAt, status: 'uploading' };
        await this.store.initializeUpload(record, `${context.conversationId}:${context.participantId}:${capability}`);
        return { id, capability, expiresAt: input.expiresAt };
    }

    async storeChunk(context: AttachmentConversationContext, id: AttachmentId, capability: string, chunk: EncryptedAttachmentChunk): Promise<void> { this.validateContext(context); if (chunk.attachmentId !== id) throw new Error('Attachment is unavailable.'); await this.store.storeChunk(chunk, this.credential(context, capability)); }
    async completeUpload(context: AttachmentConversationContext, id: AttachmentId, capability: string): Promise<void> { this.validateContext(context); await this.store.completeUpload(id, this.credential(context, capability)); }
    async getChunks(context: AttachmentConversationContext, id: AttachmentId, capability: string): Promise<EncryptedAttachmentChunk[]> { this.validateContext(context); return this.store.getChunks(id, this.credential(context, capability)); }
    async deleteAttachment(context: AttachmentConversationContext, id: AttachmentId, capability: string): Promise<void> { this.validateContext(context); await this.store.deleteAttachment(id, this.credential(context, capability)); }
    async expireAttachments(now?: number): Promise<number> { return this.store.expireAttachments(now); }

    private credential(context: AttachmentConversationContext, capability: string): string { if (!/^[a-f0-9]{64}$/.test(capability)) throw new Error('Attachment is unavailable.'); return `${context.conversationId}:${context.participantId}:${capability}`; }
    private validateContext(context: AttachmentConversationContext): void { if (!context?.conversationId || !context.participantId) throw new Error('Attachment authorization is unavailable.'); }
}
