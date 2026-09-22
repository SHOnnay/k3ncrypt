import type { RecoveryArchive, RecoveryArchiveCrypto, RecoveryArchiveManifest } from './contracts';

const id = /^[A-Za-z0-9_-]{8,128}$/;
const commitment = /^[0-9a-f]{64}$/;
const allowed = new Set(['contacts', 'history', 'preferences']);

export const validateRecoveryArchive = (archive: RecoveryArchive, now = Date.now()): void => {
    const manifest = archive?.manifest;
    if (!manifest || manifest.version !== 1 || !id.test(manifest.archiveId) || !id.test(manifest.sourceScope) || !Number.isSafeInteger(manifest.sourceEpoch) || manifest.sourceEpoch < 0 || !commitment.test(manifest.sourceCommitment) || !Number.isSafeInteger(manifest.createdAt) || manifest.createdAt > now || manifest.expiresAt !== undefined && (!Number.isSafeInteger(manifest.expiresAt) || manifest.expiresAt <= now) || !Array.isArray(manifest.included) || manifest.included.length === 0 || new Set(manifest.included).size !== manifest.included.length || manifest.included.some((entry) => !allowed.has(entry)) || !(archive.ciphertext instanceof Uint8Array) || archive.ciphertext.length < 16 || archive.ciphertext.length > 64 * 1024 * 1024 || !id.test(archive.integrity)) throw new Error('Recovery archive rejected.');
};

const canonical = (manifest: RecoveryArchiveManifest): Uint8Array => new TextEncoder().encode(JSON.stringify({ version: 1, archiveId: manifest.archiveId, sourceScope: manifest.sourceScope, sourceEpoch: manifest.sourceEpoch, sourceCommitment: manifest.sourceCommitment, createdAt: manifest.createdAt, ...(manifest.expiresAt === undefined ? {} : { expiresAt: manifest.expiresAt }), included: [...manifest.included].sort() }));
const bufferSource = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const digest = async (value: Uint8Array): Promise<string> => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bufferSource(value)));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const derive = async (secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> => {
    const material = await crypto.subtle.importKey('raw', bufferSource(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bufferSource(salt), iterations: 150_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

/** Concrete user-controlled archive profile. The server sees only this opaque package. */
export class WebCryptoRecoveryArchiveCrypto implements RecoveryArchiveCrypto {
    public async seal(manifest: RecoveryArchiveManifest, plaintext: Uint8Array, secret: Uint8Array): Promise<RecoveryArchive> {
        if (secret.length < 16 || plaintext.length === 0) throw new Error('Recovery archive rejected.');
        validateRecoveryArchive({ manifest, ciphertext: new Uint8Array(16), integrity: '0'.repeat(64) }, manifest.createdAt);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const key = await derive(secret, salt);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bufferSource(nonce), additionalData: bufferSource(canonical(manifest)) }, key, bufferSource(plaintext)));
        const packed = new Uint8Array(salt.length + nonce.length + ciphertext.length);
        packed.set(salt, 0); packed.set(nonce, salt.length); packed.set(ciphertext, salt.length + nonce.length);
        const integrity = await digest(new Uint8Array([...canonical(manifest), ...packed]));
        return Object.freeze({ manifest, ciphertext: packed, integrity });
    }

    public async open(archive: RecoveryArchive, secret: Uint8Array): Promise<Uint8Array> {
        validateRecoveryArchive(archive);
        if (secret.length < 16 || archive.ciphertext.length < 44) throw new Error('Recovery archive rejected.');
        const expected = await digest(new Uint8Array([...canonical(archive.manifest), ...archive.ciphertext]));
        if (expected !== archive.integrity) throw new Error('Recovery archive integrity rejected.');
        const packed = archive.ciphertext;
        const key = await derive(secret, packed.slice(0, 16));
        try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bufferSource(packed.slice(16, 28)), additionalData: bufferSource(canonical(archive.manifest)) }, key, bufferSource(packed.slice(28)))); }
        catch { throw new Error('Recovery archive decryption failed.'); }
    }
}

export class RecoveryArchiveBoundary {
    public constructor(private readonly crypto: RecoveryArchiveCrypto) {}
    public async create(manifest: RecoveryArchiveManifest, plaintext: Uint8Array, secret: Uint8Array, userAction: boolean): Promise<RecoveryArchive> {
        if (!userAction || plaintext.length === 0 || secret.length < 16) throw new Error('Recovery export rejected.');
        try { const archive = await this.crypto.seal(manifest, plaintext, secret); validateRecoveryArchive(archive); return archive; } finally { plaintext.fill(0); secret.fill(0); }
    }
    public async open(archive: RecoveryArchive, secret: Uint8Array, userAction: boolean): Promise<Uint8Array> {
        if (!userAction || secret.length < 16) throw new Error('Recovery import rejected.');
        try { validateRecoveryArchive(archive); return await this.crypto.open(archive, secret); } finally { secret.fill(0); }
    }
}

export const rotateRecoveryArchive = async (archive: RecoveryArchive, oldSecret: Uint8Array, newSecret: Uint8Array, manifest: RecoveryArchiveManifest, userAction: boolean, cryptoProfile = new WebCryptoRecoveryArchiveCrypto()): Promise<RecoveryArchive> => {
    if (!userAction || newSecret.length < 16 || manifest.sourceScope !== archive.manifest.sourceScope || manifest.sourceEpoch <= archive.manifest.sourceEpoch) throw new Error('Recovery rotation rejected.');
    const plaintext = await cryptoProfile.open(archive, oldSecret);
    try { return await cryptoProfile.seal(manifest, plaintext, newSecret); } finally { plaintext.fill(0); oldSecret.fill(0); newSecret.fill(0); }
};
