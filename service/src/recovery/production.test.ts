import { loadAccountBinding } from '../identity/accountBinding';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { createDeviceList } from '../devices/deviceList';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import { RecoveryArchiveBoundary, WebCryptoRecoveryArchiveCrypto } from './archive';
import { createProductionRecoveryRuntime, SecureStorageRecoveryAdapter } from './production';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });

it('does not consume failed material and atomically replaces identity, invalidates devices, resets trust and rejects replay', async () => {
    const vault = new BrowserSecureStorage(new MemoryVaultPersistence()); await vault.initializeWithPassphrase('test-only-recovery-storage');
    const binding = await loadAccountBinding(vault, 'identity-old');
    const lifecycle = new SecureStorageDeviceLifecyclePersistence(vault);
    const original = await lifecycle.initialize(binding.userScope, createDeviceList({ version: 1, identityReference: binding.userScope, epoch: 0, previousCommitment: null, devices: [createDeviceEntry({ deviceId: binding.deviceId, publicIdentityReference: 'identity-old', algorithm: 'v1', state: 'active', createdAt: 1 })] }));
    const manifest = { version: 1 as const, archiveId: 'archive-production-1', sourceScope: binding.userScope, sourceEpoch: 0, sourceCommitment: original.commitment, createdAt: Date.now(), expiresAt: Date.now() + 60_000, included: ['contacts'] as const };
    const secret = new Uint8Array(32).fill(9);
    const archive = await new RecoveryArchiveBoundary(new WebCryptoRecoveryArchiveCrypto()).create(manifest, new Uint8Array([1, 2, 3]), secret.slice(), true);
    const context = { oldFingerprint: 'identity-old', newFingerprint: 'identity-new', replacementId: 'replacement-production-1' };
    const failed = createProductionRecoveryRuntime(vault);
    await expect(failed.stage(archive, new Uint8Array(32).fill(8), context, true)).rejects.toThrow();
    expect(await new SecureStorageRecoveryAdapter(vault).readPending()).toBeUndefined();
    const runtime = createProductionRecoveryRuntime(vault); await runtime.stage(archive, secret.slice(), context, true);
    const restarted = createProductionRecoveryRuntime(vault);
    const result = await restarted.confirm(true); expect(result.invalidatedDeviceIds).toContain(binding.deviceId);
    const nextBinding = await loadAccountBinding(vault, 'identity-new'); expect(nextBinding.userScope).toBe(result.newScope);
    expect((await lifecycle.read(binding.userScope))?.list.devices.every((entry) => entry.state === 'revoked')).toBe(true);
    const replay = createProductionRecoveryRuntime(vault); await expect(replay.stage(archive, secret.slice(), context, true)).rejects.toThrow();
});
