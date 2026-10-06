import { randomUUID } from 'crypto';
import type { Db } from 'mongodb';
import { FILE_LIMITS as L, exact, reservationBytes, sealed, validateFileContext, type FileBinding, type FileStatus, type WireObject } from '../../service/src/files/protocol';
import type { AuthenticatedContext } from '../security/authorizationContext';
export interface StoredFile extends FileStatus { reserved: number; chunks: Record<string, { nonce: string; bytes: number }>; }
export interface FileObjectWrite { transferId: string; index: number; value: WireObject; }
export interface FileLedger { _id: string; revision: number; transfers: StoredFile[]; }
export interface FileLedgerPersistence { read(account: string): Promise<FileLedger | undefined>; locate(id: string): Promise<FileLedger | undefined>; replace(before: FileLedger | undefined, after: FileLedger, object?: FileObjectWrite): Promise<boolean>; object(account: string, transferId: string, index: number): Promise<WireObject | undefined>; accounts(): AsyncIterable<string>; }
export class FileError extends Error { constructor(readonly category: 'authorization' | 'limits' | 'quota' | 'conflict' | 'incomplete' | 'expired' | 'canceled' | 'storage') { super(`File transfer: ${category}.`); } }
const deny = (): never => { throw new FileError('authorization'); };
const view = (f: StoredFile): FileStatus => ({ version: 2, context: { ...f.context }, createdAt: f.createdAt, expiresAt: f.expiresAt, state: f.state, indices: Object.keys(f.chunks).map(Number).sort((a, b) => a - b), ...(f.manifest ? { manifest: { ...f.manifest } } : {}) });
/** Each account is ONE bounded Mongo document: quota reservation, state and bytes commit together, even without replica-set transactions. */
export class FileLedgerService {
    constructor(private readonly persistence: FileLedgerPersistence, private readonly identity: (conversation: string, participant: string) => Promise<string | undefined>, private readonly now: () => number = Date.now) {}
    private expire(ledger: FileLedger): void {
        for (const f of ledger.transfers) if (f.expiresAt <= this.now()) { f.state = 'expired'; f.reserved = 0; f.chunks = {}; delete f.manifest; }
        ledger.transfers = ledger.transfers.filter(f => f.expiresAt + L.TRANSFER_EXPIRY > this.now());
    }
    private async atomic<T>(account: string, change: (value: FileLedger) => T | Promise<T>, object?: FileObjectWrite): Promise<T> {
        for (let n = 0; n < 12; n++) {
            const before = await this.persistence.read(account);
            const after: FileLedger = before ? structuredClone(before) : { _id: account, revision: 0, transfers: [] };
            this.expire(after); const result = await change(after); after.revision++;
            if (await this.persistence.replace(before, after, object)) return result;
        }
        throw new FileError('storage');
    }
    private async trusted(auth: AuthenticatedContext, permission: import('../security/authorizationContext').AttachmentPermission): Promise<void> {
        if (!auth.accountIdentityReference || auth.expiresAt <= this.now() || !auth.permissions.includes(permission)) deny();
        await auth.deviceTrust.assertTrusted();
        if (!auth.identityReference || await this.identity(auth.conversationId, auth.participantId) !== auth.identityReference) deny();
    }
    private authorize(auth: AuthenticatedContext, f: StoredFile, owner: boolean): void {
        const c = f.context;
        if (c.conversationId !== auth.conversationId) deny();
        const isSender = auth.participantId === c.senderParticipantId && auth.identityReference === c.senderIdentityReference;
        const isRecipient = auth.participantId === c.recipientParticipantId && auth.identityReference === c.recipientIdentityReference;
        if (owner ? !isSender : !isSender && !isRecipient) deny();
    }
    async create(auth: AuthenticatedContext, input: { version: 2; binding: FileBinding; fileSize: number }): Promise<FileStatus> {
        await this.trusted(auth, 'attachment:create');
        try { exact(input, ['version', 'binding', 'fileSize']); exact(input.binding, ['conversationId', 'senderParticipantId', 'recipientParticipantId', 'senderIdentityReference', 'recipientIdentityReference']); } catch { throw new FileError('limits'); }
        const context = { ...input.binding, transferId: randomUUID(), fileSize: input.fileSize, chunkSize: L.MAX_CHUNK_SIZE, chunkCount: Math.ceil(input.fileSize / L.MAX_CHUNK_SIZE) };
        if (input.version !== 2) throw new FileError('limits');
        try { validateFileContext(context); } catch { throw new FileError('limits'); }
        if (context.conversationId !== auth.conversationId || context.senderParticipantId !== auth.participantId || context.senderIdentityReference !== auth.identityReference || await this.identity(context.conversationId, context.recipientParticipantId) !== context.recipientIdentityReference) deny();
        const reserved = reservationBytes(context.fileSize, context.chunkCount);
        return this.atomic(auth.accountIdentityReference!, ledger => {
            const stored = ledger.transfers.reduce((s, f) => s + f.reserved, 0);
            const active = ledger.transfers.filter(f => f.state === 'incomplete');
            if (ledger.transfers.length >= L.MAX_RECORDS || active.length >= L.MAX_ACTIVE_TRANSFERS || stored + reserved > L.MAX_STORED_BYTES_PER_USER || active.reduce((s, f) => s + f.reserved, 0) + reserved > L.MAX_INCOMPLETE_BYTES_PER_USER) throw new FileError('quota');
            const createdAt = this.now(); const f: StoredFile = { version: 2, context, createdAt, expiresAt: createdAt + L.TRANSFER_EXPIRY, state: 'incomplete', indices: [], reserved, chunks: {} };
            ledger.transfers.push(f); return view(f);
        });
    }
    private async access<T>(auth: AuthenticatedContext, id: string, permission: 'attachment:read' | 'attachment:write' | 'attachment:delete', action: (f: StoredFile, account: string) => T | Promise<T>, object?: FileObjectWrite): Promise<T> {
        await this.trusted(auth, permission);
        if (!/^[0-9a-f-]{36}$/.test(id)) deny();
        const ledger = await this.persistence.locate(id); if (!ledger) deny();
        return this.atomic(ledger._id, current => { const f = current.transfers.find(t => t.context.transferId === id); if (!f) deny(); this.authorize(auth, f, permission !== 'attachment:read'); return action(f, ledger._id); }, object);
    }
    private live(f: StoredFile): void { if (f.state === 'expired' || f.expiresAt <= this.now()) throw new FileError('expired'); if (f.state === 'canceled') throw new FileError('canceled'); }
    status(auth: AuthenticatedContext, id: string): Promise<FileStatus> { return this.access(auth, id, 'attachment:read', f => { const result = view(f); if (auth.participantId !== f.context.senderParticipantId && f.state !== 'available') delete result.manifest; return result; }); }
    put(auth: AuthenticatedContext, id: string, index: 'manifest' | number, object: WireObject): Promise<FileStatus> {
        return this.access(auth, id, 'attachment:write', async (f, account) => {
            this.live(f);
            const max = index === 'manifest' ? L.MAX_METADATA_SIZE : Math.min(f.context.chunkSize, f.context.fileSize - index * f.context.chunkSize) + 16;
            if (index !== 'manifest' && (!Number.isInteger(index) || index < 0 || index >= f.context.chunkCount)) throw new FileError('limits');
            let size: number; try { size = sealed(object, max).ciphertext.length; } catch { throw new FileError('limits'); }
            if (index !== 'manifest' && size !== max) throw new FileError('limits');
            const existing = index === 'manifest' ? f.manifest : f.chunks[String(index)] ? await this.persistence.object(account, id, index) : undefined;
            if (existing) { if (existing.nonce !== object.nonce || existing.ciphertext !== object.ciphertext) throw new FileError('conflict'); return view(f); }
            if (f.state !== 'incomplete') throw new FileError('conflict');
            // A repeated nonce for distinct objects is never accepted, including manifest/chunk overlap.
            if ([...(f.manifest ? [f.manifest] : []), ...Object.values(f.chunks)].some(v => v.nonce === object.nonce)) throw new FileError('conflict');
            if (index === 'manifest') f.manifest = { ...object }; else f.chunks[String(index)] = { nonce: object.nonce, bytes: size }; return view(f);
        }, index === 'manifest' ? undefined : { transferId: id, index, value: object });
    }
    complete(auth: AuthenticatedContext, id: string): Promise<FileStatus> { return this.access(auth, id, 'attachment:write', f => { this.live(f); if (!f.manifest || Object.keys(f.chunks).length !== f.context.chunkCount || Array.from({ length: f.context.chunkCount }, (_, i) => f.chunks[String(i)]).some(v => !v)) throw new FileError('incomplete'); f.state = 'available'; return view(f); }); }
    chunk(auth: AuthenticatedContext, id: string, index: number): Promise<WireObject> { return this.access(auth, id, 'attachment:read', async (f, account) => { this.live(f); if (auth.participantId !== f.context.recipientParticipantId) deny(); if (f.state !== 'available') throw new FileError('incomplete'); if (!Number.isInteger(index) || index < 0 || index >= f.context.chunkCount || !f.chunks[String(index)]) throw new FileError('limits'); const object = await this.persistence.object(account, id, index); if (!object) throw new FileError('storage'); return object; }); }
    cancel(auth: AuthenticatedContext, id: string): Promise<FileStatus> { return this.access(auth, id, 'attachment:delete', f => { if (f.state !== 'expired') f.state = 'canceled'; f.reserved = 0; f.chunks = {}; delete f.manifest; return view(f); }); }
    async cleanup(): Promise<void> { for await (const account of this.persistence.accounts()) await this.atomic(account, () => undefined); }
}
interface MongoLedger extends FileLedger { objects?: Record<string, Record<string, WireObject>>; }
export class MongoFileLedgerPersistence implements FileLedgerPersistence {
    private readonly collection;
    constructor(database: Db) { this.collection = database.collection<MongoLedger>('file_ledgers_v2'); }
    async read(account: string): Promise<FileLedger | undefined> { return await this.collection.findOne({ _id: account }, { projection: { objects: 0 }, maxTimeMS: 5000 }) ?? undefined; }
    async locate(id: string): Promise<FileLedger | undefined> { return await this.collection.findOne({ 'transfers.context.transferId': id, 'transfers.0': { $exists: true } }, { projection: { objects: 0 }, hint: 'transfers.context.transferId_1', maxTimeMS: 5000 }) ?? undefined; }
    async object(account: string, transferId: string, index: number): Promise<WireObject | undefined> {
        const path = `objects.${transferId}.chunk-${index}`;
        const document = await this.collection.findOne({ _id: account }, { projection: { _id: 0, [path]: 1 }, maxTimeMS: 5000 });
        return document?.objects?.[transferId]?.[`chunk-${index}`];
    }
    async replace(before: FileLedger | undefined, after: FileLedger, object?: FileObjectWrite): Promise<boolean> {
        if (before) {
            const set: Record<string, unknown> = { revision: after.revision, transfers: after.transfers };
            if (object) set[`objects.${object.transferId}.chunk-${object.index}`] = object.value;
            const unset: Record<string, ''> = {};
            for (const old of before.transfers) if (old.reserved > 0 && !after.transfers.some(f => f.context.transferId === old.context.transferId && f.reserved > 0)) unset[`objects.${old.context.transferId}`] = '';
            // The same single-document CAS commits ciphertext, geometry, quota and cleanup. Only one chunk crosses the application boundary.
            return (await this.collection.updateOne({ _id: before._id, revision: before.revision }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { writeConcern: { w: 'majority', j: true }, maxTimeMS: 5000 })).modifiedCount === 1;
        }
        try { await this.collection.insertOne(after, { writeConcern: { w: 'majority', j: true } }); return true; } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 11000) return false; throw e; }
    }
    async *accounts(): AsyncIterable<string> { for await (const v of this.collection.find({}, { projection: { _id: 1 } })) yield v._id; }
}
