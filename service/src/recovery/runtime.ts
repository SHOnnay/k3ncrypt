import { RecoveryArchiveBoundary, WebCryptoRecoveryArchiveCrypto } from './archive';
import { RecoveryCeremony } from './ceremony';
import type { RecoveryArchive, RecoveryPersistence, RecoveryReplacementContext, RecoveryTrustReplacementBoundary } from './contracts';
import { RecoveryIdentityReplacementWorkflow } from './replacement';

/** Authenticates that the recovery operation belongs to the account being replaced. */
export interface AuthenticatedRecoveryAuthority {
    authorize(archive: RecoveryArchive, replacement: RecoveryReplacementContext): Promise<void>;
}

/**
 * Product-facing recovery composition. The user-owned secret authenticates the
 * archive; the authority binds that archive to the account replacement, and
 * the ceremony retains replay/expiry state. No recovery key is server-held.
 */
export class RecoveryRuntime {
    private readonly archive = new RecoveryArchiveBoundary(new WebCryptoRecoveryArchiveCrypto());
    private readonly ceremony: RecoveryCeremony;
    private readonly replacement: RecoveryIdentityReplacementWorkflow;
    private stagedContext?: RecoveryReplacementContext;

    public constructor(private readonly persistence: RecoveryPersistence, trust: RecoveryTrustReplacementBoundary, private readonly authority: AuthenticatedRecoveryAuthority, now = Date.now) {
        this.ceremony = new RecoveryCeremony({ verify: async (candidate, secret) => {
            const plaintext = await this.archive.open(candidate, secret, true);
            plaintext.fill(0);
        } }, persistence, now);
        this.replacement = new RecoveryIdentityReplacementWorkflow(trust);
    }

    public async stage(archive: RecoveryArchive, secret: Uint8Array, context: RecoveryReplacementContext, userAction: boolean): Promise<void> {
        if (!userAction) throw new Error('Recovery request rejected.');
        await this.authority.authorize(archive, context);
        await this.ceremony.stage(archive, secret, context);
        this.stagedContext = Object.freeze({ ...context });
        this.ceremony.requestReplacementConfirmation();
    }

    public async confirm(userAction: boolean): Promise<{ readonly newScope: string; readonly invalidatedDeviceIds: readonly string[] }> {
        const context = this.stagedContext ?? await this.persistence.readPending?.();
        if (!userAction || !context || (this.stagedContext && this.ceremony.state !== 'replacement-pending')) throw new Error('Recovery confirmation unavailable.');
        const result = await this.replacement.replace(context, true);
        if (this.stagedContext) await this.ceremony.confirmReplacement();
        else await this.persistence.complete(context.replacementId);
        return result;
    }

    public async reject(userAction: boolean): Promise<void> {
        if (!userAction) throw new Error('Recovery rejection unavailable.');
        await this.ceremony.rejectReplacement();
    }
}
