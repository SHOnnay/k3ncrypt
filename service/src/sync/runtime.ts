import type { SyncAdmissionState, SyncAuthorization, SyncCheckpoint, SyncDurableState, SyncPackage, SyncPersistence, SyncPersistenceTransaction, SyncTrustBoundary } from './contracts';
import { SyncTransferController } from './transfer';
import type { AuthenticatedSyncFrame } from './authenticatedTransport';
import { consumeAuthenticatedSyncFrame } from './authenticatedTransport';
import type { SyncRecord } from './stateRecords';
import { TrustFreshnessAdmission } from '../devices/freshness';

/** Runtime composition boundary. Persistence implementations are supplied by the application. */
export class RuntimeSyncController {
    private transfer?: SyncTransferController;
    private admission: SyncAdmissionState = 'idle';
    private expiresAt = 0;
    private readonly receivedSequences = new Set<number>();
    private readonly preparedMembers = new Set<string>();
    private readonly readyMembers = new Set<string>();
    private readonly freshness: TrustFreshnessAdmission;
    private checkpoint?: SyncCheckpoint;
    public constructor(private readonly scope: string, private readonly localDeviceId: string, private readonly trust: SyncTrustBoundary, private readonly persistence: SyncPersistence, private readonly now = Date.now) { this.freshness = new TrustFreshnessAdmission(localDeviceId); }

    public async authorize(authorization: SyncAuthorization): Promise<void> {
        if (authorization.scope !== this.scope || authorization.targetDeviceId !== this.localDeviceId) throw new Error('Sync target is unavailable.');
        const persisted = await this.persistence.read(this.scope);
        if (persisted && (authorization.checkpoint.epoch < persisted.epoch || (authorization.checkpoint.epoch === persisted.epoch && authorization.checkpoint.commitment !== persisted.commitment))) throw new Error('Sync checkpoint is stale.');
        const current = await this.trust.snapshot();
        await this.trust.assertTrustedAt(current.list.epoch);
        if (authorization.freshnessRequired && authorization.activeMemberDeviceIds && !authorization.activeMemberDeviceIds.includes(this.localDeviceId)) throw new Error('Sync freshness membership rejected.');
        this.freshness.clear();
        for (const evidence of authorization.freshnessEvidence ?? []) this.freshness.recordAuthenticatedEvidence(evidence, current);
        if (authorization.freshnessRequired && authorization.activeMemberDeviceIds) this.freshness.assertCurrent(current, authorization.activeMemberDeviceIds);
        this.receivedSequences.clear();
        this.preparedMembers.clear();
        this.readyMembers.clear();
        this.transfer = new SyncTransferController(authorization, this.trust, this.now);
        this.expiresAt = authorization.expiresAt;
        this.checkpoint = authorization.checkpoint;
        this.preparedMembers.add(this.localDeviceId);
        this.readyMembers.add(this.localDeviceId);
        await this.transfer.authorize();
        this.admission = 'prepare';
        await this.atomic(persisted, async (tx) => tx.writeState(this.scope, this.state(authorization.checkpoint)));
    }

    /** Restores only durable evidence; live admission always requires reauthorization after restart. */
    public async recover(): Promise<SyncDurableState | undefined> {
        const state = await this.persistence.readState(this.scope);
        if (!state) return undefined;
        if (state.version !== 1 || state.scope !== this.scope || !Number.isSafeInteger(state.checkpoint.epoch) || state.checkpoint.epoch < 0 || new Set(state.receivedSequences).size !== state.receivedSequences.length) throw new Error('Sync recovery state is corrupted.');
        this.checkpoint = state.checkpoint;
        this.receivedSequences.clear();
        for (const sequence of state.receivedSequences) { if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Sync recovery state is corrupted.'); this.receivedSequences.add(sequence); }
        this.preparedMembers.clear();
        this.readyMembers.clear();
        // Durable progress is evidence, not a fresh peer admission after restart.
        this.transfer = undefined;
        this.expiresAt = 0;
        this.admission = 'idle';
        return state;
    }

    public async prepared(): Promise<void> { if (this.admission !== 'prepare' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'prepared'; await this.persistState(this.checkpoint!); }
    public async ready(): Promise<void> { if (this.admission !== 'prepared' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'ready'; await this.persistState(this.checkpoint!); }

    public recordPrepared(deviceId: string): void { if (!this.transfer || !this.transferMembers().includes(deviceId)) throw new Error('Sync admission member rejected.'); this.preparedMembers.add(deviceId); }
    public recordReady(deviceId: string): void { if (!this.transfer || !this.transferMembers().includes(deviceId) || !this.preparedMembers.has(deviceId)) throw new Error('Sync admission member rejected.'); this.readyMembers.add(deviceId); }

    public async begin(): Promise<void> { if (!this.transfer || this.admission !== 'ready' || this.now() > this.expiresAt || (this.transfer.membershipEvidenceRequired && (this.preparedMembers.size !== this.transferMembers().length || this.readyMembers.size !== this.transferMembers().length))) throw new Error('Sync admission is unavailable.'); this.transfer.begin(); this.admission = 'transfer'; await this.persistState(this.checkpoint!); }

    public async receiveAuthenticated(frame: AuthenticatedSyncFrame): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        consumeAuthenticatedSyncFrame(frame);
        if (frame.sessionBinding.length === 0 || frame.senderIdentityReference.length === 0) throw new Error('Authenticated sync frame rejected.');
        return this.receiveInternal(frame.syncPackage);
    }

    private async receiveInternal(pkg: SyncPackage): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (!this.transfer || this.admission !== 'transfer' || this.now() > this.expiresAt) throw new Error('Sync transfer is unavailable.');
        const receipt = await this.transfer.accept(pkg);
        if (this.transfer.membershipEvidenceRequired && this.transfer.freshnessRequired) {
            const current = await this.trust.snapshot();
            this.freshness.recordAuthenticatedEvidence({ version: 1, deviceId: pkg.sender, identityReference: pkg.senderIdentity, epoch: pkg.checkpoint.epoch, commitment: pkg.checkpoint.commitment, evidenceId: pkg.messageId }, current);
            this.freshness.assertCurrent(current, this.transferMembers());
        }
        const key = `${pkg.sender}:${pkg.receiver}:${pkg.streamId}:${pkg.sequence}`;
        const incomingRecords = this.extractRecords(pkg.payload);
        await this.atomic(pkg.checkpoint, async (tx) => {
            if (!(await tx.claim(this.scope, key))) throw new Error('Sync package replayed.');
            if (incomingRecords.length > 0) {
                if (!tx.importRecords) throw new Error('Atomic sync import unavailable.');
                await tx.importRecords(this.scope, pkg.checkpoint, incomingRecords);
            }
            this.receivedSequences.add(pkg.sequence);
            await tx.writeState(this.scope, this.state(pkg.checkpoint));
        });
        this.checkpoint = pkg.checkpoint;
        return receipt;
    }

    public async complete(): Promise<void> { if (!this.transfer || this.admission !== 'transfer') throw new Error('Sync transfer is unavailable.'); await this.transfer.complete(); this.admission = 'idle'; await this.persistState(this.checkpoint!, 'completed'); }
    public async fail(): Promise<void> { this.transfer?.fail(); this.admission = 'idle'; if (this.checkpoint) await this.persistState(this.checkpoint, 'failed'); }

    private state(checkpoint: SyncCheckpoint, terminal?: 'completed' | 'failed'): SyncDurableState { return { scope: this.scope, version: 1, checkpoint, admission: this.admission, receivedSequences: [...this.receivedSequences].sort((a, b) => a - b), preparedMembers: [...this.preparedMembers].sort(), readyMembers: [...this.readyMembers].sort(), terminal }; }
    private transferMembers(): readonly string[] { return this.transfer ? this.transfer.members : []; }
    private async persistState(checkpoint: SyncCheckpoint, terminal?: 'completed' | 'failed'): Promise<void> { await this.atomic(checkpoint, async (tx) => tx.writeState(this.scope, this.state(checkpoint, terminal))); }
    private async atomic<T>(checkpoint: SyncCheckpoint | undefined, operation: (tx: SyncPersistenceTransaction) => Promise<T>): Promise<T> {
        try { return await this.persistence.transaction(this.scope, checkpoint, operation); }
        catch (error) {
            // A failed/uncertain commit cannot leave usable process-local admission.
            // Recovery rereads durable evidence; a new admission is still required.
            this.transfer = undefined;
            this.admission = 'idle';
            this.expiresAt = 0;
            this.receivedSequences.clear();
            this.preparedMembers.clear();
            this.readyMembers.clear();
            throw error;
        }
    }

    private extractRecords(payload: unknown): readonly SyncRecord[] {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
        const value = payload as Record<string, unknown>;
        if (!('records' in value)) return [];
        if (!Array.isArray(value.records)) throw new Error('Sync records rejected.');
        return value.records as SyncRecord[];
    }
}
