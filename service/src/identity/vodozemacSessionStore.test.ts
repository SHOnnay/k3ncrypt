import { webcrypto } from 'crypto';

import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { MemoryVaultPersistence } from '../storage/persistence';
import { BrowserSecureStorage } from '../storage/secureVault';
import { VodozemacSessionStore, type VodozemacSessionFactory } from './vodozemacSessionStore';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
if (typeof window === 'undefined') (globalThis as any).window = globalThis;

class StatefulSession implements VodozemacSessionHandle {
    constructor(public counter: number) {}
    encrypt(): string { return String(++this.counter); }
    decrypt(): Uint8Array { return new Uint8Array(); }
    sessionId(): string { return 'stable-session'; }
    saveSession(): Uint8Array { return new TextEncoder().encode(JSON.stringify({ counter: this.counter })); }
}

const factory: VodozemacSessionFactory = {
    loadSession(serialized): StatefulSession {
        const parsed = JSON.parse(new TextDecoder().decode(serialized));
        if (!Number.isInteger(parsed.counter)) throw new Error('corrupted session persistence');
        return new StatefulSession(parsed.counter);
    },
};

describe('VodozemacSessionStore', () => {
    it('restores ratchet state only after the application vault is unlocked', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase('correct horse battery staple');
        const store = new VodozemacSessionStore(vault, factory);
        const original = new StatefulSession(7);
        await store.save('alice-bob', original);
        expect(persistence.inspectRecord('vodozemac-session:alice-bob')).not.toContain('"counter":7');
        vault.lock();

        await expect(store.load('alice-bob')).rejects.toThrow('locked');
        const restartedVault = new BrowserSecureStorage(persistence);
        await restartedVault.unlock('correct horse battery staple');
        const restored = await new VodozemacSessionStore(restartedVault, factory).load('alice-bob') as StatefulSession;
        expect(restored.counter).toBe(7);
        expect(restored.encrypt()).toBe('8');
    });

    it('fails closed when session state is missing', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase('correct horse battery staple');
        await expect(new VodozemacSessionStore(vault, factory).load('missing')).rejects.toThrow('missing');
    });
});
