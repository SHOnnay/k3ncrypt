import type { SecureStorage } from '../core/contracts';
import type { GroupKeyManagementAdapter, GroupMembershipSnapshot } from './contracts';
import type { GroupRuntimePersistence } from './runtime';

interface GroupSecurityRecord {
    readonly version: 1;
    readonly snapshot: GroupMembershipSnapshot;
    readonly keyEpoch: number;
    readonly keyMaterial: string;
    readonly removedMemberIds: readonly string[];
}

const encode = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer): GroupSecurityRecord => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as GroupSecurityRecord;
const key = (): string => {
    const value = new Uint8Array(32);
    crypto.getRandomValues(value);
    return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Stores membership and the next group-key epoch in one encrypted vault CAS. */
export class SecureStorageGroupRuntimeAdapter implements GroupRuntimePersistence, GroupKeyManagementAdapter {
    private readonly staged = new Map<string, { keyMaterial?: string; removed: Set<string> }>();
    public constructor(private readonly storage: SecureStorage) {
        if (!storage.compareAndSwapRecords) throw new Error('Atomic group persistence unavailable.');
    }
    public async read(groupId: string): Promise<GroupMembershipSnapshot | undefined> { return (await this.load(groupId)).record?.snapshot; }
    public async compareAndSwap(groupId: string, expectedEpoch: number, next: GroupMembershipSnapshot): Promise<boolean> {
        return this.compareAndSwapWithKeyUpdate(groupId, expectedEpoch, next, async () => undefined);
    }
    public async compareAndSwapWithKeyUpdate(groupId: string, expectedEpoch: number, next: GroupMembershipSnapshot, keyUpdate: () => Promise<void>): Promise<boolean> {
        const current = await this.load(groupId);
        if ((current.record?.snapshot.group.epoch ?? -1) !== expectedEpoch || next.group.groupId !== groupId || next.group.epoch !== expectedEpoch + 1) return false;
        const pending = { removed: new Set(current.record?.removedMemberIds ?? []) } as { keyMaterial?: string; removed: Set<string> };
        this.staged.set(groupId, pending);
        try { await keyUpdate(); } catch (error) { this.staged.delete(groupId); throw error; }
        this.staged.delete(groupId);
        if (!pending.keyMaterial) throw new Error('Group key update was not staged.');
        const record: GroupSecurityRecord = { version: 1, snapshot: next, keyEpoch: next.group.epoch, keyMaterial: pending.keyMaterial, removedMemberIds: [...pending.removed].sort() };
        return this.storage.compareAndSwapRecords!([{ recordType: 'group-security', recordId: groupId, expected: current.raw, next: encode(record) }]);
    }
    public async establish(snapshot: GroupMembershipSnapshot): Promise<void> { this.stage(snapshot.group.groupId).keyMaterial = key(); }
    public async rotate(snapshot: GroupMembershipSnapshot): Promise<void> { this.stage(snapshot.group.groupId).keyMaterial = key(); }
    public async removeMember(memberId: string, snapshot: GroupMembershipSnapshot): Promise<void> { this.stage(snapshot.group.groupId).removed.add(memberId); }
    public async keyForActiveMember(groupId: string, memberId: string): Promise<string> {
        const record = (await this.load(groupId)).record;
        const member = record?.snapshot.members.find((candidate) => candidate.memberId === memberId);
        if (!record || !member || member.state !== 'active' || record.removedMemberIds.includes(memberId)) throw new Error('Group key access rejected.');
        return record.keyMaterial;
    }
    private stage(groupId: string): { keyMaterial?: string; removed: Set<string> } {
        const pending = this.staged.get(groupId);
        if (!pending) throw new Error('Group key update is outside an atomic transaction.');
        return pending;
    }
    private async load(groupId: string): Promise<{ raw?: ArrayBuffer; record?: GroupSecurityRecord }> {
        const raw = await this.storage.read('group-security', groupId);
        if (!raw) return {};
        let record: GroupSecurityRecord;
        try { record = decode(raw); } catch { throw new Error('Group security state is corrupted.'); }
        if (record.version !== 1 || record.snapshot.group.groupId !== groupId || record.keyEpoch !== record.snapshot.group.epoch || !/^[A-Za-z0-9_-]{43}$/.test(record.keyMaterial) || !Array.isArray(record.removedMemberIds)) throw new Error('Group security state is corrupted.');
        return { raw, record };
    }
}
