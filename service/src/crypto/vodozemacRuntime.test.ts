import { VodozemacRuntime } from './vodozemacRuntime';
import type { SecureRecordUpdate, SecureStorage } from '../core/contracts';
import type { VodozemacAccountFactory, VodozemacAccountHandle } from '../identity/vodozemacIdentity';
import type { VodozemacSessionFactory } from '../identity/vodozemacSessionStore';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { VodozemacBoundaryError } from './vodozemacErrors';

// The production browser implementation supplies window.btoa; keep this unit test browser-independent.
Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64') } });

class MemoryStorage implements SecureStorage {
    private readonly records = new Map<string, ArrayBuffer>();
    private locked = false;
    public async initializeWithPassphrase(): Promise<void> { this.locked = false; }
    public async unlock(): Promise<void> { this.locked = false; }
    public lock(): void { this.locked = true; }
    public async changeUnlockSecret(): Promise<void> {}
    public isLocked(): boolean { return this.locked; }
    public async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`); }
    public async write(type: string, id: string, value: ArrayBuffer): Promise<void> { this.records.set(`${type}:${id}`, value.slice(0)); }
    public async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
        for (const update of updates) {
            const current = await this.read(update.recordType, update.recordId);
            if (current === undefined ? update.expected !== undefined : update.expected === undefined || !Buffer.from(current).equals(Buffer.from(update.expected))) return false;
        }
        for (const update of updates) await this.write(update.recordType, update.recordId, update.next);
        return true;
    }
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

class ContendedAccountStorage extends MemoryStorage {
    private firstPairCount = 0;
    private releasePair!: () => void;
    private releaseFirst!: () => void;
    private readonly pairReady = new Promise<void>(resolve => { this.releasePair = resolve; });
    private readonly firstDone = new Promise<void>(resolve => { this.releaseFirst = resolve; });
    public override async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
        if (updates[0]?.recordType === 'vodozemac-account' && this.firstPairCount < 2) {
            const slot = ++this.firstPairCount;
            if (slot === 2) this.releasePair();
            await this.pairReady;
            if (slot === 2) await this.firstDone;
            const committed = await super.compareAndSwapRecords(updates);
            if (slot === 1) this.releaseFirst();
            return committed;
        }
        return super.compareAndSwapRecords(updates);
    }
}

class ExhaustedAccountCasStorage extends MemoryStorage {
    public accountConflictsRemaining = 0;
    public override async read(type: string, id: string): Promise<ArrayBuffer | undefined> {
        return (await super.read(type, id))?.slice(0);
    }
    public override async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
        if (updates[0]?.recordType === 'vodozemac-account' && this.accountConflictsRemaining > 0) {
            this.accountConflictsRemaining -= 1;
            const current = await this.read('vodozemac-account', 'local');
            if (!current) return false;
            const state = JSON.parse(new TextDecoder().decode(current)) as { oneTimeKeys: string[]; conflictVersion?: number };
            this.seed('vodozemac-account', 'local', { ...state, conflictVersion: (state.conflictVersion ?? 0) + 1 });
            return false;
        }
        return super.compareAndSwapRecords(updates);
    }
}

const concurrentFirstPrekeyBindings = (attempts: Map<string, number>) => {
    const makeAccount = (initial: { oneTimeKeys: string[] }): VodozemacAccountHandle => {
        const state = { oneTimeKeys: [...initial.oneTimeKeys] };
        return {
            identityKeys: () => JSON.stringify({ curve25519: 'c'.repeat(44), ed25519: 'e'.repeat(44) }),
            generateOneTimeKeys: () => undefined,
            generateFallbackKey: () => undefined,
            saveAccount: () => JSON.stringify(state),
            createInboundSession: (_senderIdentityKey, preKeyMessage) => {
                attempts.set(preKeyMessage, (attempts.get(preKeyMessage) ?? 0) + 1);
                const key = `otk-${preKeyMessage}`;
                if (!state.oneTimeKeys.includes(key)) throw new Error('One-time key was already consumed.');
                state.oneTimeKeys = state.oneTimeKeys.filter(item => item !== key);
                const plaintext = new TextEncoder().encode(`first-prekey:${preKeyMessage}`);
                return { takeSession: () => session(), plaintext: () => plaintext.slice() };
            },
        };
    };
    return {
        protocolVersion: 1 as const,
        accountFactory: {
            createAccount: () => makeAccount({ oneTimeKeys: ['otk-bob', 'otk-carol'] }),
            loadAccount: (pickle: string) => makeAccount(JSON.parse(pickle) as { oneTimeKeys: string[] }),
        },
        sessionFactory: { loadSession: session },
    };
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

    it('retries concurrent first-prekey acceptance from the fresh account and commits both rooms', async () => {
        const storage = new ContendedAccountStorage();
        storage.seed('vodozemac-account', 'local', { oneTimeKeys: ['otk-bob', 'otk-carol'] });
        const attempts = new Map<string, number>();
        const factory = concurrentFirstPrekeyBindings(attempts);
        const bobRuntime = new VodozemacRuntime(storage, async () => factory);
        const carolRuntime = new VodozemacRuntime(storage, async () => factory);
        await Promise.all([bobRuntime.initialize(), carolRuntime.initialize()]);
        await Promise.all([bobRuntime.restoreOrCreateIdentity(), carolRuntime.restoreOrCreateIdentity()]);

        const accepted: string[] = [];
        const accept = (room: string, sender: string): (() => Promise<readonly SecureRecordUpdate[]>) => async () => {
            const expected = await storage.read('accepted-first-prekey', room);
            const value = new TextEncoder().encode(JSON.stringify({ room, sender })).buffer as ArrayBuffer;
            return [{ recordType: 'accepted-first-prekey', recordId: room, expected, next: value }];
        };
        await Promise.all([
            bobRuntime.establishInboundSessionAndCommit('room-bob', 'sender-bob', 'bob', async (plaintext) => {
                expect(new TextDecoder().decode(plaintext)).toBe('first-prekey:bob');
                return accept('room-bob', 'sender-bob')();
            }).then(() => accepted.push('room-bob')),
            carolRuntime.establishInboundSessionAndCommit('room-carol', 'sender-carol', 'carol', async (plaintext) => {
                expect(new TextDecoder().decode(plaintext)).toBe('first-prekey:carol');
                return accept('room-carol', 'sender-carol')();
            }).then(() => accepted.push('room-carol')),
        ]);

        expect(accepted.sort()).toEqual(['room-bob', 'room-carol']);
        expect(storage.has('vodozemac-session', 'room-bob')).toBe(true);
        expect(storage.has('vodozemac-session', 'room-carol')).toBe(true);
        expect(storage.has('accepted-first-prekey', 'room-bob')).toBe(true);
        expect(storage.has('accepted-first-prekey', 'room-carol')).toBe(true);
        expect([attempts.get('bob'), attempts.get('carol')].sort()).toEqual([1, 2]);
        const durableAccount = await storage.read('vodozemac-account', 'local');
        expect(JSON.parse(new TextDecoder().decode(durableAccount!)).oneTimeKeys).toEqual([]);
        new Uint8Array(durableAccount!).fill(0);
    });

    it('keeps exhausted first-prekey CAS contention retryable and accepts after mailbox redelivery', async () => {
        const storage = new ExhaustedAccountCasStorage();
        storage.seed('vodozemac-account', 'local', { oneTimeKeys: ['otk-bob'] });
        const attempts = new Map<string, number>();
        const factory = concurrentFirstPrekeyBindings(attempts);
        const runtime = new VodozemacRuntime(storage, async () => factory);
        await runtime.initialize();
        await runtime.restoreOrCreateIdentity();
        storage.accountConflictsRemaining = 4;

        const buildUpdates = async (plaintext: ArrayBuffer): Promise<readonly SecureRecordUpdate[]> => {
            expect(new TextDecoder().decode(plaintext)).toBe('first-prekey:bob');
            return [{ recordType: 'accepted-first-prekey', recordId: 'room-bob',
                expected: await storage.read('accepted-first-prekey', 'room-bob'),
                next: new TextEncoder().encode(JSON.stringify({ room: 'room-bob', sender: 'sender-bob' })).buffer as ArrayBuffer }];
        };
        await expect(runtime.establishInboundSessionAndCommit('room-bob', 'sender-bob', 'bob', buildUpdates)).rejects.toThrow();
        expect(storage.has('accepted-first-prekey', 'room-bob')).toBe(false);
        expect(storage.has('vodozemac-session', 'room-bob')).toBe(false);
        expect(attempts.get('bob')).toBe(4);
        const afterExhaustion = await storage.read('vodozemac-account', 'local');
        expect(JSON.parse(new TextDecoder().decode(afterExhaustion!)).oneTimeKeys).toEqual(['otk-bob']);
        new Uint8Array(afterExhaustion!).fill(0);

        await runtime.establishInboundSessionAndCommit('room-bob', 'sender-bob', 'bob', buildUpdates);
        expect(storage.has('accepted-first-prekey', 'room-bob')).toBe(true);
        expect(storage.has('vodozemac-session', 'room-bob')).toBe(true);
        expect(attempts.get('bob')).toBe(5);
    });
});
