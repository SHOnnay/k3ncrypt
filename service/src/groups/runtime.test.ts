import type { CryptoSession } from '../core/contracts';
import { DeviceContextAuthority } from '../devices/authenticatedContext';
import type { GroupMember, GroupMembershipSnapshot } from './contracts';
import { groupMembershipDigest, type GroupMembershipEvent } from './protocol';
import { GroupSecurityRuntime, type GroupRuntimePersistence } from './runtime';

const bytes = (value: unknown): ArrayBuffer => new TextEncoder().encode(`k3ncrypt-device-control-v1:${JSON.stringify({ type: 'group', payload: value })}`).buffer as ArrayBuffer;
const session = (payload?: unknown): CryptoSession => ({ ready: true, encrypted: true, initialize: async () => undefined, encrypt: async () => { throw new Error('unused'); }, decrypt: async () => bytes(payload), destroy: () => undefined });
const initial: GroupMembershipSnapshot = { group: { groupId: 'group-1', version: 1, genesisCommitment: 'a'.repeat(64), epoch: 1 }, members: [{ memberId: 'admin', userIdentityReference: 'identity-a', deviceId: 'device-a', state: 'active', role: 'administrator' }], transcriptCommitment: 'b'.repeat(64) };

class Store implements GroupRuntimePersistence {
    value: GroupMembershipSnapshot | undefined = initial;
    async read(): Promise<GroupMembershipSnapshot | undefined> { return this.value; }
    async compareAndSwap(_id: string, epoch: number, next: GroupMembershipSnapshot): Promise<boolean> { if ((this.value?.group.epoch ?? -1) !== epoch) return false; this.value = next; return true; }
    async compareAndSwapWithKeyUpdate(id: string, epoch: number, next: GroupMembershipSnapshot, update: () => Promise<void>): Promise<boolean> { if ((this.value?.group.epoch ?? -1) !== epoch) return false; await update(); return this.compareAndSwap(id, epoch, next); }
}
const keys = () => ({ establish: jest.fn(async () => undefined), rotate: jest.fn(async () => undefined), removeMember: jest.fn(async () => undefined) });
const event = async (operation: 'add' | 'activate' | 'remove', targetDeviceId: string, snapshot = initial): Promise<GroupMembershipEvent> => { const unsigned = { version: 1 as const, eventId: `${operation}-${targetDeviceId}-${snapshot.group.epoch}`, operation, authorization: { groupId: snapshot.group.groupId, actorDeviceId: 'device-a', targetDeviceId, epoch: snapshot.group.epoch, expiresAt: Date.now() + 60_000, action: operation }, targetDeviceId, epoch: snapshot.group.epoch, transcriptCommitment: snapshot.transcriptCommitment, createdAt: Date.now() }; return { ...unsigned, digest: await groupMembershipDigest(unsigned) }; };
const localContext = () => new DeviceContextAuthority(session(), 'group-1', { deviceId: 'device-a', identityReference: 'identity-a', userScope: 'account-a', verified: true }).localContext();

describe('group security runtime integration', () => {
    it('applies authorized membership changes, rotates keys and rejects removed future access', async () => {
        const store = new Store(); const keyAdapter = keys(); const runtime = new GroupSecurityRuntime(store, keyAdapter);
        const member: GroupMember = { memberId: 'member-b', userIdentityReference: 'identity-b', deviceId: 'device-b', state: 'pending', role: 'member' };
        const pending = await runtime.add(await event('add', 'device-b'), member, localContext());
        const active = await runtime.activate(await event('activate', 'device-b', pending), localContext());
        const removed = await runtime.remove(await event('remove', 'device-b', active), localContext());
        expect(removed.members.find((candidate) => candidate.deviceId === 'device-b')?.state).toBe('removed');
        expect(keyAdapter.removeMember).toHaveBeenCalled(); expect(keyAdapter.rotate).toHaveBeenCalledTimes(3);
    });

    it('rejects unauthorized authors, stale membership and replayed events', async () => {
        const store = new Store(); const runtime = new GroupSecurityRuntime(store, keys());
        const member: GroupMember = { memberId: 'member-b', userIdentityReference: 'identity-b', deviceId: 'device-b', state: 'pending' };
        const add = await event('add', 'device-b');
        const outsider = new DeviceContextAuthority(session(), 'group-1', { deviceId: 'attacker', identityReference: 'attacker', userScope: 'account-a', verified: true }).localContext();
        await expect(runtime.add(add, member, outsider)).rejects.toThrow('authorization');
        await runtime.add(add, member, localContext());
        await expect(runtime.add(add, member, localContext())).rejects.toThrow();
        const stale = await event('activate', 'device-b', initial);
        await expect(runtime.activate(stale, localContext())).rejects.toThrow();
    });
});
