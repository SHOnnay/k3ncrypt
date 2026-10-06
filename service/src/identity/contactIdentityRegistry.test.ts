jest.mock('../crypto/base64url', () => ({
    toBase64Url: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
    fromBase64Url: (value: string) => new Uint8Array(Buffer.from(value, 'base64url')),
}));
import { ContactIdentityRegistry } from './contactIdentityRegistry';
import type { SecureStorage } from '../core/contracts';

class MemoryStorage implements Pick<SecureStorage, 'read' | 'write'> {
    private readonly values = new Map<string, ArrayBuffer>();
    async read(type: string, id: string) { return this.values.get(`${type}:${id}`); }
    async write(type: string, id: string, value: ArrayBuffer) { this.values.set(`${type}:${id}`, value.slice(0)); }
}

const identity = (id: string, verification: 'unknown' | 'unverified' | 'verified' = 'unverified') => ({
    identityId: id, algorithm: 'Olm-Curve25519+Ed25519', publicKey: new Uint8Array(32).fill(id.charCodeAt(0)), verification,
});

describe('ContactIdentityRegistry', () => {
    it('never imports a presented verified flag as local trust', async () => {
        const registry = new ContactIdentityRegistry(new MemoryStorage() as unknown as SecureStorage);
        const first = await registry.observe('untrusted', identity('a', 'verified'));
        expect(first.current.verification).toBe('unverified');
        await registry.observe('untrusted', identity('b'));
        await expect(registry.markVerified('untrusted')).rejects.toThrow('Review');
    });
    it('uses TOFU and invalidates verification when a key changes', async () => {
        const registry = new ContactIdentityRegistry(new MemoryStorage() as unknown as SecureStorage);
        expect((await registry.observe('contact', identity('a'))).kind).toBe('first-seen');
        await registry.markVerified('contact');
        const changed = await registry.observe('contact', identity('b'));
        expect(changed.kind).toBe('identity-changed');
        if (changed.kind === 'identity-changed') {
            expect(changed.current.verification).toBe('unverified');
            expect(changed.verifiedIdentityPreserved).toBe(true);
        }
        await expect(registry.acceptPendingChange('contact')).resolves.toBeUndefined();
        const unchanged = await registry.observe('contact', identity('b'));
        expect(unchanged.kind).toBe('unchanged');
    });
});

describe('local verification reset and serialized identity changes', () => {
    it('persists explicit unverify across registry recreation', async () => {
        const storage = new MemoryStorage() as unknown as SecureStorage;
        const registry = new ContactIdentityRegistry(storage);
        await registry.observe('contact', identity('a'));
        await registry.markVerified('contact', 'a');
        expect((await new ContactIdentityRegistry(storage).get('contact'))?.verification).toBe('verified');
        await registry.markUnverified('contact');
        expect((await new ContactIdentityRegistry(storage).get('contact'))?.verification).toBe('unverified');
    });
    it('cannot verify a stale comparison and serializes concurrent observation', async () => {
        const storage = new MemoryStorage() as unknown as SecureStorage;
        const registry = new ContactIdentityRegistry(storage);
        await registry.observe('contact', identity('a'));
        await registry.markVerified('contact', 'a');
        const other = new ContactIdentityRegistry(storage);
        const results = await Promise.allSettled([registry.observe('contact', identity('b')), other.markVerified('contact', 'a')]);
        expect(results[1].status).toBe('rejected');
        expect((await registry.get('contact'))?.changeStatus).toBe('changed-pending-review');
        await registry.markUnverified('contact');
        expect((await registry.get('contact'))?.changeStatus).toBe('changed-pending-review');
        await registry.acceptPendingChange('contact');
        await expect(registry.markVerified('contact', 'a')).rejects.toThrow('comparison');
        await registry.markVerified('contact', 'b');
        expect((await registry.get('contact'))?.verification).toBe('verified');
    });
});

it('uses production atomic comparison and refuses a stale identity verification write', async () => {
    const memory = new MemoryStorage();
    const storage = memory as unknown as SecureStorage;
    let rejectNext = false;
    storage.compareAndSwapRecords = async (updates) => {
        if (rejectNext) { rejectNext = false; return false; }
        for (const update of updates) {
            const current = await memory.read(update.recordType, update.recordId);
            if (Buffer.from(current ?? new ArrayBuffer(0)).compare(Buffer.from(update.expected ?? new ArrayBuffer(0))) !== 0) return false;
        }
        for (const update of updates) await memory.write(update.recordType, update.recordId, update.next);
        return true;
    };
    const registry = new ContactIdentityRegistry(storage);
    await registry.observe('contact', identity('a'));
    rejectNext = true;
    await expect(registry.markVerified('contact', 'a')).rejects.toThrow('concurrently');
    expect((await registry.get('contact'))?.verification).toBe('unverified');
    await registry.markVerified('contact', 'a');
    await registry.observe('contact', identity('b'));
    expect((await registry.get('contact'))?.changeStatus).toBe('changed-pending-review');
});

it('call authority reads do not write verification even when a recovery reset is pending', async () => {
    const memory = new MemoryStorage();
    const registry = new ContactIdentityRegistry(memory as unknown as SecureStorage, () => 10);
    await registry.observe('contact', identity('a'));
    await registry.markVerified('contact', 'a');
    await memory.write('contact-trust-reset', 'local', new TextEncoder().encode(JSON.stringify({ version: 1, resetAt: 20 })).buffer);
    const write = jest.spyOn(memory, 'write');
    expect((await registry.get('contact', false))?.verification).toBe('unverified');
    expect(write).not.toHaveBeenCalled();
});

it('file publication CAS guards reject a concurrent unverify or recovery reset', async () => {
    const values = new Map<string, ArrayBuffer>();
    const storage: SecureStorage = {
        initializeWithPassphrase: async () => {}, unlock: async () => {}, lock: () => {}, changeUnlockSecret: async () => {}, isLocked: () => false,
        withVodozemacPickleKey: async callback => callback(new Uint8Array(32)),
        read: async (type, id) => values.get(`${type}:${id}`),
        write: async (type, id, value) => { values.set(`${type}:${id}`, value); },
        delete: async (type, id) => { values.delete(`${type}:${id}`); },
        compareAndSwapRecords: async updates => {
            if (updates.some(u => Buffer.compare(Buffer.from(values.get(`${u.recordType}:${u.recordId}`) ?? new ArrayBuffer(0)), Buffer.from(u.expected ?? new ArrayBuffer(0))) !== 0)) return false;
            for (const u of updates) { if (u.next) values.set(`${u.recordType}:${u.recordId}`, u.next); else values.delete(`${u.recordType}:${u.recordId}`); } return true;
        },
    };
    const registry = new ContactIdentityRegistry(storage); await registry.observe('contact', identity('A')); await registry.markVerified('contact', 'A');
    const guards = await registry.prepareVerifiedFileGuards('contact', 'A'); await registry.markUnverified('contact'); expect(await storage.compareAndSwapRecords!(guards)).toBe(false);
    await registry.markVerified('contact', 'A'); const resetGuards = await registry.prepareVerifiedFileGuards('contact', 'A');
    await storage.write('contact-trust-reset', 'local', new TextEncoder().encode(JSON.stringify({ version: 1, resetAt: Date.now() })).buffer);
    expect(await storage.compareAndSwapRecords!(resetGuards)).toBe(false); await expect(registry.prepareVerifiedFileGuards('contact', 'A')).rejects.toThrow('Verified unchanged');
});
