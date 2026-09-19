import { loadVodozemacBindings } from './vodozemacModule';
import { VodozemacRuntime } from '@chat-e2ee/service';
import type { SecureStorage } from '@chat-e2ee/service';

const root = document.getElementById('crypto-smoke');
if (!root) throw new Error('Crypto smoke root is missing.');

class SmokeStorage implements SecureStorage {
    private readonly records = new Map<string, ArrayBuffer>();
    public async initializeWithPassphrase(): Promise<void> {}
    public async unlock(): Promise<void> {}
    public lock(): void {}
    public async changeUnlockSecret(): Promise<void> {}
    public isLocked(): boolean { return false; }
    public async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`); }
    public async write(type: string, id: string, value: ArrayBuffer): Promise<void> { this.records.set(`${type}:${id}`, value.slice(0)); }
    public async delete(type: string, id: string): Promise<void> { this.records.delete(`${type}:${id}`); }
    public async withVodozemacPickleKey<T>(operation: (key: Uint8Array) => Promise<T>): Promise<T> {
        const key = new Uint8Array(32).fill(3);
        try { return await operation(key); } finally { key.fill(0); }
    }
}

loadVodozemacBindings().then(async (bindings) => {
    const runtime = new VodozemacRuntime(new SmokeStorage(), loadVodozemacBindings);
    await runtime.initialize();
    const identity = await runtime.restoreOrCreateIdentity();
    root.dataset.status = 'ready';
    root.dataset.lifecycle = runtime.lifecycle;
    root.dataset.publicIdentityLength = String(identity.publicKey.byteLength);
    root.dataset.exposesPrivateMaterial = String(Object.keys(bindings.accountFactory).some((key) => /private|pickle|secret/i.test(key)));
    runtime.close();
}).catch((error: unknown) => {
    root.dataset.status = 'error';
    root.dataset.error = error instanceof Error ? error.message : 'Crypto initialization failed.';
});
