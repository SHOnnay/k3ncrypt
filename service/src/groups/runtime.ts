import { assertIssuedDeviceContext } from '../devices/authenticatedContext';
import type { AuthenticatedDeviceContext } from '../devices/lifecycle';
import type { GroupKeyManagementAdapter, GroupMember, GroupMembershipSnapshot, GroupStatePersistence } from './contracts';
import { GroupMembershipService } from './membership';
import { GroupMembershipProtocol, type GroupMembershipEvent } from './protocol';
import { GroupStateService } from './state';

export interface GroupRuntimePersistence extends GroupStatePersistence {
    read(groupId: string): Promise<GroupMembershipSnapshot | undefined>;
}

/** Runtime boundary that derives group authorship from an issued CryptoSession context. */
export class GroupSecurityRuntime {
    private readonly protocol = new GroupMembershipProtocol();
    private readonly state: GroupStateService;
    public constructor(private readonly persistence: GroupRuntimePersistence, private readonly keys: GroupKeyManagementAdapter) {
        this.state = new GroupStateService(new GroupMembershipService(), keys, persistence);
    }

    public async create(snapshot: GroupMembershipSnapshot, context: AuthenticatedDeviceContext): Promise<GroupMembershipSnapshot> {
        assertIssuedDeviceContext(context);
        const administrators = snapshot.members.filter((member) => member.state === 'active' && member.role === 'administrator');
        if (snapshot.group.epoch !== 0 || administrators.length !== 1 || !this.matchesContext(administrators[0], context) || await this.persistence.read(snapshot.group.groupId)) throw new Error('Group creation rejected.');
        if (!await this.persistence.compareAndSwapWithKeyUpdate(snapshot.group.groupId, -1, snapshot, async () => this.keys.establish(snapshot))) throw new Error('Group creation rejected.');
        return snapshot;
    }

    public async add(event: GroupMembershipEvent, member: GroupMember, context: AuthenticatedDeviceContext): Promise<GroupMembershipSnapshot> {
        if (event.operation !== 'add' || event.targetDeviceId !== member.deviceId) throw new Error('Group membership event rejected.');
        const snapshot = await this.authorize(event, context);
        return this.state.addPending(event.authorization, snapshot, member);
    }

    public async activate(event: GroupMembershipEvent, context: AuthenticatedDeviceContext): Promise<GroupMembershipSnapshot> {
        if (event.operation !== 'activate') throw new Error('Group membership event rejected.');
        const snapshot = await this.authorize(event, context);
        return this.state.activate(event.authorization, snapshot, event.targetDeviceId);
    }

    public async remove(event: GroupMembershipEvent, context: AuthenticatedDeviceContext): Promise<GroupMembershipSnapshot> {
        if (event.operation !== 'remove') throw new Error('Group membership event rejected.');
        const snapshot = await this.authorize(event, context);
        return this.state.remove(event.authorization, snapshot, event.targetDeviceId);
    }

    private async authorize(event: GroupMembershipEvent, context: AuthenticatedDeviceContext): Promise<GroupMembershipSnapshot> {
        assertIssuedDeviceContext(context, event);
        const snapshot = await this.persistence.read(event.authorization.groupId);
        if (!snapshot) throw new Error('Group state unavailable.');
        const actor = snapshot.members.find((member) => member.deviceId === event.authorization.actorDeviceId);
        if (!actor || !this.matchesContext(actor, context)) throw new Error('Group authorization rejected.');
        await this.protocol.validate(event, snapshot);
        return snapshot;
    }

    private matchesContext(member: GroupMember, context: AuthenticatedDeviceContext): boolean {
        return context.cryptoSession.ready && context.cryptoSession.encrypted && context.authenticatedSender.verified &&
            member.deviceId === context.authenticatedSender.deviceId && member.userIdentityReference === context.authenticatedSender.identityReference;
    }
}
