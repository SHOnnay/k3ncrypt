import type { CreateAttachmentUpload, CreatedAttachmentUpload, EncryptedAttachmentChunk, MediaAttachmentGateway, MediaConversationContext } from '@chat-e2ee/service';

const unavailable = (): Error => new Error('Protected media is temporarily unavailable.');
const base64 = (bytes: Uint8Array): string => { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
const bytes = (value: string): Uint8Array => { const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)); const result = new Uint8Array(decoded.length); for (let index = 0; index < decoded.length; index += 1) result[index] = decoded.charCodeAt(index); return result; };

/** Fetch gateway; authentication headers are supplied by the host session adapter and never persisted here. */
export class HttpAttachmentGateway implements MediaAttachmentGateway {
    private controller = new AbortController();
    constructor(private readonly baseUrl: string, private readonly requestHeaders: () => Promise<Record<string, string>>) {}

    cancel(): void { this.controller.abort(); this.controller = new AbortController(); }

    async createUpload(_context: MediaConversationContext, input: CreateAttachmentUpload): Promise<CreatedAttachmentUpload> {
        const response = await this.request('/api/attachments/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...await this.requestHeaders() }, body: JSON.stringify({ ...input, encryptedMetadata: { nonce: Array.from(input.encryptedMetadata.nonce), ciphertext: Array.from(input.encryptedMetadata.ciphertext) } }) });
        return this.json<CreatedAttachmentUpload>(response);
    }
    async storeChunk(_context: MediaConversationContext, id: string, capability: string, chunk: EncryptedAttachmentChunk): Promise<void> {
        await this.request(`/api/attachments/${encodeURIComponent(id)}/chunk`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-K3ncrypt-Attachment-Capability': capability, 'X-K3ncrypt-Chunk-Index': String(chunk.index), 'X-K3ncrypt-Chunk-Total': String(chunk.total), 'X-K3ncrypt-Chunk-Nonce': base64(chunk.nonce), ...await this.requestHeaders() }, body: chunk.ciphertext });
    }
    async completeUpload(_context: MediaConversationContext, id: string, capability: string): Promise<void> { await this.request(`/api/attachments/${encodeURIComponent(id)}/complete`, { method: 'POST', headers: { 'X-K3ncrypt-Attachment-Capability': capability, ...await this.requestHeaders() } }); }
    async getChunks(_context: MediaConversationContext, id: string, capability: string): Promise<EncryptedAttachmentChunk[]> {
        const response = await this.request(`/api/attachments/${encodeURIComponent(id)}/chunks`, { method: 'GET', headers: { 'X-K3ncrypt-Attachment-Capability': capability, ...await this.requestHeaders() } });
        const values = await this.json<Array<{ attachmentId: string; index: number; total: number; nonce: string; ciphertext: string }>>(response);
        if (!Array.isArray(values)) throw unavailable();
        return values.map((value) => ({ attachmentId: value.attachmentId, index: value.index, total: value.total, nonce: bytes(value.nonce), ciphertext: bytes(value.ciphertext) }));
    }
    async deleteUpload(_context: MediaConversationContext, id: string, capability: string): Promise<void> { await this.request(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-K3ncrypt-Attachment-Capability': capability, ...await this.requestHeaders() } }); }
    private async request(url: string, init: RequestInit): Promise<Response> { try { const response = await fetch(`${this.baseUrl}${url}`, { ...init, signal: this.controller.signal }); if (!response.ok) throw unavailable(); return response; } catch { throw unavailable(); } }
    private async json<T>(response: Response): Promise<T> { try { return await response.json() as T; } catch { throw unavailable(); } }
}
