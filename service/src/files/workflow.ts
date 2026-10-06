import { openAttachmentChunk, openAttachmentManifest, sealAttachmentChunk, sealAttachmentManifest } from '../attachments/portableAead';
import { decodeAttachmentManifest, encodeAttachmentManifest, type AttachmentManifestV2 } from '../attachments/portableManifest';
import { FILE_LIMITS as L, b64, unb64, wire, sealed, sameBinding, parseFileReference, serializeFileReference, type FileBinding, type FileReference, type FileStatus, type WireObject } from './protocol';
import { FileTransferState, type FileProgress } from './state';
export interface FileSource { size: number; name: string; type: string; read(offset: number, length: number): Promise<Uint8Array>; }
export interface SealedFileCache { get(index: string): Promise<WireObject | undefined>; put(index: string, value: WireObject): Promise<void>; clear(): Promise<void>; }
export interface FileOutput<T> { write(bytes: Uint8Array): Promise<void>; finish(manifest: AttachmentManifestV2): Promise<T>; discard(): Promise<void>; }
export interface FileGateway {
    create(binding: FileBinding, size: number, signal: AbortSignal): Promise<FileStatus>;
    status(id: string, signal: AbortSignal): Promise<FileStatus>;
    put(id: string, index: 'manifest' | number, value: WireObject, signal: AbortSignal): Promise<FileStatus>;
    complete(id: string, signal: AbortSignal): Promise<FileStatus>;
    chunk(id: string, index: number, signal: AbortSignal): Promise<WireObject>;
    cancel(id: string): Promise<void>;
}
interface Pending { source: FileSource; reference: FileReference; key: Uint8Array; cache: SealedFileCache; produced: Set<string>; }
const checkStatus = (r: FileReference, s: FileStatus): void => {
    if (s.version !== 2 || (!sameBinding(s.context, r.context) || s.context.transferId !== r.context.transferId || s.context.fileSize !== r.context.fileSize || s.context.chunkSize !== r.context.chunkSize || s.context.chunkCount !== r.context.chunkCount) || s.createdAt !== r.createdAt || s.expiresAt !== r.expiresAt) throw new Error('File binding rejected.');
    if (s.state === 'expired' || s.expiresAt <= Date.now()) throw new Error('File expired.');
    if (s.state === 'canceled') throw new Error('File canceled.');
    if (!Array.isArray(s.indices) || new Set(s.indices).size !== s.indices.length || s.indices.some(i => !Number.isInteger(i) || i < 0 || i >= r.context.chunkCount)) throw new Error('File state rejected.');
};
/** Key remains in this process only; cache holds sealed objects only. Each retry queries authenticated server truth. */
export class FileTransferWorkflow {
    readonly state: FileTransferState;
    private pending?: Pending;
    private controller?: AbortController;
    private running = false;
    constructor(private readonly gateway: FileGateway, private readonly authority: (verified: boolean) => Promise<FileBinding>, private readonly cacheFactory: () => Promise<SealedFileCache>, private readonly publish: (reference: string, binding: FileBinding) => Promise<void>, changed: (progress: FileProgress) => void = () => {}) { this.state = new FileTransferState(changed); }
    private fence(g: number): void { if (!this.state.live(g) || this.controller?.signal.aborted) throw new Error('File canceled.'); }
    async send(source: FileSource): Promise<void> {
        if (this.running) throw new Error('Another file operation is active.');
        await this.forget();
        this.controller = new AbortController(); const g = this.state.begin(source.size, source.name); this.running = true;
        let allocatedCache: SealedFileCache | undefined; let createdId: string | undefined;
        try {
            if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > L.MAX_FILE_SIZE) throw new Error('File must be between 1 byte and 8 MiB.');
            const binding = await this.authority(true); this.fence(g);
            const cache = await this.cacheFactory(); allocatedCache = cache; this.fence(g);
            const created = await this.gateway.create(binding, source.size, this.controller.signal); createdId = created.context?.transferId; this.fence(g);
            const key = crypto.getRandomValues(new Uint8Array(32));
            const reference: FileReference = { version: 2, context: created.context, key: b64(key), createdAt: created.createdAt, expiresAt: created.expiresAt };
            // Strict reference validation also verifies the server's geometry; sender identities must match local authority.
            serializeFileReference(reference); if (!sameBinding(binding, created.context)) throw new Error('File binding rejected.');
            this.pending = { source, reference, key, cache, produced: new Set() };
            const manifest = decodeAttachmentManifest(encodeAttachmentManifest({ filename: source.name, mimeType: source.type, fileSize: source.size, chunkSize: created.context.chunkSize, chunkCount: created.context.chunkCount, createdAt: created.createdAt, expiresAt: created.expiresAt }));
            this.state.details(g, source.size, manifest.filename);
            this.pending.produced.add('manifest');
            await cache.put('manifest', wire(await sealAttachmentManifest(key, created.context, manifest))); this.fence(g);
            await this.upload(g);
        } catch (e) {
            if (!this.pending && this.state.value.phase !== 'WaitingForRecipient') { await allocatedCache?.clear().catch(() => undefined); if (createdId) await this.gateway.cancel(createdId).catch(() => undefined); }
            this.failed(g, e);
        } finally { this.running = false; }
    }
    async retry(): Promise<void> {
        if (this.running || !this.pending || this.state.value.phase !== 'Failed' || !this.state.value.retryable) return;
        this.controller = new AbortController(); const g = this.state.begin(this.pending.source.size, this.pending.source.name); this.running = true;
        try { await this.upload(g); } catch (e) { this.failed(g, e); } finally { this.running = false; }
    }
    private async upload(g: number): Promise<void> {
        const p = this.pending!; const r = p.reference; const signal = this.controller!.signal;
        const authorize = async (): Promise<void> => { if (!sameBinding(await this.authority(true), r.context)) throw new Error('File contact identity changed.'); this.fence(g); };
        await authorize(); let status = await this.gateway.status(r.context.transferId, signal); this.fence(g); checkStatus(r, status);
        this.state.move(g, 'Encrypting');
        const manifest = await p.cache.get('manifest'); if (!manifest) throw new Error('File cache unavailable; restart required.');
        this.state.move(g, 'Uploading');
        if (!status.manifest) { status = await this.gateway.put(r.context.transferId, 'manifest', manifest, signal); this.fence(g); checkStatus(r, status); }
        else if ((status.manifest.nonce !== manifest.nonce || status.manifest.ciphertext !== manifest.ciphertext)) throw new Error('File object conflict.');
        let accepted = status.indices.reduce((sum, i) => sum + Math.min(r.context.chunkSize, r.context.fileSize - i * r.context.chunkSize), 0);
        this.state.move(g, 'Uploading', accepted);
        for (let i = 0; i < r.context.chunkCount; i++) {
            await authorize(); if (status.indices.includes(i)) continue;
            let value = await p.cache.get(String(i)); this.fence(g);
            if (!value) {
                if (p.produced.has(String(i))) throw new Error('File cache unavailable; restart required.');
                p.produced.add(String(i));
                this.state.move(g, 'Encrypting', accepted);
                const bytes = await p.source.read(i * r.context.chunkSize, Math.min(r.context.chunkSize, r.context.fileSize - i * r.context.chunkSize)); this.fence(g);
                try { value = wire(await sealAttachmentChunk(p.key, { ...r.context, chunkIndex: i }, bytes)); } finally { bytes.fill(0); }
                this.fence(g); await p.cache.put(String(i), value); this.fence(g);
            }
            this.state.move(g, 'Uploading', accepted);
            status = await this.gateway.put(r.context.transferId, i, value, signal); this.fence(g); checkStatus(r, status);
            accepted = status.indices.reduce((sum, j) => sum + Math.min(r.context.chunkSize, r.context.fileSize - j * r.context.chunkSize), 0);
            this.state.move(g, 'Uploading', accepted);
        }
        await authorize(); const completed = await this.gateway.complete(r.context.transferId, signal); this.fence(g); checkStatus(r, completed);
        if (completed.state !== 'available' || completed.indices.length !== r.context.chunkCount) throw new Error('File incomplete.');
        await authorize(); await this.publish(serializeFileReference(r), r.context); this.fence(g);
        this.state.move(g, 'WaitingForRecipient', r.context.fileSize); await this.release(false);
    }
    async receive<T>(text: string, outputFactory: (size: number) => Promise<FileOutput<T>>): Promise<T | undefined> {
        if (this.running) throw new Error('Another file operation is active.');
        await this.forget(); this.controller = new AbortController(); const g = this.state.begin(0); this.running = true; let output: FileOutput<T> | undefined;
        try {
            const r = parseFileReference(text); const own = await this.authority(false); this.fence(g);
            const expected: FileBinding = { conversationId: own.conversationId, senderParticipantId: own.recipientParticipantId, recipientParticipantId: own.senderParticipantId, senderIdentityReference: own.recipientIdentityReference, recipientIdentityReference: own.senderIdentityReference };
            if (!sameBinding(expected, r.context)) throw new Error('File identity binding rejected.');
            const key = unb64(r.key, 32);
            try {
                const status = await this.gateway.status(r.context.transferId, this.controller.signal); this.fence(g); checkStatus(r, status);
                if (status.state !== 'available' || status.indices.length !== r.context.chunkCount || !status.manifest) throw new Error('File incomplete.');
                this.state.move(g, 'Downloading');
                const manifest = await openAttachmentManifest(key, r.context, sealed(status.manifest, L.MAX_METADATA_SIZE)); this.fence(g);
                if (manifest.createdAt !== r.createdAt || manifest.expiresAt !== r.expiresAt) throw new Error('File manifest binding rejected.');
                this.state.details(g, manifest.fileSize, manifest.filename);
                output = await outputFactory(manifest.fileSize); this.fence(g);
                let total = 0;
                for (let i = 0; i < r.context.chunkCount; i++) {
                    if (!sameBinding(await this.authority(false), own)) throw new Error('File contact changed.'); this.fence(g);
                    const value = await this.gateway.chunk(r.context.transferId, i, this.controller.signal); this.fence(g);
                    this.state.move(g, 'Verifying', total);
                    const plaintext = await openAttachmentChunk(key, { ...r.context, chunkIndex: i }, sealed(value, L.MAX_CHUNK_SIZE + 16));
                    try { this.fence(g); await output.write(plaintext); total += plaintext.length; } finally { plaintext.fill(0); }
                    this.fence(g); if (i + 1 < r.context.chunkCount) this.state.move(g, 'Downloading', total);
                }
                if (total !== manifest.fileSize) throw new Error('File size mismatch.');
                this.fence(g); const result = await output.finish(manifest); this.fence(g); this.state.move(g, 'Complete', total); return result;
            } finally { key.fill(0); }
        } catch (e) { await output?.discard(); this.failed(g, e); return undefined; } finally { this.running = false; }
    }
    private failed(g: number, e: unknown): void {
        if (!this.state.live(g)) return;
        const reason = e instanceof Error && e.name === 'QuotaExceededError' ? 'Not enough local storage space.' : e instanceof Error ? e.message : 'File operation failed.';
        // Deliberately fixed categories: never reflect server bodies, file keys, URIs or routing credentials.
        const expired = reason.toLowerCase().includes('expired');
        const restart = reason.toLowerCase().includes('cache unavailable');
        const unsupported = reason === 'Secure file storage unavailable.';
        const retryable = !!this.pending && !expired && !unsupported && !restart && /network|fetch|temporarily|storage unavailable/i.test(reason);
        const failure = restart ? 'Sealed file cache was lost. Select the original file again to start a new transfer.' : unsupported ? 'This browser cannot safely stream attachments.' : /8 MiB/.test(reason) ? 'File must be between 1 byte and 8 MiB.' : expired ? 'File expired.' : /quota/i.test(reason) ? 'File storage quota reached.' : /space|full|quotaexceeded/i.test(reason) ? 'Not enough local storage.' : /verification|identity|contact|binding/i.test(reason) ? 'Verified unchanged contact required.' : retryable ? 'Network unavailable. Retry this transfer in this session.' : 'File transfer failed. Select the file again to restart.';
        this.state.move(g, restart ? 'RestartRequired' : expired ? 'Expired' : 'Failed', undefined, failure, retryable);
        if (restart) void this.release(true).catch(() => undefined);
    }
    cancel(): void { this.state.cancel(); this.controller?.abort(); void this.release(true).catch(() => undefined); }
    private async release(cancel: boolean): Promise<void> { const p = this.pending; this.pending = undefined; if (p) { p.key.fill(0); await p.cache.clear().catch(() => undefined); if (cancel) await this.gateway.cancel(p.reference.context.transferId).catch(() => undefined); } }
    private async forget(): Promise<void> { this.controller?.abort(); await this.release(true); }
    dispose(): void { this.cancel(); }
}
