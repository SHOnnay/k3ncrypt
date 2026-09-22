import type { SecureStorage } from '../core/contracts';
import { canonicalIdentityRecordId } from '../identity/machineIdentity';
import type { SyncCheckpoint, SyncDurableState, SyncPersistence, SyncPersistenceTransaction } from './contracts';
import { validateSyncRecords, type SyncRecord } from './stateRecords';

interface RecordState {
    version: 1;
    scope: string;
    revision: number;
    checkpoint?: SyncCheckpoint;
    state?: SyncDurableState;
    claims: string[];
    records?: SyncRecord[];
}
const same = (a?: SyncCheckpoint, b?: SyncCheckpoint): boolean => a?.epoch === b?.epoch && a?.commitment === b?.commitment;
const checkpointValid = (value: SyncCheckpoint): boolean => !!value && Number.isSafeInteger(value.epoch) && value.epoch >= 0 && /^[0-9a-f]{64}$/.test(value.commitment);
const membersValid = (members: readonly string[] | undefined): boolean => members === undefined || (Array.isArray(members) && members.length <= 8 && members.every((member) => typeof member === 'string' && member.length > 0 && member.length <= 2048) && new Set(members).size === members.length);
const validateState = (scope: string, state: SyncDurableState, checkpoint?: SyncCheckpoint): void => {
    if (!state || state.scope !== scope || state.version !== 1 || !checkpointValid(state.checkpoint) || !same(state.checkpoint, checkpoint) || !['idle', 'prepare', 'prepared', 'ready', 'transfer'].includes(state.admission) || !Array.isArray(state.receivedSequences) || state.receivedSequences.length > 100000 || state.receivedSequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 1) || new Set(state.receivedSequences).size !== state.receivedSequences.length || !membersValid(state.preparedMembers) || !membersValid(state.readyMembers) || (state.readyMembers ?? []).some((member) => !state.preparedMembers?.includes(member)) || (state.terminal !== undefined && (!['completed', 'failed'].includes(state.terminal) || state.admission !== 'idle'))) throw new Error('Sync persistence corrupted.');
};

/** One encrypted CAS record: checkpoint, progress, terminal outcome and replay claims. */
export class SecureSyncPersistence implements SyncPersistence {
    readonly durable = true as const;
    constructor(private readonly storage: SecureStorage) {
        if (!storage.compareAndSwapRecords) throw new Error('Atomic sync persistence unavailable.');
    }
    private async load(scope: string): Promise<{ id: string; raw?: ArrayBuffer; record: RecordState }> {
        const id = await canonicalIdentityRecordId(scope);
        const raw = await this.storage.read('sync-runtime', id);
        if (!raw) return { id, record: { version: 1, scope, revision: 0, claims: [] } };
        let record: RecordState;
        try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
        catch { throw new Error('Sync persistence corrupted.'); }
        if (!record || record.version !== 1 || record.scope !== scope || !Number.isSafeInteger(record.revision) || record.revision < 1 || !Array.isArray(record.claims) || record.claims.length > 100000 || record.claims.some((key) => typeof key !== 'string' || key.length === 0 || key.length > 2048) || new Set(record.claims).size !== record.claims.length || (record.checkpoint && !checkpointValid(record.checkpoint)) || (record.records !== undefined && (!Array.isArray(record.records) || record.records.length > 10000))) throw new Error('Sync persistence corrupted.');
        if (record.state !== undefined) validateState(scope, record.state, record.checkpoint);
        if (record.records !== undefined && record.checkpoint) validateSyncRecords(scope, record.checkpoint, record.records);
        return { id, raw, record };
    }
    async read(scope: string): Promise<SyncCheckpoint | undefined> { return (await this.load(scope)).record.checkpoint; }
    async readState(scope: string): Promise<SyncDurableState | undefined> { return (await this.load(scope)).record.state; }
    async readRecords(scope: string): Promise<readonly SyncRecord[]> { return (await this.load(scope)).record.records ?? []; }
    async claim(): Promise<boolean> { throw new Error('Replay claims require a sync transaction.'); }
    async write(): Promise<void> { throw new Error('Checkpoint writes require a sync transaction.'); }
    async writeState(): Promise<void> { throw new Error('State writes require a sync transaction.'); }
    async transaction<T>(scope: string, expected: SyncCheckpoint | undefined, operation: (tx: SyncPersistenceTransaction) => Promise<T>): Promise<T> {
        const { id, raw, record } = await this.load(scope);
        if (!same(record.checkpoint, expected)) throw new Error('Sync persistence conflict.');
        const requireScope = (candidate: string): void => { if (candidate !== scope) throw new Error('Sync persistence scope rejected.'); };
        let active = true;
        const requireActive = (): void => { if (!active) throw new Error('Sync transaction closed.'); };
        const putCheckpoint = (checkpoint: SyncCheckpoint): void => {
            if (!checkpointValid(checkpoint) || (record.checkpoint && (checkpoint.epoch < record.checkpoint.epoch || (checkpoint.epoch === record.checkpoint.epoch && checkpoint.commitment !== record.checkpoint.commitment)))) throw new Error('Sync checkpoint rejected.');
            record.checkpoint = { ...checkpoint };
        };
        let result: T;
        try { result = await operation({
            claim: async (candidate, key) => {
                requireActive();
                requireScope(candidate);
                if (typeof key !== 'string' || key.length === 0 || key.length > 2048 || record.claims.length >= 100000) throw new Error('Sync replay storage unavailable.');
                if (record.claims.includes(key)) return false;
                record.claims.push(key); return true;
            },
            write: async (candidate, checkpoint) => { requireActive(); requireScope(candidate); putCheckpoint(checkpoint); },
            writeState: async (candidate, state) => {
                requireActive();
                requireScope(candidate);
                validateState(scope, state, state.checkpoint);
                putCheckpoint(state.checkpoint);
                record.state = JSON.parse(JSON.stringify(state)) as SyncDurableState;
            },
            importRecords: async (candidate, checkpoint, records) => {
                requireActive(); requireScope(candidate);
                validateSyncRecords(scope, checkpoint, records);
                if (record.checkpoint && !same(record.checkpoint, checkpoint)) throw new Error('Sync record checkpoint rejected.');
                const existing = record.records ?? [];
                const existingIds = new Set(existing.map((item) => item.recordId));
                if (records.some((item) => existingIds.has(item.recordId))) throw new Error('Sync record already imported.');
                record.records = [...existing, ...JSON.parse(JSON.stringify(records)) as SyncRecord[]];
                if (record.records.length > 10000) throw new Error('Sync record storage unavailable.');
            },
        }); } finally { active = false; }
        if (record.state !== undefined) validateState(scope, record.state, record.checkpoint);
        if (record.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Sync persistence exhausted.');
        ++record.revision;
        const next = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer;
        if (!await this.storage.compareAndSwapRecords!([{ recordType: 'sync-runtime', recordId: id, expected: raw, next }])) throw new Error('Sync persistence conflict.');
        return result;
    }
}
