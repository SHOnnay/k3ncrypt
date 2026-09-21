import type { RecoveryReplacementContext, RecoveryTrustReplacementBoundary } from './contracts';

export class RecoveryIdentityReplacementWorkflow {
    public constructor(private readonly trust: RecoveryTrustReplacementBoundary) {}
    public async replace(context: RecoveryReplacementContext, userAction: boolean): Promise<{ readonly newScope: string; readonly invalidatedDeviceIds: readonly string[] }> {
        if (!userAction || !context.replacementId || !context.oldFingerprint || !context.newFingerprint || context.oldFingerprint === context.newFingerprint) throw new Error('Identity replacement rejected.');
        const result = await this.trust.replaceIdentity(context, true);
        if (!result.newScope || result.invalidatedDeviceIds.length === 0) throw new Error('Identity replacement failed closed.');
        await this.trust.resetContactTrust(result.newScope);
        return result;
    }
}
