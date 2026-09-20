import type { DeviceLifecyclePersistence, LifecycleStateSnapshot } from './lifecycle';
import { DeviceTrustEnforcer } from './trust';
import { createDeviceEntry, createDeviceList, deviceListCommitment } from './index';

const state = async (deviceState: 'active' | 'revoked'): Promise<LifecycleStateSnapshot> => {
    const list = createDeviceList({ version: 1, identityReference: 'user', epoch: 1, previousCommitment: 'a'.repeat(64), devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'vodozemac-v1', state: deviceState, createdAt: 1, ...(deviceState === 'revoked' ? { revokedAt: 2 } : {}) })] });
    return { list, commitment: await deviceListCommitment(list) };
};

const persistence = (snapshot: LifecycleStateSnapshot): DeviceLifecyclePersistence => ({
    read: async () => snapshot,
    commitEnrollment: async () => undefined,
    commitRevocation: async () => undefined,
});

describe('Phase 6B device trust enforcement', () => {
    it('allows an active approved device and rejects identity confusion', async () => {
        const enforcer = new DeviceTrustEnforcer(persistence(await state('active')), 'user', 'device-a', 'identity-a');
        await expect(enforcer.assertTrusted()).resolves.toBeUndefined();
        expect(await new DeviceTrustEnforcer(persistence(await state('active')), 'user', 'device-a', 'wrong-identity').decision()).toBe('unavailable');
    });

    it('rejects revoked and corrupted trust state for every caller', async () => {
        const revoked = new DeviceTrustEnforcer(persistence(await state('revoked')), 'user', 'device-a', 'identity-a');
        expect(await revoked.decision()).toBe('revoked');
        await expect(revoked.assertTrusted()).rejects.toThrow('trust');
        const corrupted: DeviceLifecyclePersistence = { ...persistence(await state('active')), read: async () => ({ ...(await state('active')), commitment: '0'.repeat(64) }) };
        expect(await new DeviceTrustEnforcer(corrupted, 'user', 'device-a', 'identity-a').decision()).toBe('unavailable');
    });
});
