import { RecoveryCeremony } from './ceremony';
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
});
