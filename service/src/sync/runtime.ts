import type { SyncAdmissionState, SyncAuthorization, SyncPackage, SyncPersistence, SyncTrustBoundary } from './contracts';
import { SyncTransferController } from './transfer';
import type { AuthenticatedSyncFrame } from './authenticatedTransport';

/** Runtime composition boundary. Persistence implementations are supplied by the application. */
export class RuntimeSyncController {
    private transfer?: SyncTransferController;
    private admission: SyncAdmissionState = 'idle';
    private expiresAt = 0;
    public constructor(private readonly scope: string, private readonly localDeviceId: string, private readonly trust: SyncTrustBoundary, private readonly persistence: SyncPersistence, private readonly now = Date.now) {}

    public async authorize(authorization: SyncAuthorization): Promise<void> {
        if (authorization.scope !== this.scope || authorization.targetDeviceId !== this.localDeviceId) throw new Error('Sync target is unavailable.');
        const persisted = await this.persistence.read(this.scope);
        if (persisted && (authorization.checkpoint.epoch < persisted.epoch || (authorization.checkpoint.epoch === persisted.epoch && authorization.checkpoint.commitment !== persisted.commitment))) throw new Error('Sync checkpoint is stale.');
        const current = await this.trust.snapshot();
        await this.trust.assertTrustedAt(current.list.epoch);
        this.transfer = new SyncTransferController(authorization, this.trust, this.now);
        this.expiresAt = authorization.expiresAt;
        await this.transfer.authorize();
        this.admission = 'prepare';
        await this.persistence.write(this.scope, authorization.checkpoint);
    }

    public async prepared(): Promise<void> { if (this.admission !== 'prepare' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'prepared'; }
    public async ready(): Promise<void> { if (this.admission !== 'prepared' || !this.transfer || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); const snapshot = await this.trust.snapshot(); await this.trust.assertTrustedAt(snapshot.list.epoch); this.admission = 'ready'; }

    public begin(): void { if (!this.transfer || this.admission !== 'ready' || this.now() > this.expiresAt) throw new Error('Sync admission is unavailable.'); this.transfer.begin(); this.admission = 'transfer'; }

    public async receiveAuthenticated(frame: AuthenticatedSyncFrame & { package: SyncPackage }): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (frame.sessionBinding.length === 0 || frame.senderIdentityReference.length === 0) throw new Error('Authenticated sync frame rejected.');
        return this.receive(frame.package);
    }

    public async receive(pkg: SyncPackage): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (!this.transfer || this.admission !== 'transfer' || this.now() > this.expiresAt) throw new Error('Sync transfer is unavailable.');
        const key = `${pkg.sender}:${pkg.receiver}:${pkg.streamId}:${pkg.sequence}`;
        if (!(await this.persistence.claim(this.scope, key))) throw new Error('Sync package replayed.');
        const receipt = await this.transfer.accept(pkg);
        await this.persistence.write(this.scope, pkg.checkpoint);
        return receipt;
    }

    public complete(): void { if (!this.transfer || this.admission !== 'transfer') throw new Error('Sync transfer is unavailable.'); this.transfer.complete(); this.admission = 'idle'; }
    public fail(): void { this.transfer?.fail(); this.admission = 'idle'; }
}
