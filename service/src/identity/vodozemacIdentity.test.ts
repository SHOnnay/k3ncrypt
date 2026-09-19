import { webcrypto } from 'crypto';

import type { ContactIdentity } from '../core/contracts';
import { ContactIdentityRegistry } from './contactIdentityRegistry';
import { PersistentVodozemacIdentity, type VodozemacAccountFactory, type VodozemacAccountHandle } from './vodozemacIdentity';
import { MemoryVaultPersistence } from '../storage/persistence';
import { BrowserSecureStorage } from '../storage/secureVault';

if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
if (typeof window === 'undefined') {
    (globalThis as any).window = globalThis;
}

class FakeAccount implements VodozemacAccountHandle {
    public oneTimeKeys = 0;
    public fallback = false;
    public freed = false;

    constructor(public readonly id: string) {}
    public identityKeys(): string {
        return JSON.stringify({ curve25519: `curve-${this.id}`.padEnd(44, 'x'), ed25519: `ed-${this.id}`.padEnd(44, 'y') });
    }
    public generateOneTimeKeys(count: number): void { this.oneTimeKeys = count; }
    public generateFallbackKey(): void { this.fallback = true; }
    public saveAccount(pickleKey: Uint8Array): string { return `pickle:${this.id}:${pickleKey[0]}`; }
    public free(): void { this.freed = true; }
}

class FakeFactory implements VodozemacAccountFactory {
    public created = 0;
    public createAccount(): FakeAccount { return new FakeAccount(`identity-${++this.created}`); }
    public loadAccount(encryptedPickle: string, pickleKey: Uint8Array): FakeAccount {
        const match = /^pickle:(identity-\d+):(\d+)$/.exec(encryptedPickle);
        if (!match || Number(match[2]) !== pickleKey[0]) throw new Error('corrupted account pickle');
        return new FakeAccount(match[1]);
    }
}

const createVault = async () => {
    const persistence = new MemoryVaultPersistence();
    const vault = new BrowserSecureStorage(persistence);
    await vault.initializeWithPassphrase('correct horse battery staple');
    return { persistence, vault };
};

describe('PersistentVodozemacIdentity', () => {
    it('creates the account in the crypto core and restores the same public fingerprint after restart', async () => {
        const { persistence, vault } = await createVault();
        const factory = new FakeFactory();
        const firstManager = new PersistentVodozemacIdentity(vault, factory);
        const first = await firstManager.getOrCreate();
        expect(first.algorithm).toBe('Olm-Curve25519+Ed25519');
        expect(first.identityId).toMatch(/^K3 /);
        expect(factory.created).toBe(1);
        expect(persistence.inspectRecord('vodozemac-account:local')).not.toContain('pickle:identity-1');
        firstManager.lock();
        vault.lock();

        const restartedVault = new BrowserSecureStorage(persistence);
        await restartedVault.unlock('correct horse battery staple');
        const restartedManager = new PersistentVodozemacIdentity(restartedVault, factory);
        const restored = await restartedManager.getOrCreate();
        expect(restored).toEqual(first);
        expect(factory.created).toBe(1);
    });

    it('fails closed when encrypted account state decrypts to a corrupted vodozemac pickle', async () => {
        const { vault } = await createVault();
        await vault.write('vodozemac-account', 'local', new TextEncoder().encode('not-a-pickle').buffer as ArrayBuffer);
        const manager = new PersistentVodozemacIdentity(vault, new FakeFactory());
        await expect(manager.getOrCreate()).rejects.toThrow('corrupted account pickle');
    });
});

describe('ContactIdentityRegistry', () => {
    const identity = (id: string, byte: number, verification: ContactIdentity['verification'] = 'unverified'): ContactIdentity => ({
        identityId: id,
        algorithm: 'Olm-Curve25519+Ed25519',
        publicKey: new Uint8Array(64).fill(byte),
        verification,
    });

    it('emits an identity-change event and never silently overwrites a verified identity', async () => {
        const { vault } = await createVault();
        const registry = new ContactIdentityRegistry(vault, () => 12345);
        await registry.observe('alice', identity('alice-key-1', 1));
        await registry.markVerified('alice');

        const event = await registry.observe('alice', identity('alice-key-2', 2));
        expect(event.kind).toBe('identity-changed');
        if (event.kind === 'identity-changed') {
            expect(event.current.identityId).toBe('alice-key-1');
            expect(event.current.verification).toBe('unverified');
            expect(event.current.pendingIdentity?.identityId).toBe('alice-key-2');
            expect(event.current.identityChangedAt).toBe(12345);
            expect(event.verifiedIdentityPreserved).toBe(true);
        }
    });

    it('requires explicit acceptance and resets verification for a changed identity', async () => {
        const { vault } = await createVault();
        const registry = new ContactIdentityRegistry(vault);
        await registry.observe('bob', identity('bob-key-1', 3));
        await registry.observe('bob', identity('bob-key-2', 4));
        await registry.acceptPendingChange('bob');

        const event = await registry.observe('bob', identity('bob-key-2', 4));
        expect(event.kind).toBe('unchanged');
        expect(event.current.identityId).toBe('bob-key-2');
        expect(event.current.verification).toBe('unverified');
    });
});
