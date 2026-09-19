import { ATTACHMENT_LIMITS, type AttachmentId, type EncryptedAttachmentChunk } from './contracts';
import type { AttachmentDeliveryRecord, AttachmentDeliveryStore, AttachmentStatus, AttachmentStatusView } from './delivery';

export interface PersistentAttachmentRecord extends AttachmentDeliveryRecord { accessHash: string; }
export interface AttachmentMetadataPersistence {
    find(id: AttachmentId): Promise<PersistentAttachmentRecord | undefined>;
    insert(record: PersistentAttachmentRecord): Promise<void>;
    updateStatus(id: AttachmentId, status: AttachmentStatus): Promise<void>;
    expired(now: number): Promise<PersistentAttachmentRecord[]>;
}
export interface AttachmentChunkPersistence {
    find(id: AttachmentId, index: number): Promise<EncryptedAttachmentChunk | undefined>;
    list(id: AttachmentId): Promise<EncryptedAttachmentChunk[]>;
    insert(chunk: EncryptedAttachmentChunk): Promise<void>;
    delete(id: AttachmentId): Promise<void>;
}
export interface PersistentAttachmentPersistence { metadata: AttachmentMetadataPersistence; chunks: AttachmentChunkPersistence; }

const hash = async (token: string): Promise<string> => { if (!globalThis.crypto?.subtle) throw new Error('Attachment authorization is unavailable.'); const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)); return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''); };
const constantTimeEqual = (left: string, right: string): boolean => { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; };
const invalid = (): Error => new Error('Attachment is unavailable.');
const validMetadata = (record: AttachmentDeliveryRecord): boolean => Boolean(record.id) && record.chunkCount >= 1 && record.chunkCount <= ATTACHMENT_LIMITS.maxChunks && record.size >= 1 && record.size <= ATTACHMENT_LIMITS.maxBytes && record.expiresAt > record.createdAt && record.expiresAt - record.createdAt <= ATTACHMENT_LIMITS.ttlMs && record.encryptedMetadata.nonce.byteLength === 12 && record.encryptedMetadata.ciphertext.byteLength > 16;

/** Durable-store adapter. The repository owns persistence; this class owns security and lifecycle invariants. */
export class PersistentAttachmentDeliveryStore implements AttachmentDeliveryStore {
    constructor(private readonly persistence: PersistentAttachmentPersistence, private readonly now: () => number = Date.now) {}

    async initializeUpload(record: AttachmentDeliveryRecord, accessToken: string): Promise<void> {
        if (!validMetadata(record)) throw new Error('Invalid attachment upload.');
        await this.persistence.metadata.insert({ ...record, status: 'uploading', accessHash: await hash(accessToken) });
    }
    async storeChunk(chunk: EncryptedAttachmentChunk, accessToken: string): Promise<void> {
        const record = await this.authorized(chunk.attachmentId, accessToken);
        if (record.status !== 'uploading' || chunk.index < 0 || chunk.index >= record.chunkCount || chunk.total !== record.chunkCount || chunk.nonce.byteLength !== 12 || chunk.ciphertext.byteLength > ATTACHMENT_LIMITS.maxChunkBytes + 16) throw new Error('Invalid attachment chunk.');
        const existing = await this.persistence.chunks.find(chunk.attachmentId, chunk.index);
        if (existing) { if (!this.sameChunk(existing, chunk)) throw new Error('Conflicting attachment chunk.'); return; }
        try { await this.persistence.chunks.insert({ ...chunk, nonce: new Uint8Array(chunk.nonce), ciphertext: new Uint8Array(chunk.ciphertext) }); } catch { const raced = await this.persistence.chunks.find(chunk.attachmentId, chunk.index); if (!raced || !this.sameChunk(raced, chunk)) throw new Error('Conflicting attachment chunk.'); }
    }
    async completeUpload(id: AttachmentId, accessToken: string): Promise<void> { const record = await this.authorized(id, accessToken); if ((await this.persistence.chunks.list(id)).length !== record.chunkCount) throw new Error('Attachment upload is incomplete.'); await this.persistence.metadata.updateStatus(id, 'complete'); }
    async getChunks(id: AttachmentId, accessToken: string): Promise<EncryptedAttachmentChunk[]> { const record = await this.authorized(id, accessToken); if (record.status !== 'complete') throw invalid(); return (await this.persistence.chunks.list(id)).sort((a, b) => a.index - b.index).map((chunk) => ({ ...chunk, nonce: new Uint8Array(chunk.nonce), ciphertext: new Uint8Array(chunk.ciphertext) })); }
    async getAttachmentStatus(id: AttachmentId, accessToken: string): Promise<AttachmentStatusView> { const record = await this.authorized(id, accessToken); return { id: record.id, encryptedMetadata: record.encryptedMetadata, chunkCount: record.chunkCount, size: record.size, createdAt: record.createdAt, expiresAt: record.expiresAt, status: record.status, receivedChunks: (await this.persistence.chunks.list(id)).length }; }
    async deleteAttachment(id: AttachmentId, accessToken: string): Promise<void> { await this.authorized(id, accessToken); await this.persistence.metadata.updateStatus(id, 'deleted'); await this.persistence.chunks.delete(id); }
    async expireAttachments(now = this.now()): Promise<number> { const records = await this.persistence.metadata.expired(now); await Promise.all(records.map(async (record) => { await this.persistence.metadata.updateStatus(record.id, 'expired'); await this.persistence.chunks.delete(record.id); })); return records.length; }

    private async authorized(id: AttachmentId, accessToken: string): Promise<PersistentAttachmentRecord> { const record = await this.persistence.metadata.find(id); const presented = await hash(accessToken); if (!record || record.status === 'deleted' || record.status === 'expired' || !constantTimeEqual(record.accessHash, presented)) throw invalid(); if (record.expiresAt <= this.now()) { await this.persistence.metadata.updateStatus(id, 'expired'); await this.persistence.chunks.delete(id); throw new Error('Attachment has expired.'); } return record; }
    private sameChunk(left: EncryptedAttachmentChunk, right: EncryptedAttachmentChunk): boolean { return left.total === right.total && left.nonce.length === right.nonce.length && left.nonce.every((value, index) => value === right.nonce[index]) && left.ciphertext.length === right.ciphertext.length && left.ciphertext.every((value, index) => value === right.ciphertext[index]); }
}
