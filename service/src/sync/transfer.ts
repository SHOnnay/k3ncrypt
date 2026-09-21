import { authorizeSync } from './authorization';
import { syncDigest } from './codec';
import type { SyncAcknowledgement, SyncAuthorization, SyncPackage, SyncTrustBoundary } from './contracts';
import { SyncStateMachine } from './stateMachine';

/** Application adapter for one recipient-specific transfer. It never owns keys. */
export class SyncTransferController {
    public readonly state = new SyncStateMachine('pending', 'created');
    private readonly received = new Map<number, string>();
    public constructor(private readonly authorization: SyncAuthorization, private readonly trust: SyncTrustBoundary, private readonly now = Date.now) {}

    public async authorize(): Promise<void> {
        await authorizeSync(this.authorization, this.trust, this.now());
        this.state.transitionDevice('approved');
        this.state.transitionTransfer('authorized');
    }

    public begin(): void { this.state.transitionDevice('syncing'); this.state.transitionTransfer('transferring'); }

    public async accept(pkg: SyncPackage): Promise<SyncAcknowledgement> {
        if (this.state.device !== 'syncing' || this.state.transfer !== 'transferring') throw new Error('Sync transfer is unavailable.');
        if (pkg.scope !== this.authorization.scope || pkg.sender !== this.authorization.sourceDeviceId || pkg.receiver !== this.authorization.targetDeviceId || pkg.transferId !== this.authorization.transferId || pkg.checkpoint.epoch !== this.authorization.checkpoint.epoch || pkg.checkpoint.commitment !== this.authorization.checkpoint.commitment) throw new Error('Sync package authorization rejected.');
        await this.trust.assertTrustedAt(pkg.checkpoint.epoch);
        const digest = await syncDigest(pkg);
        const prior = this.received.get(pkg.sequence);
        if (prior && prior !== digest) { this.state.suspend(); throw new Error('Sync sequence conflict.'); }
        this.received.set(pkg.sequence, digest);
        return { transferId: this.authorization.transferId, checkpoint: this.authorization.checkpoint, sequence: pkg.sequence, digest };
    }

    public complete(): void { if (this.received.size === 0) throw new Error('Sync transfer has no verified packages.'); this.state.transitionTransfer('verified'); this.state.transitionTransfer('completed'); this.state.transitionDevice('approved'); }
    public fail(): void { if (this.state.transfer !== 'completed') this.state.transitionTransfer('failed'); this.state.transitionDevice('suspended'); }
}
