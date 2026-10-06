import { randomUUID, webcrypto } from 'crypto';
import { FileLedgerService, type FileLedger, type FileLedgerPersistence, type FileObjectWrite } from './fileLedger';
import { FILE_LIMITS as L, reservationBytes, type FileBinding, type WireObject } from '../../service/src/files/protocol';
import type { AuthenticatedContext } from '../security/authorizationContext';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
export class MemoryLedgers implements FileLedgerPersistence {
    records = new Map<string, FileLedger>();
    objects = new Map<string, WireObject>();
    async object(account: string, transferId: string, index: number): Promise<WireObject | undefined> { return this.objects.get(`${account}:${transferId}:${index}`); }
    async read(a: string): Promise<FileLedger | undefined> { const v = this.records.get(a); return v ? structuredClone(v) : undefined; }
    async locate(id: string): Promise<FileLedger | undefined> { return [...this.records.values()].find(v => v.transfers.some(f => f.context.transferId === id)); }
    async replace(before: FileLedger | undefined, after: FileLedger, object?: FileObjectWrite): Promise<boolean> { const v = this.records.get(after._id); if (v?.revision !== before?.revision) return false; this.records.set(after._id, structuredClone(after)); if (object) this.objects.set(`${after._id}:${object.transferId}:${object.index}`, structuredClone(object.value));
        for (const old of before?.transfers ?? []) if (old.reserved > 0 && !after.transfers.some(f => f.context.transferId === old.context.transferId && f.reserved > 0)) for (const key of this.objects.keys()) if (key.startsWith(`${after._id}:${old.context.transferId}:`)) this.objects.delete(key); return true; }
    async *accounts(): AsyncIterable<string> { for (const k of this.records.keys()) yield k; }
}
const alice = randomUUID(), bob = randomUUID(), mallory = randomUUID(), conversationId = randomUUID();
const fingerprint = (c: string): string => 'K3 ' + Array(10).fill(c.repeat(4)).join(' ') + ' ' + c.repeat(3);
const identities = new Map<string, string>([[alice, fingerprint('A')], [bob, fingerprint('B')], [mallory, fingerprint('M')]]);
const binding: FileBinding = { conversationId, senderParticipantId: alice, recipientParticipantId: bob, senderIdentityReference: fingerprint('A'), recipientIdentityReference: fingerprint('B') };
const auth = (id = alice): AuthenticatedContext => ({ sessionId: id, requestId: randomUUID(), participantId: id, conversationId, identityReference: identities.get(id), accountIdentityReference: id === alice ? 'account-alice' : 'account-bob', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, permissions: ['attachment:create', 'attachment:read', 'attachment:write', 'attachment:delete'], deviceTrust: { assertTrusted: async () => {} } });
const object = (size: number, nonce = 1): WireObject => ({ nonce: Buffer.alloc(12, nonce).toString('base64url'), ciphertext: Buffer.alloc(size, nonce).toString('base64url') });
let persistence: MemoryLedgers, service: FileLedgerService, now: number;
beforeEach(() => { now = Date.now(); persistence = new MemoryLedgers(); service = new FileLedgerService(persistence, async (c, p) => c === conversationId ? identities.get(p) : undefined, () => now); });
const create = (size = 1) => service.create(auth(), { version: 2, binding, fileSize: size });
test('V2 creation reserves exact conservative bytes; unknown/stripped version and invalid geometry rejected', async () => {
    const f = await create(); expect(f.version).toBe(2); expect(persistence.records.get('account-alice')!.transfers[0].reserved).toBe(reservationBytes(1, 1));
    for (const version of [undefined, 1, 3]) await expect(service.create(auth(), { version, binding, fileSize: 1 } as Parameters<FileLedgerService['create']>[1])).rejects.toThrow();
    for (const size of [0, -1, 1.5, L.MAX_FILE_SIZE + 1]) await expect(create(size)).rejects.toThrow();
});
test('Alice/Bob/Mallory: transfer secrecy grants no read/write/cancel/delete; substitutions denied', async () => {
    const f = await create(); const id = f.context.transferId;
    await expect(service.status(auth(bob), id)).resolves.toMatchObject({ state: 'incomplete' });
    await expect(service.status(auth(mallory), id)).rejects.toThrow('authorization');
    await expect(service.status({ ...auth(), conversationId: randomUUID() }, id)).rejects.toThrow('authorization');
    await expect(service.status({ ...auth(bob), identityReference: fingerprint('M') }, id)).rejects.toThrow('authorization');
    for (const peer of [bob, mallory]) { await expect(service.put(auth(peer), id, 0, object(17))).rejects.toThrow('authorization'); await expect(service.cancel(auth(peer), id)).rejects.toThrow('authorization'); await expect(service.complete(auth(peer), id)).rejects.toThrow('authorization'); }
    await expect(service.status(auth(), randomUUID())).rejects.toThrow('authorization');
    for (const change of [{ senderParticipantId: mallory }, { recipientIdentityReference: fingerprint('M') }, { conversationId: randomUUID() }, { senderIdentityReference: fingerprint('M') }]) await expect(service.create(auth(), { version: 2, binding: { ...binding, ...change }, fileSize: 1 })).rejects.toThrow('authorization');
});
test('geometry required at completion; duplicate concurrent objects do not double count; conflicts and nonce reuse fail', async () => {
    const f = await create(); const id = f.context.transferId; const reserve = persistence.records.get('account-alice')!.transfers[0].reserved;
    await expect(service.complete(auth(), id)).rejects.toThrow('incomplete');
    await service.put(auth(), id, 'manifest', object(80, 1));
    await Promise.all([service.put(auth(), id, 0, object(17, 2)), service.put(auth(), id, 0, object(17, 2))]);
    expect(persistence.records.get('account-alice')!.transfers[0].reserved).toBe(reserve);
    await expect(service.put(auth(), id, 0, object(17, 3))).rejects.toThrow('conflict');
    await expect(service.put(auth(), id, 'manifest', object(80, 2))).rejects.toThrow('conflict');
    await expect(service.put(auth(), id, 1, object(17))).rejects.toThrow('limits');
    expect((await service.complete(auth(), id)).state).toBe('available'); expect((await service.complete(auth(), id)).state).toBe('available');
    await expect(service.chunk(auth(bob), id, 0)).resolves.toEqual(object(17, 2));
    await expect(service.chunk(auth(), id, 0)).rejects.toThrow('authorization');
});
test('oversized chunks and manifests, active/stored/incomplete quotas are bounded across conversations', async () => {
    const f = await create(L.MAX_FILE_SIZE);
    await expect(service.put(auth(), f.context.transferId, 'manifest', object(L.MAX_METADATA_SIZE + 1))).rejects.toThrow('limits');
    await expect(service.put(auth(), f.context.transferId, 0, object(L.MAX_CHUNK_SIZE + 17))).rejects.toThrow('limits');
    await expect(create(2 * 1024 * 1024)).rejects.toThrow('quota');
    await service.cancel(auth(), f.context.transferId); await create(); await create(); await expect(create()).rejects.toThrow('quota');
});
test('cancellation is idempotent; stale mutations and download denied; quota freed but abandoned-upload tombstones bounded', async () => {
    const f = await create(); const id = f.context.transferId; await service.put(auth(), id, 0, object(17));
    await service.cancel(auth(), id); await service.cancel(auth(), id);
    expect(persistence.records.get('account-alice')!.transfers[0].reserved).toBe(0);
    await expect(service.put(auth(), id, 0, object(17))).rejects.toThrow('canceled'); await expect(service.chunk(auth(bob), id, 0)).rejects.toThrow('canceled');
    for (let n = 1; n < L.MAX_RECORDS; n++) { const next = await create(); await service.cancel(auth(), next.context.transferId); }
    await expect(create()).rejects.toThrow('quota');
});
test('service restart preserves incomplete bytes/accounting; cleanup expires/reclaims atomically and eventually removes tombstones', async () => {
    const f = await create(); await service.put(auth(), f.context.transferId, 0, object(17));
    service = new FileLedgerService(persistence, async () => fingerprint('A'), () => now);
    const status = await service.status(auth(), f.context.transferId); expect(status.state).toBe('incomplete'); expect(status.indices).toEqual([0]);
    await expect(service.complete(auth(), f.context.transferId)).rejects.toThrow('incomplete');
    now += L.TRANSFER_EXPIRY; await service.cleanup(); expect(persistence.records.get('account-alice')!.transfers[0]).toMatchObject({ state: 'expired', reserved: 0, chunks: {} });
    await expect(service.put(auth(), f.context.transferId, 0, object(17))).rejects.toThrow('expired');
    now += L.TRANSFER_EXPIRY; await service.cleanup(); expect(persistence.records.get('account-alice')!.transfers).toEqual([]);
});
