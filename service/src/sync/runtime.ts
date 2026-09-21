import type { SyncAuthorization, SyncPackage, SyncPersistence, SyncTrustBoundary } from './contracts';
import { SyncTransferController } from './transfer';

/** Runtime composition boundary. Persistence implementations are supplied by the application. */
export class RuntimeSyncController {
    private transfer?: SyncTransferController;
    public constructor(private readonly scope: string, private readonly localDeviceId: string, private readonly trust: SyncTrustBoundary, private readonly persistence: SyncPersistence, private readonly now = Date.now) {}

    public async authorize(authorization: SyncAuthorization): Promise<void> {
        if (authorization.scope !== this.scope || authorization.targetDeviceId !== this.localDeviceId) throw new Error('Sync target is unavailable.');
        const persisted = await this.persistence.read(this.scope);
        if (persisted && (authorization.checkpoint.epoch < persisted.epoch || (authorization.checkpoint.epoch === persisted.epoch && authorization.checkpoint.commitment !== persisted.commitment))) throw new Error('Sync checkpoint is stale.');
        const current = await this.trust.snapshot();
        await this.trust.assertTrustedAt(current.list.epoch);
        this.transfer = new SyncTransferController(authorization, this.trust, this.now);
        await this.transfer.authorize();
        await this.persistence.write(this.scope, authorization.checkpoint);
    }

    public begin(): void { if (!this.transfer) throw new Error('Sync authorization is unavailable.'); this.transfer.begin(); }

    public async receive(pkg: SyncPackage): Promise<ReturnType<SyncTransferController['accept']> extends Promise<infer A> ? A : never> {
        if (!this.transfer) throw new Error('Sync authorization is unavailable.');
        const key = `${pkg.sender}:${pkg.receiver}:${pkg.streamId}:${pkg.sequence}`;
        if (!(await this.persistence.claim(this.scope, key))) throw new Error('Sync package replayed.');
        const receipt = await this.transfer.accept(pkg);
        await this.persistence.write(this.scope, pkg.checkpoint);
        return receipt;
    }

    public complete(): void { if (!this.transfer) throw new Error('Sync authorization is unavailable.'); this.transfer.complete(); }
    public fail(): void { this.transfer?.fail(); }
}
