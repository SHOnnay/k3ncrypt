import type { SecureStorage } from '../core/contracts';
import { adoptApprovedAccountBinding, type LocalAccountBinding } from '../identity/accountBinding';
import type { AuthenticatedDeviceContext, DeviceAuthorization, DeviceLifecyclePersistence, DeviceLifecycleService, EnrollmentConfirmation, EnrollmentRequest, LifecycleStateSnapshot } from './lifecycle';
import { createEnrollmentConfirmation, createEnrollmentRequest } from './lifecycle';

/** Explicit, two-party account-device ceremony. Only public device metadata crosses the boundary. */
export class AuthenticatedDeviceJoinService {
    public constructor(private readonly sourceLifecycle: DeviceLifecycleService, private readonly targetStorage: SecureStorage, private readonly targetPersistence: DeviceLifecyclePersistence, private readonly now: () => number = Date.now) {}

    public createRequest(input: { userScope: string; deviceId: string; identityReference: string; algorithm: string; epoch: number; ttlMs?: number }): EnrollmentRequest {
        return createEnrollmentRequest({ userScope: input.userScope, requestedDeviceId: input.deviceId, requestedPublicIdentityReference: input.identityReference, algorithm: input.algorithm, knownEpoch: input.epoch, ttlMs: input.ttlMs, now: this.now() });
    }

    public async approve(request: EnrollmentRequest, sourceContext: AuthenticatedDeviceContext, target: { deviceId: string; identityReference: string }): Promise<DeviceAuthorization> {
        const authorization = await this.sourceLifecycle.approveEnrollment(request, sourceContext, { deviceId: target.deviceId, publicIdentityReference: target.identityReference });
        await this.sourceLifecycle.applyEnrollment(authorization, sourceContext);
        return authorization;
    }

    public async confirm(authorization: DeviceAuthorization, targetContext: AuthenticatedDeviceContext): Promise<{ binding: LocalAccountBinding; state: LifecycleStateSnapshot }> {
        if (targetContext.userScope !== authorization.userScope || targetContext.authenticatedSender.deviceId !== authorization.targetDeviceId || targetContext.authenticatedSender.identityReference !== authorization.targetPublicIdentityReference) throw new Error('Device join target rejected.');
        const confirmation: EnrollmentConfirmation = await createEnrollmentConfirmation({
            version: 1,
            authorizationDigest: authorization.authorizationDigest,
            targetDeviceId: authorization.targetDeviceId,
            targetIdentityReference: authorization.targetPublicIdentityReference!,
            confirmationNonce: `${authorization.transactionNonce}-target`,
            confirmedAt: this.now(),
            expiresAt: authorization.expiresAt,
        });
        const state = await this.sourceLifecycle.confirmEnrollment(authorization, targetContext, confirmation);
        const target = state.list.devices.find((entry) => entry.deviceId === authorization.targetDeviceId);
        if (!target || target.state !== 'active') throw new Error('Device join activation failed.');
        if (!this.targetPersistence.initialize) throw new Error('Target lifecycle persistence is unavailable.');
        const targetState = await this.targetPersistence.initialize(authorization.userScope, state.list);
        const binding = await adoptApprovedAccountBinding(this.targetStorage, authorization.targetPublicIdentityReference!, authorization.userScope, authorization.targetDeviceId);
        return { binding, state: targetState };
    }
}
