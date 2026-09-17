import { VodozemacCryptoSession, VODOZEMAC_ENVELOPE_VERSION, VODOZEMAC_STRATEGY_ID, type VodozemacSessionHandle } from './vodozemacCryptoSession';

class TestHandle implements VodozemacSessionHandle {
    private counter = 0;
    private readonly seen = new Set<string>();
    public freed = false;

    public encrypt(plaintext: Uint8Array): string {
        return JSON.stringify({ id: ++this.counter, plaintext: Array.from(plaintext) });
    }

    public decrypt(wireMessage: string): Uint8Array {
        if (this.seen.has(wireMessage)) {
            throw new Error('duplicate');
        }
        this.seen.add(wireMessage);
        const value = JSON.parse(wireMessage);
        return Uint8Array.from(value.plaintext);
    }

    public sessionId(): string { return 'session-id'; }
    public saveSession(): Uint8Array { return new Uint8Array([1]); }
    public free(): void { this.freed = true; }
}

describe('VodozemacCryptoSession', () => {
    it('uses an explicit protocol format distinct from legacy and round-trips bytes', async () => {
        const session = new VodozemacCryptoSession(new TestHandle());
        await session.initialize('session-id');
        const plaintext = new TextEncoder().encode('hello').buffer as ArrayBuffer;
        const envelope = await session.encrypt('message', plaintext);

        expect(envelope.version).toBe(VODOZEMAC_ENVELOPE_VERSION);
        expect(envelope.strategy).toBe(VODOZEMAC_STRATEGY_ID);
        await expect(session.decrypt('message', envelope)).resolves.toEqual(plaintext);
    });

    it('rejects session identity, protocol, unknown fields, channel swaps, and duplicates', async () => {
        const session = new VodozemacCryptoSession(new TestHandle());
        await expect(session.initialize('wrong-session')).rejects.toThrow('identity mismatch');
        await session.initialize('session-id');
        const envelope = await session.encrypt('message', new Uint8Array([7]).buffer);
        await expect(session.decrypt('signaling', envelope)).rejects.toThrow('channel binding');
        await expect(session.decrypt('message', { ...envelope, version: 99 })).rejects.toThrow('Unsupported');
        await expect(session.decrypt('message', { ...envelope, data: { ...(envelope.data as object), critical: true } })).rejects.toThrow('Malformed');
        const fresh = await session.encrypt('message', new Uint8Array([8]).buffer);
        await session.decrypt('message', fresh);
        await expect(session.decrypt('message', fresh)).rejects.toThrow('duplicate');
    });

    it('destroys the opaque WASM handle and fails closed afterward', async () => {
        const handle = new TestHandle();
        const session = new VodozemacCryptoSession(handle);
        await session.initialize('session-id');
        session.destroy();

        expect(handle.freed).toBe(true);
        expect(session.ready).toBe(false);
        await expect(session.encrypt('message', new ArrayBuffer(0))).rejects.toThrow('not initialized');
    });
});
