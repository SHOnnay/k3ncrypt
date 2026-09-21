import type { ConflictRecord, FenceRecord, SyncCheckpoint } from './contracts';

export class SyncFenceCoordinator {
    private readonly fences = new Map<string, FenceRecord>();
    private readonly conflicts = new Map<string, ConflictRecord>();
    private blocked = false;
    public constructor(private readonly scope: string, private readonly checkpoint: SyncCheckpoint, private readonly members: readonly string[]) {}
    public recordFence(record: FenceRecord): void {
        if (record.scope !== this.scope || record.attemptId.length < 16 || record.checkpoint.epoch !== this.checkpoint.epoch || record.checkpoint.commitment !== this.checkpoint.commitment || !this.members.includes(record.deviceId)) throw new Error('Sync fence rejected.');
        const prior = this.fences.get(record.deviceId);
        if (prior && prior.ledgerDigest !== record.ledgerDigest) throw new Error('Conflicting sync fence.');
        this.fences.set(record.deviceId, record); this.blocked = true;
    }
    public recordConflict(record: ConflictRecord): void {
        if (record.scope !== this.scope || record.checkpoint.epoch !== this.checkpoint.epoch || record.checkpoint.commitment !== this.checkpoint.commitment) throw new Error('Sync conflict rejected.');
        const proposals = [...record.proposals].sort();
        if (proposals.length === 0 || proposals.some((proposal) => !/^[0-9a-f]{64}$/.test(proposal))) throw new Error('Sync conflict rejected.');
        this.conflicts.set(record.attemptId, Object.freeze({ ...record, proposals })); this.blocked = true;
    }
    public isBlocked(): boolean { return this.blocked; }
    public hasAllFences(): boolean { return this.members.every((member) => this.fences.has(member)); }
    public conflictsFor(attemptId: string): ConflictRecord | undefined { return this.conflicts.get(attemptId); }
    public canResume(): boolean { return this.hasAllFences() && this.conflicts.size === 0; }
    public clearAfterResolution(attemptId: string): void { if (!this.conflicts.has(attemptId) || !this.hasAllFences()) throw new Error('Sync resolution is incomplete.'); this.conflicts.delete(attemptId); this.blocked = this.conflicts.size > 0; }
}
