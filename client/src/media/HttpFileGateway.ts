import { fileHttpFailure } from './fileHttpFailure';
import { rateLimitedRequest } from '../../../service/src/api/rateLimitedRequest';
import { unb64, type FileBinding, type FileGateway, type FileStatus, type WireObject } from '@chat-e2ee/service';
/**
 * Part A2: fetch() reports no upload progress, so a chunk upload uses XMLHttpRequest for its
 * upload.onprogress events. The result is wrapped as a Response so the caller's status handling
 * and bounded body read stay the same.
 */
const sendWithProgress = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal; body?: ArrayBuffer | string }, onSent: (sent: number) => void): Promise<Response> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, url); xhr.responseType = 'arraybuffer';
    for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => onSent(event.loaded);
    const abort = () => xhr.abort(); init.signal.addEventListener('abort', abort, { once: true });
    const done = () => init.signal.removeEventListener('abort', abort);
    xhr.onload = () => { done(); resolve(new Response(xhr.response as ArrayBuffer, { status: xhr.status, headers: new Headers(xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).map(line => { const at = line.indexOf(':'); return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as [string, string]; })) })); };
    xhr.onerror = () => { done(); reject(new Error('Network unavailable.')); };
    xhr.onabort = () => { done(); reject(new Error('File canceled.')); };
    xhr.send(init.body ?? null);
});
type Operation = 'attachment:create' | 'attachment:read' | 'attachment:write' | 'attachment:delete';
export class HttpFileGateway implements FileGateway {
    /** requestTimeoutMs bounds every request (headers, response and body) so a hung server never leaves a transfer 'Sending' forever. */
    constructor(private readonly baseUrl: string, private readonly headers: (operation: Operation) => Promise<Record<string, string>>, private readonly requestTimeoutMs = 60_000) {}
    private async request<T>(path: string, operation: Operation, signal?: AbortSignal, method = 'GET', value?: unknown, object?: WireObject, onBytes?: (received: number) => void, onSent?: (sent: number) => void): Promise<T> {
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
        try { response = await rateLimitedRequest(async () => {
            const init = { method, headers: await Promise.race([makeHeaders(), stopped]), signal: bounded.signal, body: object ? unb64(object.ciphertext, 256 * 1024 + 16).buffer as ArrayBuffer : value ? JSON.stringify(value) : undefined };
            return onSent ? sendWithProgress(`${this.baseUrl}/api/attachments/v2${path}`, init, onSent) : fetch(`${this.baseUrl}/api/attachments/v2${path}`, init);
        }, signal); }
        catch { if (signal?.aborted) throw new Error('File canceled.'); throw new Error('Network unavailable.'); }
        if (!response.ok) throw await fileHttpFailure(response);
        // Bound even an unexpected/malicious response; no response.json() on an unbounded body.
        const reader = response.body?.getReader(); if (!reader) throw new Error('File response missing.');
        let length = 0; const decoder = new TextDecoder(); let text = '';
        for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 360000) { await reader.cancel(); throw new Error('File response exceeds limits.'); } onBytes?.(length); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode(); return JSON.parse(text) as T;
        } catch (error) {
            if (signal?.aborted) throw new Error('File canceled.');
            if (bounded.signal.aborted) throw new Error('Network unavailable.');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
    }
    create(binding: FileBinding, fileSize: number, signal: AbortSignal): Promise<FileStatus> { return this.request('/create', 'attachment:create', signal, 'POST', { version: 2, binding, fileSize }); }
    status(id: string, signal: AbortSignal): Promise<FileStatus> { return this.request(`/${id}`, 'attachment:read', signal); }
    put(id: string, index: 'manifest' | number, object: WireObject, signal: AbortSignal, onBytes?: (sent: number) => void): Promise<FileStatus> { return index === 'manifest' ? this.request(`/${id}/manifest`, 'attachment:write', signal, 'PUT', object) : this.request(`/${id}/chunks/${index}`, 'attachment:write', signal, 'PUT', undefined, object, undefined, onBytes); }
    complete(id: string, signal: AbortSignal): Promise<FileStatus> { return this.request(`/${id}/complete`, 'attachment:write', signal, 'POST'); }
    chunk(id: string, index: number, signal: AbortSignal, onBytes?: (received: number) => void): Promise<WireObject> { return this.request(`/${id}/chunks/${index}`, 'attachment:read', signal, 'GET', undefined, undefined, onBytes); }
    async cancel(id: string): Promise<void> { await this.request(`/${id}`, 'attachment:delete', undefined, 'DELETE'); }
}
