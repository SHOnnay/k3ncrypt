import { ATTACHMENT_LIMITS, type AttachmentId, type EncryptedAttachmentChunk, type EncryptedAttachmentMetadata } from './contracts';

export type AttachmentStatus = 'uploading' | 'complete' | 'expired' | 'deleted';
export interface AttachmentDeliveryRecord { id: AttachmentId; encryptedMetadata: EncryptedAttachmentMetadata; chunkCount: number; size: number; createdAt: number; expiresAt: number; status: AttachmentStatus; }
export interface AttachmentStatusView extends AttachmentDeliveryRecord { receivedChunks: number; }
export interface AttachmentMetadataStore {
    initializeUpload(record: AttachmentDeliveryRecord, accessToken: string): Promise<void>;
    getAttachmentStatus(id: AttachmentId, accessToken: string): Promise<AttachmentStatusView>;
    completeUpload(id: AttachmentId, accessToken: string): Promise<void>;
    deleteAttachment(id: AttachmentId, accessToken: string): Promise<void>;
    expireAttachments(now?: number): Promise<number>;
}
export interface CiphertextChunkStore {
    storeChunk(chunk: EncryptedAttachmentChunk, accessToken: string): Promise<void>;
    getChunks(id: AttachmentId, accessToken: string): Promise<EncryptedAttachmentChunk[]>;
}
export type AttachmentDeliveryStore = AttachmentMetadataStore & CiphertextChunkStore;
const hash = async (token: string): Promise<string> => { if (!globalThis.crypto?.subtle) throw new Error('Attachment authorization is unavailable.'); const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)); return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''); };
const constantTimeEqual = (left: string, right: string): boolean => { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; };
type RecordState = { record: AttachmentDeliveryRecord; accessHash: string; chunks: Map<number, EncryptedAttachmentChunk> };

/** Storage-only delivery service; it never decrypts or interprets ciphertext. */
export class MemoryAttachmentDeliveryStore implements AttachmentDeliveryStore {
    private readonly records = new Map<string, RecordState>();
    async initializeUpload(record: AttachmentDeliveryRecord, accessToken: string): Promise<void> { if (!record.id || this.records.has(record.id) || record.chunkCount < 1 || record.chunkCount > ATTACHMENT_LIMITS.maxChunks || record.size < 1 || record.size > ATTACHMENT_LIMITS.maxBytes || record.expiresAt <= record.createdAt || record.expiresAt - record.createdAt > ATTACHMENT_LIMITS.ttlMs) throw new Error('Invalid attachment upload.'); this.records.set(record.id, { record: { ...record, status: 'uploading' }, accessHash: await hash(accessToken), chunks: new Map() }); }
    async storeChunk(chunk: EncryptedAttachmentChunk, accessToken: string): Promise<void> { const state = await this.authorized(chunk.attachmentId, accessToken); if (state.record.status !== 'uploading' || chunk.index < 0 || chunk.index >= state.record.chunkCount || chunk.total !== state.record.chunkCount || chunk.ciphertext.byteLength > ATTACHMENT_LIMITS.maxChunkBytes + 16 || chunk.nonce.byteLength !== 12) throw new Error('Invalid attachment chunk.'); if (state.chunks.has(chunk.index)) { const existing = state.chunks.get(chunk.index)!; if (existing.ciphertext.length !== chunk.ciphertext.length || !existing.ciphertext.every((value, index) => value === chunk.ciphertext[index])) throw new Error('Conflicting attachment chunk.'); return; } state.chunks.set(chunk.index, chunk); }
    async completeUpload(id: AttachmentId, accessToken: string): Promise<void> { const state = await this.authorized(id, accessToken); if (state.chunks.size !== state.record.chunkCount) throw new Error('Attachment upload is incomplete.'); state.record.status = 'complete'; }
    async getChunks(id: AttachmentId, accessToken: string): Promise<EncryptedAttachmentChunk[]> { const state = await this.authorized(id, accessToken); if (state.record.status !== 'complete') throw new Error('Attachment is unavailable.'); return [...state.chunks.values()].sort((a, b) => a.index - b.index).map((chunk) => ({ ...chunk, nonce: new Uint8Array(chunk.nonce), ciphertext: new Uint8Array(chunk.ciphertext) })); }
    async getAttachmentStatus(id: AttachmentId, accessToken: string): Promise<AttachmentStatusView> { const state = await this.authorized(id, accessToken); return { ...state.record, receivedChunks: state.chunks.size }; }
    async deleteAttachment(id: AttachmentId, accessToken: string): Promise<void> { const state = await this.authorized(id, accessToken); state.record.status = 'deleted'; state.chunks.clear(); }
    async expireAttachments(now = Date.now()): Promise<number> { let count = 0; for (const state of this.records.values()) if (state.record.expiresAt <= now && state.record.status !== 'expired') { state.record.status = 'expired'; state.chunks.clear(); count += 1; } return count; }
    private async authorized(id: string, token: string): Promise<RecordState> { const state = this.records.get(id); const presentedHash = await hash(token); if (!state || state.record.status === 'deleted' || state.record.status === 'expired' || !constantTimeEqual(state.accessHash, presentedHash)) throw new Error('Attachment is unavailable.'); if (state.record.expiresAt <= Date.now()) { state.record.status = 'expired'; state.chunks.clear(); throw new Error('Attachment has expired.'); } return state; }
}
