import type { SyncAdmissionState, SyncAuthorization, SyncCheckpoint, SyncDurableState, SyncPackage, SyncPersistence, SyncPersistenceTransaction, SyncTrustBoundary } from './contracts';
import { SyncTransferController } from './transfer';
import type { AuthenticatedSyncFrame } from './authenticatedTransport';

/** Runtime composition boundary. Persistence implementations are supplied by the application. */
export class RuntimeSyncController {
    private transfer?: SyncTransferController;
    private admission: SyncAdmissionState = 'idle';
    private expiresAt = 0;
    private readonly receivedSequences = new Set<number>();
    private checkpoint?: SyncCheckpoint;
    public constructor(private readonly scope: string, private readonly localDeviceId: string, private readonly trust: SyncTrustBoundary, private readonly persistence: SyncPersistence, private readonly now = Date.now) {}

    public async authorize(authorization: SyncAuthorization): Promise<void> {
        if (authorization.scope !== this.scope || authorization.targetDeviceId !== this.localDeviceId) throw new Error('Sync target is unavailable.');
        const persisted = await this.persistence.read(this.scope);
        if (persisted && (authorization.checkpoint.epoch < persisted.epoch || (authorization.checkpoint.epoch === persisted.epoch && authorization.checkpoint.commitment !== persisted.commitment))) throw new Error('Sync checkpoint is stale.');
        const current = await this.trust.snapshot();
        await this.trust.assertTrustedAt(current.list.epoch);
        this.transfer = new SyncTransferController(authorization, this.trust, this.now);
        this.expiresAt = authorization.expiresAt;
        this.checkpoint = authorization.checkpoint;
        await this.transfer.authorize();
        this.admission = 'prepare';
        await this.atomic(authorization.checkpoint, async (tx) => tx.writeState(this.scope, this.state(authorization.checkpoint)));
    }

    public async prepared(): Promise<void> { if (this.admission !== 'prepare' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'prepared'; await this.persistState(this.checkpoint!); }
    public async ready(): Promise<void> { if (this.admission !== 'prepared' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'ready'; await this.persistState(this.checkpoint!); }

    public begin(): void { if (!this.transfer || this.admission !== 'ready' || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); this.transfer.begin(); this.admission = 'transfer'; void this.persistState(this.checkpoint!); }

    public async receiveAuthenticated(frame: AuthenticatedSyncFrame & { package: SyncPackage }): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (frame.sessionBinding.length === 0 || frame.senderIdentityReference.length === 0) throw new Error('Authenticated sync frame rejected.');
        return this.receive(frame.package);
    }

    public async receive(pkg: SyncPackage): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (!this.transfer || this.admission !== 'transfer' || this.now() > this.expiresAt) throw new Error('Sync transfer is unavailable.');
        const receipt = await this.transfer.accept(pkg);
        const key = `${pkg.sender}:${pkg.receiver}:${pkg.streamId}:${pkg.sequence}`;
        await this.atomic(pkg.checkpoint, async (tx) => { if (!(await tx.claim(this.scope, key))) throw new Error('Sync package replayed.'); this.receivedSequences.add(pkg.sequence); await tx.writeState(this.scope, this.state(pkg.checkpoint)); });
        this.checkpoint = pkg.checkpoint;
        return receipt;
    }

    public complete(): void { if (!this.transfer || this.admission !== 'transfer') throw new Error('Sync transfer is unavailable.'); this.transfer.complete(); this.admission = 'idle'; void this.persistState(this.checkpoint!, 'completed'); }
    public fail(): void { this.transfer?.fail(); this.admission = 'idle'; if (this.checkpoint) void this.persistState(this.checkpoint, 'failed'); }

    private state(checkpoint: SyncCheckpoint, terminal?: 'completed' | 'failed'): SyncDurableState { return { scope: this.scope, version: 1, checkpoint, admission: this.admission, receivedSequences: [...this.receivedSequences].sort((a, b) => a - b), terminal }; }
    private async persistState(checkpoint: SyncCheckpoint, terminal?: 'completed' | 'failed'): Promise<void> { if (this.persistence.writeState) await this.persistence.writeState(this.scope, this.state(checkpoint, terminal)); }
    private async atomic<T>(checkpoint: SyncCheckpoint, operation: (tx: SyncPersistenceTransaction) => Promise<T>): Promise<T> { if (!this.persistence.transaction) throw new Error('Durable sync persistence is unavailable.'); return this.persistence.transaction(this.scope, checkpoint, operation); }
}
