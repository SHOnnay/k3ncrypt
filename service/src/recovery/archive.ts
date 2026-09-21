import type { RecoveryArchive, RecoveryArchiveCrypto, RecoveryArchiveManifest } from './contracts';

const id = /^[A-Za-z0-9_-]{8,128}$/;
const commitment = /^[0-9a-f]{64}$/;
const allowed = new Set(['contacts', 'history', 'preferences']);

export const validateRecoveryArchive = (archive: RecoveryArchive, now = Date.now()): void => {
    const manifest = archive?.manifest;
    if (!manifest || manifest.version !== 1 || !id.test(manifest.archiveId) || !id.test(manifest.sourceScope) || !Number.isSafeInteger(manifest.sourceEpoch) || manifest.sourceEpoch < 0 || !commitment.test(manifest.sourceCommitment) || !Number.isSafeInteger(manifest.createdAt) || manifest.createdAt > now || manifest.expiresAt !== undefined && (!Number.isSafeInteger(manifest.expiresAt) || manifest.expiresAt <= now) || manifest.included.length === 0 || new Set(manifest.included).size !== manifest.included.length || manifest.included.some((entry) => !allowed.has(entry)) || !(archive.ciphertext instanceof Uint8Array) || archive.ciphertext.length < 16 || archive.ciphertext.length > 64 * 1024 * 1024 || !id.test(archive.integrity)) throw new Error('Recovery archive rejected.');
};

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
