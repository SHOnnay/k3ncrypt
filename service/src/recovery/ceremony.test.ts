import { RecoveryCeremony } from './ceremony';
import { RecoveryArchiveBoundary, WebCryptoRecoveryArchiveCrypto, rotateRecoveryArchive } from './archive';
import type { RecoveryArchive } from './contracts';

const archive: RecoveryArchive = { manifest: { version: 1, archiveId: 'archive-1', sourceScope: 'old', sourceEpoch: 2, sourceCommitment: 'a'.repeat(64), createdAt: 1, included: ['contacts'] }, ciphertext: new Uint8Array([1, 2]), integrity: 'opaque' };
describe('recovery ceremony', () => {
    it('requires user-owned material and explicit replacement confirmation', async () => {
        const claimed = new Set<string>(); let completed = false;
        const ceremony = new RecoveryCeremony({ verify: async (_archive, secret) => { if (secret.length < 16) throw new Error('invalid'); } }, { claim: async (id) => !claimed.has(id) && (claimed.add(id), true), stage: async () => undefined, complete: async () => { completed = true; }, reject: async () => undefined });
        await ceremony.stage(archive, new Uint8Array(16), { oldFingerprint: 'old', newFingerprint: 'new', replacementId: 'replacement-1' }); ceremony.requestReplacementConfirmation(); await ceremony.confirmReplacement(); expect(completed).toBe(true);
    });
    it('rejects replay and invalid material', async () => {
        const ceremony = new RecoveryCeremony({ verify: async () => { throw new Error('invalid'); } }, { claim: async () => true, stage: async () => undefined, complete: async () => undefined, reject: async () => undefined });
        await expect(ceremony.stage(archive, new Uint8Array(16), { oldFingerprint: 'old', newFingerprint: 'new', replacementId: 'replacement-1' })).rejects.toThrow('invalid');
    });

    it('seals, authenticates, expires and rotates a user-controlled archive', async () => {
        const profile = new WebCryptoRecoveryArchiveCrypto();
        const boundary = new RecoveryArchiveBoundary(profile);
        const manifest = { version: 1 as const, archiveId: 'archive-crypto', sourceScope: 'old-scope', sourceEpoch: 2, sourceCommitment: 'a'.repeat(64), createdAt: Date.now(), expiresAt: Date.now() + 60_000, included: ['contacts'] as const };
        const secret = new Uint8Array(32).fill(7);
        const plaintext = new Uint8Array([1, 2, 3, 4]);
        const archive = await boundary.create(manifest, plaintext, secret, true);
        await expect(profile.open(archive, new Uint8Array(32).fill(8))).rejects.toThrow();
        const opened = await profile.open(archive, new Uint8Array(32).fill(7));
        expect([...opened]).toEqual([1, 2, 3, 4]);
        const rotated = await rotateRecoveryArchive(archive, new Uint8Array(32).fill(7), new Uint8Array(32).fill(9), { ...manifest, archiveId: 'archive-crypto-rotated', sourceEpoch: 3 }, true, profile);
        await expect(profile.open(rotated, new Uint8Array(32).fill(9))).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
        const modified = { ...archive, ciphertext: archive.ciphertext.slice() }; modified.ciphertext[0] ^= 1;
        await expect(profile.open(modified, new Uint8Array(32).fill(7))).rejects.toThrow('integrity');
    });
});
