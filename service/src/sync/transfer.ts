import { authorizeSync } from './authorization';
import { syncContentCommitment, syncDigest } from './codec';
import { decodeSyncPackage, encodeSyncPackage } from './codec';
import type { SyncAcknowledgement, SyncAuthorization, SyncCompletionManifest, SyncPackage, SyncTrustBoundary } from './contracts';
import { SyncStateMachine } from './stateMachine';

/** Application adapter for one recipient-specific transfer. It never owns keys. */
export class SyncTransferController {
    public readonly state = new SyncStateMachine('pending', 'created');
    public get members(): readonly string[] { return this.authorization.activeMemberDeviceIds ?? [this.authorization.sourceDeviceId, this.authorization.targetDeviceId]; }
    public get freshnessRequired(): boolean { return this.authorization.freshnessRequired === true; }
    public get membershipEvidenceRequired(): boolean { return this.authorization.activeMemberDeviceIds !== undefined; }
    private readonly received = new Map<number, string>();
    private readonly chunks = new Map<number, string>();
    private manifest?: SyncCompletionManifest;
    public constructor(private readonly authorization: SyncAuthorization, private readonly trust: SyncTrustBoundary, private readonly now = Date.now) {}

    public async authorize(): Promise<void> {
        await authorizeSync(this.authorization, this.trust, this.now());
        this.state.transitionDevice('approved');
        this.state.transitionTransfer('authorized');
    }

    public begin(): void { this.state.transitionDevice('syncing'); this.state.transitionTransfer('transferring'); }

    public async accept(pkg: SyncPackage): Promise<SyncAcknowledgement> {
        pkg = decodeSyncPackage(encodeSyncPackage(pkg));
        if (pkg.senderIdentity !== this.authorization.sourceIdentityReference || pkg.receiverIdentity !== this.authorization.targetIdentityReference || this.now() >= this.authorization.expiresAt) throw new Error('Sync identity or expiry rejected.');
        if (this.state.device !== 'syncing' || this.state.transfer !== 'transferring') throw new Error('Sync transfer is unavailable.');
        if (pkg.scope !== this.authorization.scope || pkg.sender !== this.authorization.sourceDeviceId || pkg.receiver !== this.authorization.targetDeviceId || pkg.transferId !== this.authorization.transferId || pkg.checkpoint.epoch !== this.authorization.checkpoint.epoch || pkg.checkpoint.commitment !== this.authorization.checkpoint.commitment) throw new Error('Sync package authorization rejected.');
        await this.trust.assertTrustedAt(pkg.checkpoint.epoch);
        const digest = await syncDigest(pkg);
        const prior = this.received.get(pkg.sequence);
        if (prior && prior !== digest) { this.state.suspend(); throw new Error('Sync sequence conflict.'); }
        if (pkg.purpose === 'sync-manifest') {
            if (this.manifest) throw new Error('Sync manifest replayed.');
            this.manifest = Object.freeze({ ...(pkg.payload as SyncCompletionManifest) });
        } else if (pkg.purpose === 'sync-chunk' || pkg.purpose === 'sync-delta') {
            this.chunks.set(pkg.sequence, digest);
        }
        this.received.set(pkg.sequence, digest);
        return { transferId: this.authorization.transferId, checkpoint: this.authorization.checkpoint, sequence: pkg.sequence, digest };
    }

    public async complete(): Promise<void> {
        if (!this.manifest || this.chunks.size !== this.manifest.expectedChunkCount) throw new Error('Sync transfer is incomplete.');
        const commitment = await syncContentCommitment(this.authorization.transferId, [...this.chunks].map(([sequence, digest]) => ({ sequence, digest })));
        if (commitment !== this.manifest.finalContentCommitment) { this.state.suspend(); throw new Error('Sync content commitment rejected.'); }
        this.state.transitionTransfer('verified'); this.state.transitionTransfer('completed'); this.state.transitionDevice('approved');
    }
    public fail(): void { if (this.state.transfer !== 'completed') this.state.transitionTransfer('failed'); this.state.transitionDevice('suspended'); }
}
