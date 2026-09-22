import type { CryptoSession } from '../core/contracts';
import { loadAccountBinding } from '../identity/accountBinding';
import { BrowserSecureStorage } from '../storage/secureVault';
import { MemoryVaultPersistence } from '../storage/persistence';
import { DeviceContextAuthority } from './authenticatedContext';
import { createDeviceEntry } from './deviceIdentity';
import { createDeviceList } from './deviceList';
import { AuthenticatedDeviceJoinService } from './join';
import { createRevocationConfirmation, DeviceLifecycleService } from './lifecycle';
import { SecureStorageDeviceLifecyclePersistence } from './runtime';
import { DeviceTrustEnforcer } from './trust';

Object.defineProperty(globalThis, 'window', { configurable: true, value: { btoa: globalThis.btoa, atob: globalThis.atob } });
const session: CryptoSession = { ready: true, encrypted: true, initialize: async () => undefined, encrypt: async () => ({ version: 1, strategy: 'test', data: {} }), decrypt: async () => new ArrayBuffer(0), destroy: () => undefined };
const vault = async (secret: string) => { const value = new BrowserSecureStorage(new MemoryVaultPersistence()); await value.initializeWithPassphrase(secret); return value; };

it('completes target-side enrollment with independent storage and rejects fake target, wrong account, replay and duplicate device', async () => {
    const sourceVault = await vault('source-enrollment-vault'); const targetVault = await vault('target-enrollment-vault');
    const sourceBinding = await loadAccountBinding(sourceVault, 'identity-source'); const targetBinding = await loadAccountBinding(targetVault, 'identity-target');
    const sourcePersistence = new SecureStorageDeviceLifecyclePersistence(sourceVault);
    const sourceInitial = createDeviceList({ version: 1, identityReference: sourceBinding.userScope, epoch: 0, previousCommitment: null, devices: [createDeviceEntry({ deviceId: sourceBinding.deviceId, publicIdentityReference: 'identity-source', algorithm: 'v1', state: 'active', createdAt: 1 })] });
    await sourcePersistence.initialize(sourceBinding.userScope, sourceInitial);
    const sourceLifecycle = new DeviceLifecycleService(sourcePersistence, { verify: async () => undefined });
    const sourceContext = new DeviceContextAuthority(session, 'pairing', { deviceId: sourceBinding.deviceId, identityReference: 'identity-source', userScope: sourceBinding.userScope, verified: true }).localContext();
    const requestJoin = new AuthenticatedDeviceJoinService(sourceLifecycle, targetVault, new SecureStorageDeviceLifecyclePersistence(targetVault));
    const request = requestJoin.createRequest({ userScope: sourceBinding.userScope, deviceId: targetBinding.deviceId, identityReference: 'identity-target', algorithm: 'v1', epoch: 0 });
    const authorization = await requestJoin.approve(request, sourceContext, { deviceId: targetBinding.deviceId, identityReference: 'identity-target' });
    const approvedState = (await sourcePersistence.read(sourceBinding.userScope))!;
    const targetPersistence = new SecureStorageDeviceLifecyclePersistence(targetVault);
    const targetLifecycle = new DeviceLifecycleService(targetPersistence, { verify: async () => undefined });
    const targetJoin = new AuthenticatedDeviceJoinService(targetLifecycle, targetVault, targetPersistence);
    const targetContext = new DeviceContextAuthority(session, 'pairing', { deviceId: targetBinding.deviceId, identityReference: 'identity-target', userScope: sourceBinding.userScope, verified: true }).localContext();
    const joined = await targetJoin.confirmApproval({ version: 1, authorization, approvedState }, targetContext);
    expect(joined.binding.userScope).toBe(sourceBinding.userScope); expect(joined.state.list.devices.find((entry) => entry.deviceId === targetBinding.deviceId)?.state).toBe('active');
    await sourceLifecycle.confirmEnrollment(authorization, targetContext, joined.confirmation);
    expect((await sourcePersistence.read(sourceBinding.userScope))?.list.devices.find((entry) => entry.deviceId === targetBinding.deviceId)?.state).toBe('active');
    await expect(targetJoin.confirmApproval({ version: 1, authorization, approvedState }, targetContext)).rejects.toThrow('replayed');
    const fake = new DeviceContextAuthority(session, 'pairing', { deviceId: 'device-fake', identityReference: 'identity-fake', userScope: sourceBinding.userScope, verified: true }).localContext();
    await expect(targetJoin.confirm(authorization, fake)).rejects.toThrow('target');
    const wrongAccount = new DeviceContextAuthority(session, 'pairing', { deviceId: targetBinding.deviceId, identityReference: 'identity-target', userScope: 'wrong-account', verified: true }).localContext();
    await expect(targetJoin.confirm(authorization, wrongAccount)).rejects.toThrow('target');
    const duplicate = requestJoin.createRequest({ userScope: sourceBinding.userScope, deviceId: targetBinding.deviceId, identityReference: 'identity-target', algorithm: 'v1', epoch: 2 });
    await expect(sourceLifecycle.approveEnrollment(duplicate, sourceContext, { deviceId: targetBinding.deviceId, publicIdentityReference: 'identity-target' })).rejects.toThrow('already exists');
});

it('blocks a stale returning device until an authenticated update installs revocation and rejects invalid updates', async () => {
    const sourceVault = await vault('source-revocation-vault'); const targetVault = await vault('target-revocation-vault');
    const scope = 'account-revocation';
    const list = createDeviceList({ version: 1, identityReference: scope, epoch: 0, previousCommitment: null, devices: [
        createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'v1', state: 'active', createdAt: 1 }),
        createDeviceEntry({ deviceId: 'device-b', publicIdentityReference: 'identity-b', algorithm: 'v1', state: 'active', createdAt: 1 }),
    ] });
    const source = new SecureStorageDeviceLifecyclePersistence(sourceVault); const target = new SecureStorageDeviceLifecyclePersistence(targetVault);
    const current = await source.initialize(scope, list); await target.initialize(scope, list);
    const lifecycle = new DeviceLifecycleService(source, { verify: async () => undefined });
    const context = new DeviceContextAuthority(session, 'pairing', { deviceId: 'device-a', identityReference: 'identity-a', userScope: scope, verified: true }).localContext();
    const authorization = await lifecycle.approveRevocation('device-b', context);
    const confirmation = await createRevocationConfirmation({ version: 1, authorizationDigest: authorization.authorizationDigest, targetDeviceId: 'device-b', confirmationNonce: `${authorization.transactionNonce}-confirm`, confirmedAt: Date.now(), expiresAt: authorization.expiresAt });
    const revoked = await lifecycle.applyRevocation(authorization, context, confirmation);
    const stale = new DeviceTrustEnforcer(target, scope, 'device-b', 'identity-b'); stale.configureFreshnessMembers(['device-a', 'device-b']);
    await expect(stale.assertTrustedAt(0)).rejects.toThrow('freshness');
    await target.installTrustUpdate!(scope, current, revoked, { deviceId: 'device-a', identityReference: 'identity-a' });
    const returned = new DeviceTrustEnforcer(target, scope, 'device-b', 'identity-b'); expect(await returned.decision()).toBe('revoked'); await expect(returned.assertTrusted()).rejects.toThrow();
    const invalidVault = await vault('invalid-revocation-vault'); const invalidStore = new SecureStorageDeviceLifecyclePersistence(invalidVault); await invalidStore.initialize(scope, list);
    await expect(invalidStore.installTrustUpdate!(scope, current, { ...revoked, commitment: 'f'.repeat(64) }, { deviceId: 'device-a', identityReference: 'identity-a' })).rejects.toThrow('rejected');
});
