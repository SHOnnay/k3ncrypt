import { EncryptedGroupCallBoundary } from './callBoundary';
import type { GroupMembershipSnapshot } from './contracts';
import { GroupMembershipService } from './membership';
import { GroupStateService } from './state';
import { GroupMembershipProtocol, groupMembershipDigest } from './protocol';

const snapshot: GroupMembershipSnapshot = { group: { groupId: 'group-1', version: 1, genesisCommitment: 'a'.repeat(64), epoch: 1 }, members: [{ memberId: 'admin', userIdentityReference: 'user-a', deviceId: 'device-a', state: 'active', role: 'administrator' }, { memberId: 'removed', userIdentityReference: 'user-b', deviceId: 'device-b', state: 'removed', role: 'member' }], transcriptCommitment: 'b'.repeat(64) };
const keys = { establish: async () => undefined, rotate: async () => undefined, removeMember: async () => undefined, revokeParticipant: async () => undefined };
describe('group security boundaries', () => {
    it('rejects unauthorized member additions and invalid transitions', async () => { const service = new GroupStateService(new GroupMembershipService(), keys, { compareAndSwap: async () => true, compareAndSwapWithKeyUpdate: async (_group, _epoch, _next, update) => { await update(); return true; } }); const member = { memberId: 'new', userIdentityReference: 'user-c', deviceId: 'device-c', state: 'pending' as const, role: 'member' as const }; await expect(service.addPending({ groupId: 'group-1', actorDeviceId: 'device-b', epoch: 1, expiresAt: Date.now() + 1000 }, snapshot, member)).rejects.toThrow(); const next = await service.addPending({ groupId: 'group-1', actorDeviceId: 'device-a', epoch: 1, expiresAt: Date.now() + 1000 }, snapshot, member); await expect(service.activate({ groupId: 'group-1', actorDeviceId: 'device-a', epoch: next.group.epoch, expiresAt: Date.now() + 1000 }, next, 'device-a')).rejects.toThrow(); });
    it('rejects removed call participants', async () => { const calls = new EncryptedGroupCallBoundary(keys); await expect(calls.authorizeParticipant('device-b', snapshot)).rejects.toThrow(); await expect(calls.authorizeParticipant('device-a', snapshot)).resolves.toBeUndefined(); });
    it('authenticates membership events and rejects replay or stale epochs', async () => {
        const protocolSnapshot = { ...snapshot, members: [...snapshot.members, { memberId: 'pending', userIdentityReference: 'user-c', deviceId: 'device-c', state: 'pending' as const, role: 'member' as const }] };
        const unsigned = { version: 1 as const, eventId: 'event-group-1', operation: 'activate' as const, authorization: { groupId: 'group-1', actorDeviceId: 'device-a', targetDeviceId: 'device-c', epoch: 1, expiresAt: Date.now() + 10_000, action: 'activate' as const }, targetDeviceId: 'device-c', epoch: 1, transcriptCommitment: snapshot.transcriptCommitment, createdAt: Date.now() };
        const event = { ...unsigned, digest: await groupMembershipDigest(unsigned) };
        const protocol = new GroupMembershipProtocol();
        await expect(protocol.validate(event, protocolSnapshot)).resolves.toBeUndefined();
        await expect(protocol.validate(event, protocolSnapshot)).rejects.toThrow();
        await expect(protocol.validate({ ...event, eventId: 'event-group-2', epoch: 0 }, protocolSnapshot)).rejects.toThrow();
    });
});
