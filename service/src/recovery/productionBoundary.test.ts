import { RecoveryArchiveBoundary, validateRecoveryArchive } from './archive';
import { RecoveryIdentityReplacementWorkflow } from './replacement';
import type { RecoveryArchive, RecoveryArchiveManifest } from './contracts';

const manifest: RecoveryArchiveManifest = { version: 1, archiveId: 'archive_12345678', sourceScope: 'scope_12345678', sourceEpoch: 1, sourceCommitment: 'a'.repeat(64), createdAt: 1, included: ['contacts'] };
const archive: RecoveryArchive = { manifest, ciphertext: new Uint8Array(16), integrity: 'integrity_12345678' };
describe('production recovery boundaries', () => {
    it('rejects malformed and corrupted archives', () => { expect(() => validateRecoveryArchive({ ...archive, ciphertext: new Uint8Array(1) }, 10)).toThrow(); expect(() => validateRecoveryArchive({ ...archive, manifest: { ...manifest, sourceCommitment: 'bad' } }, 10)).toThrow(); });
    it('requires explicit user action and zeroizes the supplied secret', async () => { const secret = new Uint8Array(16).fill(7); const boundary = new RecoveryArchiveBoundary({ seal: async () => archive, open: async () => new Uint8Array([1]) }); await expect(boundary.open(archive, secret, false)).rejects.toThrow(); await boundary.open(archive, secret, true); expect(secret.every((value) => value === 0)).toBe(true); });
    it('creates a new scope, invalidates old devices, and resets contact trust', async () => { let reset = ''; const workflow = new RecoveryIdentityReplacementWorkflow({ replaceIdentity: async () => ({ newScope: 'new-scope', invalidatedDeviceIds: ['old-device'] }), resetContactTrust: async (scope) => { reset = scope; } }); await expect(workflow.replace({ oldFingerprint: 'old', newFingerprint: 'new', replacementId: 'replace-1' }, false)).rejects.toThrow(); await expect(workflow.replace({ oldFingerprint: 'old', newFingerprint: 'new', replacementId: 'replace-1' }, true)).resolves.toMatchObject({ newScope: 'new-scope' }); expect(reset).toBe('new-scope'); });
});
