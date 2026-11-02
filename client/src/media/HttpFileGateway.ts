import { fileHttpFailure } from './fileHttpFailure';
import { rateLimitedRequest } from '../../../service/src/api/rateLimitedRequest';
import { unb64, type FileBinding, type FileGateway, type FileStatus, type WireObject } from '@chat-e2ee/service';
type Operation = 'attachment:create' | 'attachment:read' | 'attachment:write' | 'attachment:delete';
export class HttpFileGateway implements FileGateway {
    /** requestTimeoutMs bounds every request (headers, response and body) so a hung server never leaves a transfer 'Sending' forever. */
    constructor(private readonly baseUrl: string, private readonly headers: (operation: Operation) => Promise<Record<string, string>>, private readonly requestTimeoutMs = 60_000) {}
    private async request<T>(path: string, operation: Operation, signal?: AbortSignal, method = 'GET', value?: unknown, object?: WireObject): Promise<T> {
        const makeHeaders = async () => ({ ...await this.headers(operation), 'X-K3ncrypt-File-Version': '2', ...(object ? { 'Content-Type': 'application/octet-stream', 'X-K3ncrypt-File-Nonce': object.nonce } : value ? { 'Content-Type': 'application/json' } : {}) });
        if (signal?.aborted) throw new Error('File canceled.');
        const bounded = new AbortController();
        const relay = () => bounded.abort(); signal?.addEventListener('abort', relay, { once: true });
        const timer = setTimeout(() => bounded.abort(), this.requestTimeoutMs);
        // The device-proof request inside makeHeaders is bounded by the same timer.
        const stopped = new Promise<never>((_resolve, reject) => bounded.signal.addEventListener('abort', () => reject(new Error('Network unavailable.')), { once: true }));
        stopped.catch(() => undefined);
        try {
        let response: Response;
        try { response = await rateLimitedRequest(async () => fetch(`${this.baseUrl}/api/attachments/v2${path}`, { method, headers: await Promise.race([makeHeaders(), stopped]), signal: bounded.signal, body: object ? unb64(object.ciphertext, 256 * 1024 + 16).buffer as ArrayBuffer : value ? JSON.stringify(value) : undefined }), signal); }
        catch { if (signal?.aborted) throw new Error('File canceled.'); throw new Error('Network unavailable.'); }
        if (!response.ok) throw await fileHttpFailure(response);
        // Bound even an unexpected/malicious response; no response.json() on an unbounded body.
        const reader = response.body?.getReader(); if (!reader) throw new Error('File response missing.');
        let length = 0; const decoder = new TextDecoder(); let text = '';
        for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 360000) { await reader.cancel(); throw new Error('File response exceeds limits.'); } text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode(); return JSON.parse(text) as T;
        } catch (error) {
            if (signal?.aborted) throw new Error('File canceled.');
            if (bounded.signal.aborted) throw new Error('Network unavailable.');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
    }
    create(binding: FileBinding, fileSize: number, signal: AbortSignal): Promise<FileStatus> { return this.request('/create', 'attachment:create', signal, 'POST', { version: 2, binding, fileSize }); }
    status(id: string, signal: AbortSignal): Promise<FileStatus> { return this.request(`/${id}`, 'attachment:read', signal); }
    put(id: string, index: 'manifest' | number, object: WireObject, signal: AbortSignal): Promise<FileStatus> { return index === 'manifest' ? this.request(`/${id}/manifest`, 'attachment:write', signal, 'PUT', object) : this.request(`/${id}/chunks/${index}`, 'attachment:write', signal, 'PUT', undefined, object); }
    complete(id: string, signal: AbortSignal): Promise<FileStatus> { return this.request(`/${id}/complete`, 'attachment:write', signal, 'POST'); }
    chunk(id: string, index: number, signal: AbortSignal): Promise<WireObject> { return this.request(`/${id}/chunks/${index}`, 'attachment:read', signal); }
    async cancel(id: string): Promise<void> { await this.request(`/${id}`, 'attachment:delete', undefined, 'DELETE'); }
}
