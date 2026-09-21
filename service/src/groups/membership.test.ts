import { GroupMembershipService } from './membership';
import type { GroupMembershipSnapshot } from './contracts';

const snapshot: GroupMembershipSnapshot = { group: { groupId: 'group-1', version: 1, genesisCommitment: 'a'.repeat(64), epoch: 1 }, members: [{ memberId: 'm1', userIdentityReference: 'u1', deviceId: 'device-a', state: 'active' }, { memberId: 'm2', userIdentityReference: 'u2', deviceId: 'device-b', state: 'removed' }], transcriptCommitment: 'b'.repeat(64) };
describe('group membership boundary', () => {
    it('accepts an active member at the current epoch', async () => { await expect(new GroupMembershipService().authorize({ groupId: 'group-1', actorDeviceId: 'device-a', epoch: 1, expiresAt: Date.now() + 1000 }, snapshot)).resolves.toBeUndefined(); });
    it('rejects removed members and unknown additions', async () => { const service = new GroupMembershipService(); await expect(service.authorize({ groupId: 'group-1', actorDeviceId: 'device-b', targetDeviceId: 'unknown', epoch: 1, expiresAt: Date.now() + 1000 }, snapshot)).rejects.toThrow(); });
});
