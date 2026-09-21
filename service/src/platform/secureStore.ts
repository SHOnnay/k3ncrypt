import type { LocalEncryptionAdapter, SecureStorageAdapter } from './contracts';

const keyPattern = /^[A-Za-z0-9_-]{1,96}$/;
export class IsolatedSecureStore {
    public constructor(private readonly namespace: string, private readonly storage: SecureStorageAdapter, private readonly encryption: LocalEncryptionAdapter) { if (!keyPattern.test(namespace)) throw new Error('Secure storage namespace rejected.'); }
    private key(key: string): string { if (!keyPattern.test(key)) throw new Error('Secure storage access rejected.'); return `${this.namespace}:${key}`; }
    public async write(key: string, plaintext: Uint8Array): Promise<void> { if (plaintext.length === 0) throw new Error('Secure storage record rejected.'); const copy = plaintext.slice(); try { await this.storage.write(this.key(key), await this.encryption.encrypt(copy)); } finally { copy.fill(0); plaintext.fill(0); } }
    public async read(key: string): Promise<Uint8Array | undefined> { const ciphertext = await this.storage.read(this.key(key)); if (!ciphertext) return undefined; try { const plaintext = await this.encryption.decrypt(ciphertext); if (plaintext.length === 0) throw new Error(); return plaintext; } catch { throw new Error('Secure storage record unavailable.'); } }
    public async delete(key: string): Promise<void> { await this.storage.delete(this.key(key)); }
}

export const PLATFORM_STORAGE_PROFILES = Object.freeze(['android', 'ios', 'windows', 'macos', 'linux'].map((platform) => Object.freeze({ platform, keyIsolationRequired: true, encryptedAppPrivateStateRequired: true, backupExclusionRequired: true, secureDeletionBoundaryRequired: true })));
