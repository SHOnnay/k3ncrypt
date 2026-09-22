import { webcrypto } from 'crypto';

import { MemoryVaultPersistence } from './persistence';
import { BrowserSecureStorage, PRODUCTION_ARGON2ID_PARAMETERS } from './secureVault';

if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
if (typeof window === 'undefined') {
    (globalThis as any).window = globalThis;
}

const passphrase = 'correct horse battery staple';
const nextPassword = 'a-new-long-password-value';
const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer;
const text = (value: ArrayBuffer): string => new TextDecoder().decode(value);

describe('BrowserSecureStorage', () => {
    it('uses the OWASP-minimum production Argon2id profile and persists only authenticated ciphertext', async () => {
        expect(PRODUCTION_ARGON2ID_PARAMETERS).toEqual({
            memoryKiB: 19_456,
            iterations: 2,
            parallelism: 1,
            hashLength: 32,
        });
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);

        await vault.initializeWithPassphrase(passphrase, 'passphrase');
        await vault.write('messaging-identity', 'local', bytes('private identity state'));

        const persisted = persistence.inspectRecord('messaging-identity:local');
        expect(persisted).toContain('AES-256-GCM');
        expect(persisted).not.toContain('private identity state');
        await expect(vault.read('messaging-identity', 'local')).resolves.toEqual(bytes('private identity state'));
    });

    it('locks, rejects sensitive APIs, and restores the same state after a restart', async () => {
        const persistence = new MemoryVaultPersistence();
        const first = new BrowserSecureStorage(persistence);
        await first.initializeWithPassphrase(passphrase);
        await first.write('vodozemac-session', 'alice-bob', bytes('ratchet state'));
        first.lock();

        expect(first.isLocked()).toBe(true);
        await expect(first.read('vodozemac-session', 'alice-bob')).rejects.toThrow('locked');
        await expect(first.write('secret', 'value', bytes('x'))).rejects.toThrow('locked');
        await expect(first.withVodozemacPickleKey(async () => undefined)).rejects.toThrow('locked');

        const restarted = new BrowserSecureStorage(persistence);
        await restarted.unlock(passphrase);
        const restored = await restarted.read('vodozemac-session', 'alice-bob');
        expect(text(restored!)).toBe('ratchet state');
    });

    it('fails closed for a wrong passphrase without exposing a partial plaintext', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        await vault.write('identity', 'local', bytes('never reveal this'));
        vault.lock();

        await expect(vault.unlock('incorrect passphrase value')).rejects.toThrow('Invalid unlock secret');
        expect(vault.isLocked()).toBe(true);
        await expect(vault.read('identity', 'local')).rejects.toThrow('locked');
    });

    it('detects a tampered wrapped Storage Master Key', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        vault.lock();
        const metadata = JSON.parse((await persistence.loadMetadata())!);
        const ciphertext = metadata.wrappedMasterKey.ciphertext;
        metadata.wrappedMasterKey.ciphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
        persistence.corruptMetadata(JSON.stringify(metadata));

        await expect(vault.unlock(passphrase)).rejects.toThrow(/Invalid unlock secret|Corrupted/);
        expect(vault.isLocked()).toBe(true);
    });

    it('detects record ciphertext modification', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        await vault.write('account', 'local', bytes('account pickle'));
        const envelope = JSON.parse(persistence.inspectRecord('account:local')!);
        const decoded = Buffer.from(envelope.ciphertext, 'base64url');
        decoded[Math.floor(decoded.length / 2)] ^= 0x01;
        envelope.ciphertext = decoded.toString('base64url');
        persistence.corruptRecord('account:local', JSON.stringify(envelope));

        await expect(vault.read('account', 'local')).rejects.toThrow(/authentication|Corrupted/);
    });

    it('binds ciphertext to its record type and identifier with AAD', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        await vault.write('account', 'alice', bytes('alice account'));
        const envelope = JSON.parse(persistence.inspectRecord('account:alice')!);
        envelope.recordType = 'session';
        envelope.recordId = 'alice';
        persistence.corruptRecord('session:alice', JSON.stringify(envelope));

        await expect(vault.read('session', 'alice')).rejects.toThrow('authentication failed');
    });

    it('uses a fresh 96-bit nonce for every record encryption', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        await vault.write('secret', 'same', bytes('same plaintext'));
        const first = JSON.parse(persistence.inspectRecord('secret:same')!);
        await vault.write('secret', 'same', bytes('same plaintext'));
        const second = JSON.parse(persistence.inspectRecord('secret:same')!);

        expect(first.nonce).not.toBe(second.nonce);
        expect(first.ciphertext).not.toBe(second.ciphertext);
        expect(Buffer.from(first.nonce.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toHaveLength(12);
    });

    it('rewraps the same master key when the unlock secret changes', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        await vault.write('identity', 'local', bytes('stable identity'));
        await vault.changeUnlockSecret(passphrase, nextPassword, 'password');
        vault.lock();

        await expect(vault.unlock(passphrase)).rejects.toThrow('Invalid unlock secret');
        await vault.unlock(nextPassword);
        expect(text((await vault.read('identity', 'local'))!)).toBe('stable identity');
    });

    it('requires at least eight numeric PIN digits and rejects mixed characters', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await expect(vault.initializeWithPassphrase('1234567', 'pin')).rejects.toThrow('8');
        await expect(vault.initializeWithPassphrase('1234567x', 'pin')).rejects.toThrow('numeric PIN');
        await expect(vault.initializeWithPassphrase('12345678', 'pin')).resolves.toBeUndefined();
    });

    it('rejects outdated formats and unknown envelope fields', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        vault.lock();
        const metadata = JSON.parse((await persistence.loadMetadata())!);
        metadata.storageVersion = 0;
        persistence.corruptMetadata(JSON.stringify(metadata));

        await expect(vault.unlock(passphrase)).rejects.toThrow('Unsupported secure-storage version');
    });

    it('derives a stable, separated pickle key and wipes each callback copy', async () => {
        const persistence = new MemoryVaultPersistence();
        const vault = new BrowserSecureStorage(persistence);
        await vault.initializeWithPassphrase(passphrase);
        let retainedReference: Uint8Array | undefined;
        const first = await vault.withVodozemacPickleKey(async (key) => {
            retainedReference = key;
            return Uint8Array.from(key);
        });
        const second = await vault.withVodozemacPickleKey(async (key) => Uint8Array.from(key));

        expect(first).toEqual(second);
        expect(first).toHaveLength(32);
        expect(retainedReference).toEqual(new Uint8Array(32));
    });
});
