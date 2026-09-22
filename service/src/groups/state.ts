import type { GroupAuthorization, GroupKeyManagementAdapter, GroupMember, GroupMembershipSnapshot, GroupStatePersistence } from './contracts';
import { GroupMembershipService } from './membership';
import { nextGroupTranscriptCommitment } from './protocol';

export class GroupStateService {
    public constructor(private readonly authorization: GroupMembershipService, private readonly keys: GroupKeyManagementAdapter, private readonly persistence: GroupStatePersistence) {}
    public async addPending(change: GroupAuthorization, snapshot: GroupMembershipSnapshot, member: GroupMember): Promise<GroupMembershipSnapshot> {
        await this.authorization.authorize({ ...change, action: 'add' }, snapshot);
        if (member.state !== 'pending' || snapshot.members.some((existing) => existing.deviceId === member.deviceId || existing.memberId === member.memberId)) throw new Error('Group member addition rejected.');
        return this.commit(snapshot, [...snapshot.members, member]);
    }
    public async activate(change: GroupAuthorization, snapshot: GroupMembershipSnapshot, deviceId: string): Promise<GroupMembershipSnapshot> {
        await this.authorization.authorize({ ...change, action: 'activate', targetDeviceId: deviceId }, snapshot);
        const target = snapshot.members.find((member) => member.deviceId === deviceId);
        if (!target || target.state !== 'pending') throw new Error('Group member activation rejected.');
        return this.commit(snapshot, snapshot.members.map((member) => member.deviceId === deviceId ? { ...member, state: 'active' as const } : member));
    }
    public async remove(change: GroupAuthorization, snapshot: GroupMembershipSnapshot, deviceId: string): Promise<GroupMembershipSnapshot> {
        await this.authorization.authorize({ ...change, action: 'remove', targetDeviceId: deviceId }, snapshot);
        const target = snapshot.members.find((member) => member.deviceId === deviceId);
        if (!target || target.state !== 'active' || target.deviceId === change.actorDeviceId) throw new Error('Group member removal rejected.');
        const members = snapshot.members.map((member) => member.deviceId === deviceId ? { ...member, state: 'removed' as const } : member);
        const next = { ...snapshot, group: { ...snapshot.group, epoch: snapshot.group.epoch + 1 }, members, transcriptCommitment: await nextGroupTranscriptCommitment(snapshot, members) };
        const committed = await this.persistence.compareAndSwapWithKeyUpdate(snapshot.group.groupId, snapshot.group.epoch, next, async () => { await this.keys.removeMember(target.memberId, next); await this.keys.rotate(next); });
        if (!committed) throw new Error('Group state changed concurrently.');
        return next;
    }
    private async commit(snapshot: GroupMembershipSnapshot, members: readonly GroupMember[]): Promise<GroupMembershipSnapshot> {
        const next = { ...snapshot, group: { ...snapshot.group, epoch: snapshot.group.epoch + 1 }, members, transcriptCommitment: await nextGroupTranscriptCommitment(snapshot, members) };
        const committed = this.persistence.compareAndSwapWithKeyUpdate
            ? await this.persistence.compareAndSwapWithKeyUpdate(snapshot.group.groupId, snapshot.group.epoch, next, async () => { await this.keys.rotate(next); })
            : await this.persistence.compareAndSwap(snapshot.group.groupId, snapshot.group.epoch, next);
        if (!committed) throw new Error('Group state changed concurrently.');
        return next;
    }
}
