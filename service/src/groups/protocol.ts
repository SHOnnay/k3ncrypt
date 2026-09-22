import type { GroupAuthorization, GroupMembershipSnapshot } from './contracts';
import { GroupMembershipService } from './membership';

export type GroupMembershipOperation = 'add' | 'activate' | 'remove';
export interface GroupMembershipEvent {
    readonly version: 1;
    readonly eventId: string;
    readonly operation: GroupMembershipOperation;
    readonly authorization: GroupAuthorization;
    readonly targetDeviceId: string;
    readonly epoch: number;
    readonly transcriptCommitment: string;
    readonly createdAt: number;
    readonly digest: string;
}

const hex = /^[0-9a-f]{64}$/;
const canonical = (event: Omit<GroupMembershipEvent, 'digest'>): Uint8Array => new TextEncoder().encode(JSON.stringify(event));
const digestOf = async (bytes: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
export const groupMembershipDigest = async (event: Omit<GroupMembershipEvent, 'digest'>): Promise<string> => digestOf(canonical(event));
export const nextGroupTranscriptCommitment = async (snapshot: GroupMembershipSnapshot, members: readonly import('./contracts').GroupMember[]): Promise<string> =>
    digestOf(new TextEncoder().encode(JSON.stringify({ version: 1, groupId: snapshot.group.groupId, previousEpoch: snapshot.group.epoch,
        previousCommitment: snapshot.transcriptCommitment, nextEpoch: snapshot.group.epoch + 1,
        members: [...members].map((member) => ({ ...member })).sort((a, b) => a.deviceId.localeCompare(b.deviceId)) })));

/** Authenticated group control boundary; it never holds group keys. */
export class GroupMembershipProtocol {
    private readonly seen = new Set<string>();
    public constructor(private readonly authorization = new GroupMembershipService()) {}
    public async validate(event: GroupMembershipEvent, snapshot: GroupMembershipSnapshot, now = Date.now()): Promise<void> {
        const unsigned = { ...event } as Omit<GroupMembershipEvent, 'digest'>;
        delete (unsigned as { digest?: string }).digest;
        if (event.version !== 1 || !event.eventId || this.seen.has(event.eventId) || !hex.test(event.transcriptCommitment) || !hex.test(event.digest) || event.epoch !== snapshot.group.epoch || event.transcriptCommitment !== snapshot.transcriptCommitment || !Number.isSafeInteger(event.createdAt) || !Number.isSafeInteger(now) || event.createdAt > now || event.createdAt + 300_000 < now || event.authorization.groupId !== snapshot.group.groupId || event.authorization.epoch !== snapshot.group.epoch || event.authorization.action !== event.operation || event.authorization.targetDeviceId !== event.targetDeviceId || (await groupMembershipDigest(unsigned)) !== event.digest) throw new Error('Group membership event rejected.');
        await this.authorization.authorize(event.authorization, snapshot);
        this.seen.add(event.eventId);
    }
}
