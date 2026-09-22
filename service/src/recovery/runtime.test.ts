import { RecoveryRuntime } from './runtime';
import { RecoveryArchiveBoundary, WebCryptoRecoveryArchiveCrypto } from './archive';
import type { RecoveryArchive, RecoveryPersistence } from './contracts';

const context = { oldFingerprint: 'old-fingerprint', newFingerprint: 'new-fingerprint', replacementId: 'replacement-1' };

const buildArchive = async (): Promise<{ archive: RecoveryArchive; secret: Uint8Array }> => {
    const secret = new Uint8Array(32).fill(7);
    const archive = await new RecoveryArchiveBoundary(new WebCryptoRecoveryArchiveCrypto()).create({ version: 1, archiveId: 'archive_runtime_1', sourceScope: 'scope_runtime_1', sourceEpoch: 1, sourceCommitment: 'a'.repeat(64), createdAt: Date.now(), expiresAt: Date.now() + 60_000, included: ['contacts'] }, new Uint8Array([1, 2, 3]), secret.slice(), true);
    return { archive, secret };
};

const persistence = (): RecoveryPersistence => {
    const claims = new Set<string>();
    return { claim: async (id) => !claims.has(id) && (claims.add(id), true), stage: async () => undefined, complete: async () => undefined, reject: async () => undefined };
};

describe('recovery runtime integration', () => {
    it('runs authenticated recovery through archive verification, ceremony and trust replacement', async () => {
        const { archive, secret } = await buildArchive(); let reset = '';
        const runtime = new RecoveryRuntime(persistence(), { replaceIdentity: async () => ({ newScope: 'new-scope', invalidatedDeviceIds: ['old-device'] }), resetContactTrust: async (scope) => { reset = scope; } }, { authorize: async (candidate, replacement) => { if (candidate.manifest.sourceScope !== 'scope_runtime_1' || replacement !== context) throw new Error('unauthorized'); } });
        await runtime.stage(archive, secret, context, true);
        await expect(runtime.confirm(true)).resolves.toEqual({ newScope: 'new-scope', invalidatedDeviceIds: ['old-device'] });
        expect(reset).toBe('new-scope');
    });

    it('rejects invalid archives, replay and unauthorized recovery', async () => {
        const built = await buildArchive();
        const runtime = new RecoveryRuntime(persistence(), { replaceIdentity: async () => ({ newScope: 'new', invalidatedDeviceIds: ['old'] }), resetContactTrust: async () => undefined }, { authorize: async () => undefined });
        const invalid = { ...built.archive, ciphertext: built.archive.ciphertext.slice() }; invalid.ciphertext[0] ^= 1;
        await expect(runtime.stage(invalid, built.secret.slice(), context, true)).rejects.toThrow();
        const store = persistence();
        const first = new RecoveryRuntime(store, { replaceIdentity: async () => ({ newScope: 'new', invalidatedDeviceIds: ['old'] }), resetContactTrust: async () => undefined }, { authorize: async () => undefined });
        await first.stage(built.archive, built.secret.slice(), context, true);
        const replay = new RecoveryRuntime(store, { replaceIdentity: async () => ({ newScope: 'new', invalidatedDeviceIds: ['old'] }), resetContactTrust: async () => undefined }, { authorize: async () => undefined });
        await expect(replay.stage(built.archive, built.secret.slice(), context, true)).rejects.toThrow('replayed');
        const unauthorized = new RecoveryRuntime(persistence(), { replaceIdentity: async () => ({ newScope: 'new', invalidatedDeviceIds: ['old'] }), resetContactTrust: async () => undefined }, { authorize: async () => { throw new Error('Recovery authority rejected.'); } });
        await expect(unauthorized.stage(built.archive, built.secret.slice(), context, true)).rejects.toThrow('authority');
    });
});
