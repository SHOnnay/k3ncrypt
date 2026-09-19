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
    public async initializeWithPassphrase(): Promise<void> { this.locked = false; }
    public async unlock(): Promise<void> { this.locked = false; }
    public lock(): void { this.locked = true; }
    public async changeUnlockSecret(): Promise<void> {}
    public isLocked(): boolean { return this.locked; }
    public async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`); }
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
