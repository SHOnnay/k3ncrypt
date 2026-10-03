import { VodozemacRuntime } from './vodozemacRuntime';
import type { SecureStorage } from '../core/contracts';
import type { VodozemacAccountFactory, VodozemacAccountHandle } from '../identity/vodozemacIdentity';
import type { VodozemacSessionFactory } from '../identity/vodozemacSessionStore';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { VodozemacBoundaryError } from './vodozemacErrors';

// The production browser implementation supplies window.btoa; keep this unit test browser-independent.
Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64') } });

class MemoryStorage implements SecureStorage {
    private readonly records = new Map<string, ArrayBuffer>();
    private locked = false;
    public async compareAndSwapRecords(updates: readonly import('../core/contracts').SecureRecordUpdate[]): Promise<boolean> {
        if (updates.some((item) => !sameBytes(this.records.get(`${item.recordType}:${item.recordId}`), item.expected))) return false;
        for (const item of updates) this.records.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
        return true;
    }
    public async initializeWithPassphrase(): Promise<void> { this.locked = false; }
    public async unlock(): Promise<void> { this.locked = false; }
    public lock(): void { this.locked = true; }
    public async changeUnlockSecret(): Promise<void> {}
    public isLocked(): boolean { return this.locked; }
    public async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`)?.slice(0); }
    public async write(type: string, id: string, value: ArrayBuffer): Promise<void> { this.records.set(`${type}:${id}`, value.slice(0)); }
    public async delete(type: string, id: string): Promise<void> { this.records.delete(`${type}:${id}`); }
    public async withVodozemacPickleKey<T>(operation: (key: Uint8Array) => Promise<T>): Promise<T> {
        const key = new Uint8Array(32).fill(7);
        try { return await operation(key); } finally { key.fill(0); }
    }
    public seed(type: string, id: string, value: unknown): void {
        this.records.set(`${type}:${id}`, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer);
    }
    public has(type: string, id: string): boolean { return this.records.has(`${type}:${id}`); }
}

const sameBytes = (left: ArrayBuffer | undefined, right: ArrayBuffer | undefined): boolean => {
    if (left === undefined || right === undefined) return left === right;
    return Buffer.from(left).equals(Buffer.from(right));
};

const account = (): VodozemacAccountHandle => ({
    identityKeys: () => JSON.stringify({ curve25519: 'c'.repeat(44), ed25519: 'e'.repeat(44) }),
    generateOneTimeKeys: () => undefined,
    generateFallbackKey: () => undefined,
    saveAccount: () => 'encrypted-account-pickle',
    free: () => undefined,
});

const session = (): VodozemacSessionHandle => ({
    encrypt: (bytes) => Buffer.from(bytes).toString('base64'),
    decrypt: (wire) => new Uint8Array(Buffer.from(wire, 'base64')),
    sessionId: () => 'session-1',
    saveSession: () => new Uint8Array([1, 2, 3]),
    free: () => undefined,
});

const bindings = {
    protocolVersion: 1 as const,
    accountFactory: { createAccount: account, loadAccount: account } as VodozemacAccountFactory,
    sessionFactory: { loadSession: session } as VodozemacSessionFactory,
};

describe('VodozemacRuntime', () => {
    it('persists both facade mutations and invalidates retained handles on close', async () => {
        const storage = new MemoryStorage();
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await runtime.establishSession('conversation-1', session(), 'session-1');
        const write = jest.spyOn(storage, 'write');
        const facade = runtime.getAuthenticatedSession();
        const wire = await facade.encrypt('signaling', new TextEncoder().encode('control').buffer);
        await expect(facade.decrypt('signaling', wire)).resolves.toEqual(new TextEncoder().encode('control').buffer);
        expect(write.mock.calls.filter(([type]) => type === 'vodozemac-session')).toHaveLength(2);
        expect(write.mock.calls.filter(([type]) => type === 'vodozemac-commit')).toHaveLength(2);
        expect(storage.has('vodozemac-commit', 'local')).toBe(false);
        runtime.close();
        expect(facade.ready).toBe(false);
        await expect(facade.encrypt('signaling', new ArrayBuffer(0))).rejects.toThrow();
    });

    it('retains an interrupted mutation marker and discards unsafe ratchet state on restart', async () => {
        const storage = new MemoryStorage();
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await runtime.establishSession('conversation-1', session(), 'session-1');
        await runtime.persistSession();
        const originalDelete = storage.delete.bind(storage);
        jest.spyOn(storage, 'delete').mockImplementation(async (type, id) => {
            if (type === 'vodozemac-commit') throw new Error('simulated interruption');
            await originalDelete(type, id);
        });
        await expect(runtime.getAuthenticatedSession().encrypt('signaling', new ArrayBuffer(0))).rejects.toThrow();
        expect(storage.has('vodozemac-commit', 'local')).toBe(true);
        jest.restoreAllMocks();
        const restarted = new VodozemacRuntime(storage, async () => bindings);
        await restarted.initialize();
        expect(storage.has('vodozemac-session', 'conversation-1')).toBe(false);
    });
    it('enforces the explicit lifecycle and keeps operations unavailable before a session', async () => {
        const runtime = new VodozemacRuntime(new MemoryStorage(), async () => bindings);
        await expect(runtime.encrypt('message', new ArrayBuffer(0))).rejects.toMatchObject({ code: 'INVALID_LIFECYCLE' });
        await runtime.initialize();
        expect(runtime.lifecycle).toBe('crypto-ready');
        await runtime.restoreOrCreateIdentity();
        expect(runtime.lifecycle).toBe('identity-restored');
        await runtime.establishSession('conversation-1', session(), 'session-1');
        expect(runtime.lifecycle).toBe('active');
        const envelope = await runtime.encrypt('message', new TextEncoder().encode('hello').buffer);
        await expect(runtime.decrypt('message', envelope)).resolves.toEqual(new TextEncoder().encode('hello').buffer);
        await runtime.persistSession();
        expect(runtime.lifecycle).toBe('persisted');
        runtime.close();
        expect(runtime.lifecycle).toBe('closed');
    });

    it('fails closed when the local crypto module cannot initialize', async () => {
        const runtime = new VodozemacRuntime(new MemoryStorage(), async () => {
            throw new Error('module unavailable');
        });
        await expect(runtime.initialize()).rejects.toMatchObject({ code: 'WASM_INIT_FAILED' });
        expect(runtime.lifecycle).toBe('error');
    });

    it('rejects unsupported protocol versions without exposing details', async () => {
        const runtime = new VodozemacRuntime(new MemoryStorage(), async () => ({ ...bindings, protocolVersion: 2 as 1 }));
        await expect(runtime.initialize()).rejects.toBeInstanceOf(VodozemacBoundaryError);
        await expect(runtime.initialize()).rejects.toMatchObject({ code: 'INVALID_LIFECYCLE' });
    });

    it('recovers an incomplete account/session commit deterministically without reusing the session', async () => {
        const storage = new MemoryStorage();
        storage.seed('vodozemac-commit', 'local', { version: 1, conversationId: 'conversation-1', sessionId: 'session-1', phase: 'account-written' });
        await storage.write('vodozemac-session', 'conversation-1', new Uint8Array([1, 2, 3]).buffer);
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize();
        expect(storage.has('vodozemac-commit', 'local')).toBe(false);
        await expect(storage.read('vodozemac-session', 'conversation-1')).resolves.toBeUndefined();
    });

    it('reports a missing saved session without changing the conversation reference', async () => {
        const storage = new MemoryStorage();
        storage.seed('conversation-protocol', 'conversation-1', { version: 1, mode: 'modern', sessionId: 'session-1' });
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await expect(runtime.restoreSession('conversation-1', 'session-1')).rejects.toMatchObject({
            code: 'CORRUPTED_SESSION', restoreFailureCategory: 'session-record-missing',
        });
        expect(storage.has('conversation-protocol', 'conversation-1')).toBe(true);
    });

    it('fails closed when ratchet persistence fails after encryption mutation', async () => {
        class FailingStorage extends MemoryStorage {
            public async write(type: string, id: string, value: ArrayBuffer): Promise<void> {
                if (type === 'vodozemac-session') throw new Error('disk full');
                return super.write(type, id, value);
            }
        }
        const storage = new FailingStorage();
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        await runtime.establishSession('conversation-1', session(), 'session-1');
        await expect(runtime.encrypt('message', new TextEncoder().encode('secret').buffer)).rejects.toMatchObject({ code: 'CORRUPTED_SESSION' });
        expect(runtime.lifecycle).toBe('error');
    });
});

describe('Stage 0 mutation crash and concurrency characterization', () => {
    it.each(['before-encrypt', 'session-write', 'marker-delete'])('restart at %s never silently reuses an interrupted session', async (point) => {
        const storage = new MemoryStorage();
        let mutations = 0;
        const handle = { ...session(), encrypt: () => { mutations++; return 'opaque'; } };
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize(); await runtime.restoreOrCreateIdentity();
        await runtime.establishSession('conversation-1', handle, 'session-1');
        await runtime.persistSession();
        const write = storage.write.bind(storage); const remove = storage.delete.bind(storage);
        jest.spyOn(storage, 'write').mockImplementation(async (type, id, bytes) => {
            if ((point === 'before-encrypt' && type === 'vodozemac-commit') || (point === 'session-write' && type === 'vodozemac-session')) throw new Error('injected');
            return write(type, id, bytes);
        });
        jest.spyOn(storage, 'delete').mockImplementation(async (type, id) => {
            if (point === 'marker-delete' && type === 'vodozemac-commit') throw new Error('injected');
            return remove(type, id);
        });
        await expect(runtime.encrypt('message', new ArrayBuffer(0))).rejects.toThrow();
        expect(mutations).toBe(point === 'before-encrypt' ? 0 : 1);
        jest.restoreAllMocks();
        runtime.close();
        const restarted = new VodozemacRuntime(storage, async () => bindings);
        await restarted.initialize();
        expect(storage.has('vodozemac-session', 'conversation-1')).toBe(point === 'before-encrypt');
        expect(storage.has('vodozemac-commit', 'local')).toBe(false);
        restarted.close();
    });

    it('message and call/control facade mutations serialize within one runtime', async () => {
        const storage = new MemoryStorage();
        const runtime = new VodozemacRuntime(storage, async () => bindings);
        await runtime.initialize(); await runtime.restoreOrCreateIdentity();
        let counter = 0;
        await runtime.establishSession('conversation-1', { ...session(), encrypt: () => String(++counter) }, 'session-1');
        const writes: string[] = [];
        const write = storage.write.bind(storage);
        jest.spyOn(storage, 'write').mockImplementation(async (type, id, bytes) => { writes.push(type); await Promise.resolve(); return write(type, id, bytes); });
        await Promise.all([runtime.encrypt('message', new ArrayBuffer(0)), runtime.getAuthenticatedSession().encrypt('signaling', new ArrayBuffer(0))]);
        expect(counter).toBe(2);
        expect(writes).toEqual(['vodozemac-commit', 'vodozemac-session', 'vodozemac-commit', 'vodozemac-session']);
        runtime.close(); jest.restoreAllMocks();
    });

    it('atomic message commit rejects a stale restored runtime without overwriting the newer outbox/session', async () => {
        const storage = new MemoryStorage();
        const counterSession = (value = 0): VodozemacSessionHandle => ({ ...session(), encrypt: () => String(++value), saveSession: () => new Uint8Array([value]) });
        const counterBindings = { ...bindings, sessionFactory: { loadSession: (bytes: Uint8Array) => counterSession(bytes[0]) } };
        const a = new VodozemacRuntime(storage, async () => counterBindings);
        await a.initialize(); await a.restoreOrCreateIdentity();
        await a.establishSession('conversation-1', counterSession(), 'session-1'); await a.persistSession();
        const b = new VodozemacRuntime(storage, async () => counterBindings);
        await b.initialize(); await b.restoreOrCreateIdentity(); await b.restoreSession('conversation-1', 'session-1');
        const outboxExpected = new TextEncoder().encode('[]').buffer as ArrayBuffer;
        await storage.write('modern-outbox', 'conversation-1', outboxExpected);
        const nextOutbox = (envelope: unknown, clientId: string) => new TextEncoder().encode(JSON.stringify([{ envelope, clientId }])).buffer as ArrayBuffer;
        await a.encryptMessageWithAtomicRecords(new ArrayBuffer(0), (envelope) => [{ recordType: 'modern-outbox', recordId: 'conversation-1', expected: outboxExpected, next: nextOutbox(envelope, 'first') }]);
        const committedSession = await storage.read('vodozemac-session', 'conversation-1');
        const committedOutbox = await storage.read('modern-outbox', 'conversation-1');
        expect(new Uint8Array(committedSession!)[0]).toBe(1);
        await expect(b.encryptMessageWithAtomicRecords(new ArrayBuffer(0), (envelope) => [{ recordType: 'modern-outbox', recordId: 'conversation-1', expected: outboxExpected, next: nextOutbox(envelope, 'stale') }]))
            .rejects.toMatchObject({ code: 'CORRUPTED_SESSION' });
        expect(b.lifecycle).toBe('error');
        expect(sameBytes(await storage.read('vodozemac-session', 'conversation-1'), committedSession)).toBe(true);
        expect(sameBytes(await storage.read('modern-outbox', 'conversation-1'), committedOutbox)).toBe(true);
        a.close(); b.close();
    });

    it('atomic message commit abort restores the original in-memory session for retry', async () => {
        class OneAbortStorage extends MemoryStorage {
            public fail = true;
            public async compareAndSwapRecords(updates: readonly import('../core/contracts').SecureRecordUpdate[]): Promise<boolean> {
                if (this.fail) { this.fail = false; return false; }
                return super.compareAndSwapRecords(updates);
            }
        }
        const storage = new OneAbortStorage();
        const counterSession = (value = 0): VodozemacSessionHandle => ({ ...session(), encrypt: () => `wire-${++value}`, saveSession: () => new Uint8Array([value]) });
        const counterBindings = { ...bindings, sessionFactory: { loadSession: (bytes: Uint8Array) => counterSession(bytes[0]) } };
        const runtime = new VodozemacRuntime(storage, async () => counterBindings);
        await runtime.initialize(); await runtime.restoreOrCreateIdentity();
        await runtime.establishSession('conversation-1', counterSession(), 'session-1'); await runtime.persistSession();
        const before = await storage.read('vodozemac-session', 'conversation-1');
        const additional = (envelope: unknown) => [{ recordType: 'modern-outbox', recordId: 'conversation-1', expected: undefined,
            next: new TextEncoder().encode(JSON.stringify([{ envelope, clientId: 'retry' }])).buffer as ArrayBuffer }];
        await expect(runtime.encryptMessageWithAtomicRecords(new ArrayBuffer(0), additional)).rejects.toMatchObject({ code: 'CORRUPTED_SESSION' });
        expect(sameBytes(await storage.read('vodozemac-session', 'conversation-1'), before)).toBe(true);
        expect(await storage.read('modern-outbox', 'conversation-1')).toBeUndefined();
        expect(runtime.lifecycle).toBe('active');
        await runtime.encryptMessageWithAtomicRecords(new ArrayBuffer(0), additional);
        expect(new Uint8Array((await storage.read('vodozemac-session', 'conversation-1'))!)[0]).toBe(1);
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', 'conversation-1'))!))[0].envelope.data.olmMessage).toBe('wire-1');
        runtime.close();
    });

    it('keeps the existing standalone signaling mutation path outside outbound outbox atomicity', async () => {
        const storage = new MemoryStorage();
        const counterSession = (value = 0): VodozemacSessionHandle => ({ ...session(), encrypt: () => `signal-${++value}`, saveSession: () => new Uint8Array([value]) });
        const counterBindings = { ...bindings, sessionFactory: { loadSession: (bytes: Uint8Array) => counterSession(bytes[0]) } };
        const first = new VodozemacRuntime(storage, async () => counterBindings);
        await first.initialize(); await first.restoreOrCreateIdentity();
        await first.establishSession('conversation-1', counterSession(), 'session-1'); await first.persistSession();
        const stale = new VodozemacRuntime(storage, async () => counterBindings);
        await stale.initialize(); await stale.restoreOrCreateIdentity(); await stale.restoreSession('conversation-1', 'session-1');
        await first.encrypt('signaling', new ArrayBuffer(0));
        await first.encrypt('signaling', new ArrayBuffer(0));
        await stale.encrypt('signaling', new ArrayBuffer(0));
        expect(new Uint8Array((await storage.read('vodozemac-session', 'conversation-1'))!)[0]).toBe(1);
        first.close(); stale.close();
    });

    it('identity-wide interrupted marker is shared by conversations (known gap)', async () => {
        const storage = new MemoryStorage();
        const a = new VodozemacRuntime(storage, async () => bindings);
        const b = new VodozemacRuntime(storage, async () => bindings);
        for (const runtime of [a, b]) { await runtime.initialize(); await runtime.restoreOrCreateIdentity(); }
        await a.establishSession('a', session(), 'session-1'); await a.persistSession();
        await b.establishSession('b', session(), 'session-1'); await b.persistSession();
        const write = storage.write.bind(storage);
        jest.spyOn(storage, 'write').mockImplementation(async (type, id, bytes) => { if (type === 'vodozemac-session' && id === 'a') throw new Error('injected'); return write(type, id, bytes); });
        await expect(a.encrypt('message', new ArrayBuffer(0))).rejects.toThrow();
        expect(storage.has('vodozemac-commit', 'local')).toBe(true);
        await b.encrypt('signaling', new ArrayBuffer(0));
        expect(storage.has('vodozemac-commit', 'local')).toBe(false); // b erased a's interruption evidence
        a.close(); b.close(); jest.restoreAllMocks();
    });
});
