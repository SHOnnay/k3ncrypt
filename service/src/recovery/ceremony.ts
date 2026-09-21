import type { RecoveryArchive, RecoveryCeremonyState, RecoveryMaterialVerifier, RecoveryPersistence, RecoveryReplacementContext } from './contracts';

export class RecoveryCeremony {
    private stateValue: RecoveryCeremonyState = 'idle';
    private replacement?: RecoveryReplacementContext;
    public constructor(private readonly verifier: RecoveryMaterialVerifier, private readonly persistence: RecoveryPersistence, private readonly now = Date.now) {}
    public get state(): RecoveryCeremonyState { return this.stateValue; }
    public get context(): RecoveryReplacementContext | undefined { return this.replacement; }

    public async stage(archive: RecoveryArchive, secret: Uint8Array, context: RecoveryReplacementContext): Promise<void> {
        if (this.stateValue !== 'idle' || !archive || archive.manifest.version !== 1 || archive.manifest.expiresAt !== undefined && archive.manifest.expiresAt <= this.now() || context.oldFingerprint === context.newFingerprint || !context.replacementId) throw new Error('Recovery request rejected.');
        if (!(await this.persistence.claim(archive.manifest.archiveId))) throw new Error('Recovery request replayed.');
        await this.verifier.verify(archive, secret);
        await this.persistence.stage(archive, context);
        this.replacement = context;
        this.stateValue = 'staged';
    }

    public requestReplacementConfirmation(): void { if (this.stateValue !== 'staged') throw new Error('Recovery confirmation unavailable.'); this.stateValue = 'replacement-pending'; }
    public async confirmReplacement(): Promise<void> { if (this.stateValue !== 'replacement-pending' || !this.replacement) throw new Error('Recovery confirmation unavailable.'); await this.persistence.complete(this.replacement.replacementId); this.stateValue = 'completed'; }
    public async rejectReplacement(): Promise<void> { if (!this.replacement || !['staged', 'replacement-pending'].includes(this.stateValue)) throw new Error('Recovery rejection unavailable.'); await this.persistence.reject(this.replacement.replacementId); this.stateValue = 'rejected'; }
}
