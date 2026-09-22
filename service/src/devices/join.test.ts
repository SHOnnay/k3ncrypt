import type { CryptoSession, SecureStorage } from '../core/contracts';
import { DeviceContextAuthority } from './authenticatedContext';
import { DeviceLifecycleService, type AuthenticatedDeviceContext, type AuthorizationRecord, type DeviceLifecyclePersistence, type LifecycleStateSnapshot } from './lifecycle';
import { createDeviceEntry, createDeviceList, deviceListCommitment } from './index';
import { AuthenticatedDeviceJoinService } from './join';

const session: CryptoSession = { encrypted: true, ready: true, initialize: async () => undefined, encrypt: async () => ({ version: 1, strategy: 'test', data: {} }), decrypt: async () => new ArrayBuffer(0), destroy: () => undefined };
const storage = (): SecureStorage => {
    const records = new Map<string, ArrayBuffer>();
    return { read: async (type, id) => records.get(`${type}:${id}`), write: async (type, id, value) => { records.set(`${type}:${id}`, value); }, delete: async (type, id) => { records.delete(`${type}:${id}`); }, compareAndSwapRecords: async (updates) => { if (updates.some((u) => records.get(`${u.recordType}:${u.recordId}`) !== undefined || u.expected !== undefined)) return false; updates.forEach((u) => records.set(`${u.recordType}:${u.recordId}`, u.next)); return true; }, lock: () => undefined, unlock: () => undefined } as unknown as SecureStorage;
};
class Persistence implements DeviceLifecyclePersistence {
    public state!: LifecycleStateSnapshot; public records: AuthorizationRecord[] = [];
    async read() { return this.state; }
    async readAuthorization(_scope: string, digest: string) { return this.records.find((item) => item.digest === digest); }
    async commitEnrollment(input: Parameters<NonNullable<DeviceLifecyclePersistence['commitEnrollment']>>[0]) { if (this.state.list.epoch !== input.expectedEpoch) throw new Error('conflict'); this.records.push(input.authorization); this.state = { list: input.nextList, commitment: input.nextCommitment }; }
    async commitRevocation() { throw new Error('not used'); }
    async initialize(_scope: string, list: typeof this.state.list) { this.state = { list, commitment: await deviceListCommitment(list) }; return this.state; }
}

describe('authenticated account-device joining', () => {
    it('requires target confirmation and installs only public membership state', async () => {
        const source = new Persistence();
        const list = createDeviceList({ version: 1, identityReference: 'account-1', epoch: 0, previousCommitment: null, devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'v1', state: 'active', createdAt: 1 })] });
        source.state = { list, commitment: await deviceListCommitment(list) };
        const sourceContext = new DeviceContextAuthority(session, 'pairing', { deviceId: 'device-a', identityReference: 'identity-a', userScope: 'account-1', verified: true }).localContext();
        const targetContext = new DeviceContextAuthority(session, 'pairing', { deviceId: 'device-b', identityReference: 'identity-b', userScope: 'account-1', verified: true }).localContext();
        const lifecycle = new DeviceLifecycleService(source, { verify: async () => undefined }, () => 2_000);
        const join = new AuthenticatedDeviceJoinService(lifecycle, storage(), new Persistence(), () => 2_000);
        const request = join.createRequest({ userScope: 'account-1', deviceId: 'device-b', identityReference: 'identity-b', algorithm: 'v1', epoch: 0 });
        const authorization = await join.approve(request, sourceContext, { deviceId: 'device-b', identityReference: 'identity-b' });
        expect(source.state.list.devices.find((entry) => entry.deviceId === 'device-b')?.state).toBe('approved_pending_confirmation');
        await expect(join.confirm(authorization, new DeviceContextAuthority(session, 'pairing', { deviceId: 'device-x', identityReference: 'identity-x', userScope: 'account-1', verified: true }).localContext())).rejects.toThrow('target');
        const result = await join.confirm(authorization, targetContext);
        expect(result.binding.userScope).toBe('account-1');
        expect(result.binding.deviceId).toBe('device-b');
        expect(source.state.list.devices.find((entry) => entry.deviceId === 'device-b')?.state).toBe('active');
        await expect(join.confirm(authorization, targetContext)).rejects.toThrow();
    });
});
