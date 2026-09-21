import type { GroupAuthorization, GroupAuthorizationBoundary, GroupMember, GroupMembershipSnapshot } from './contracts';

export class GroupMembershipService implements GroupAuthorizationBoundary {
    public async authorize(change: GroupAuthorization, snapshot: GroupMembershipSnapshot): Promise<void> {
        if (change.groupId !== snapshot.group.groupId || change.epoch !== snapshot.group.epoch || change.expiresAt <= Date.now()) throw new Error('Group authorization rejected.');
        const actor = snapshot.members.find((member) => member.deviceId === change.actorDeviceId);
        if (!actor || actor.state !== 'active' || change.action && change.action !== 'observe' && actor.role !== 'administrator') throw new Error('Group authorization rejected.');
        if (change.targetDeviceId && !snapshot.members.some((member) => member.deviceId === change.targetDeviceId)) throw new Error('Group authorization rejected.');
    }
}
