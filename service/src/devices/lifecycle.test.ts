import type { CryptoSession } from '../core/contracts';
import {
  createEnrollmentRequest,
  createDeviceEntry,
  createDeviceList,
  DeviceLifecycleService,
  type AuthenticatedDeviceContext,
  type AuthorizationRecord,
  type DeviceLifecyclePersistence,
  type DeviceAuthorization,
  type LifecycleStateSnapshot,
} from './index';
import { deviceListCommitment } from './canonicalEncoding';
import type { DeviceList } from './deviceIdentity';

const session: CryptoSession = {
  encrypted: true,
  ready: true,
  initialize: async () => undefined,
  encrypt: async () => ({ version: 1, strategy: 'test', data: {} }),
  decrypt: async () => new ArrayBuffer(0),
  destroy: () => undefined,
};

const context: AuthenticatedDeviceContext = {
  cryptoSession: session,
  conversationId: 'conversation-1',
  userScope: 'user-1',
  authenticatedSender: { deviceId: 'device-a', identityReference: 'identity-a', userScope: 'user-1', verified: true },
};

class TestPersistence implements DeviceLifecyclePersistence {
  public state!: LifecycleStateSnapshot;
  public records: AuthorizationRecord[] = [];
  public async read(): Promise<LifecycleStateSnapshot> { return this.state; }
  private commit(input: { expectedEpoch: number; previousCommitment: string; nextList: DeviceList; nextCommitment: string; authorization: AuthorizationRecord }): void {
    if (this.state.list.epoch !== input.expectedEpoch || this.state.commitment !== input.previousCommitment) throw new Error('atomic conflict');
    if (this.records.some((record) => record.transactionNonce === input.authorization.transactionNonce)) throw new Error('replay');
    this.records.push(input.authorization);
    this.state = { list: input.nextList, commitment: input.nextCommitment };
  }
  public async commitEnrollment(input: { scope: string; expectedEpoch: number; previousCommitment: string; nextList: DeviceList; nextCommitment: string; authorization: AuthorizationRecord }): Promise<void> { this.commit(input); }
  public async commitRevocation(input: { scope: string; expectedEpoch: number; previousCommitment: string; nextList: DeviceList; nextCommitment: string; authorization: AuthorizationRecord }): Promise<void> { this.commit(input); }
}

const makePersistence = async (): Promise<TestPersistence> => {
  const persistence = new TestPersistence();
  const initial = createDeviceList({ version: 1, identityReference: 'user-1', epoch: 0, previousCommitment: null,
    devices: [createDeviceEntry({ deviceId: 'device-a', publicIdentityReference: 'identity-a', algorithm: 'vodozemac-v1', state: 'active', createdAt: 1_000 })] });
  persistence.state = { list: initial, commitment: await deviceListCommitment(initial) };
  return persistence;
};

describe('Phase 6B.2/6B.3 device lifecycle', () => {
  it('enrolls and then revokes a device with chained epochs and commitments', async () => {
    const persistence = await makePersistence();
    const verifier = { verify: async (candidate: AuthenticatedDeviceContext, authorization: DeviceAuthorization) => {
      if (candidate.authenticatedSender.deviceId !== authorization.authorDeviceId || !candidate.cryptoSession.ready) throw new Error('invalid issuer');
    } };
    const service = new DeviceLifecycleService(persistence, verifier, () => 2_000);
    const request = createEnrollmentRequest({ userScope: 'user-1', requestedDeviceId: 'device-b', requestedPublicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', knownEpoch: 0, now: 1_500, transactionNonce: 'enrollment-nonce-1' });
    const approval = await service.approveEnrollment(request, context, { deviceId: 'device-b', publicIdentityReference: 'identity-b' });
    const enrolled = await service.applyEnrollment(approval, context);
    expect(enrolled.list.epoch).toBe(1);
    expect(enrolled.list.devices.find((entry) => entry.deviceId === 'device-b')?.state).toBe('active');
    expect(enrolled.list.previousCommitment).toBeTruthy();
    const revoke = await service.approveRevocation('device-b', context);
    const revoked = await service.applyRevocation(revoke, context);
    expect(revoked.list.epoch).toBe(2);
    expect(revoked.list.devices.find((entry) => entry.deviceId === 'device-b')?.state).toBe('revoked');
    expect(revoked.list.previousCommitment).toBe(enrolled.commitment);
    expect(revoked.commitment).not.toBe(enrolled.commitment);
  });

  it('rejects fake issuers, fake targets, expiry, replay, epoch and commitment tampering', async () => {
    const persistence = await makePersistence();
    const verifier = { verify: async (candidate: AuthenticatedDeviceContext, authorization: DeviceAuthorization) => {
      if (!candidate.authenticatedSender.verified || candidate.authenticatedSender.deviceId !== authorization.authorDeviceId || candidate.authenticatedSender.identityReference !== authorization.authorIdentityReference) throw new Error('invalid issuer');
    } };
    const service = new DeviceLifecycleService(persistence, verifier, () => 2_000);
    const request = createEnrollmentRequest({ userScope: 'user-1', requestedDeviceId: 'device-b', requestedPublicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', knownEpoch: 0, now: 1_000, ttlMs: 500, transactionNonce: 'enrollment-nonce-2' });
    await expect(service.approveEnrollment(request, context, { deviceId: 'device-c', publicIdentityReference: 'identity-c' })).rejects.toThrow('target');
    await expect(service.approveEnrollment(request, context, { deviceId: 'device-b', publicIdentityReference: 'identity-b' })).rejects.toThrow('expired');

    const validRequest = createEnrollmentRequest({ userScope: 'user-1', requestedDeviceId: 'device-b', requestedPublicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', knownEpoch: 0, now: 1_500, transactionNonce: 'enrollment-nonce-3' });
    const approval = await service.approveEnrollment(validRequest, context, { deviceId: 'device-b', publicIdentityReference: 'identity-b' });
    await expect(service.applyEnrollment({ ...approval, authorDeviceId: 'fake-device' }, context)).rejects.toThrow('invalid issuer');
    await expect(service.applyEnrollment({ ...approval, targetDeviceId: 'device-c' }, context)).rejects.toThrow('authorization');
    await expect(service.applyEnrollment({ ...approval, previousEpoch: 99 }, context)).rejects.toThrow('authorization');
    await expect(service.applyEnrollment({ ...approval, authorizationDigest: '0'.repeat(64) }, context)).rejects.toThrow('authorization');
    await service.applyEnrollment(approval, context);
    await expect(service.applyEnrollment(approval, context)).rejects.toThrow();
  });

  it('rejects unauthorized, repeated, and rollback revocation', async () => {
    const persistence = await makePersistence();
    const verifier = { verify: async (candidate: AuthenticatedDeviceContext, authorization: DeviceAuthorization) => {
      if (!candidate.authenticatedSender.verified || candidate.authenticatedSender.deviceId !== authorization.authorDeviceId) throw new Error('invalid issuer');
    } };
    const service = new DeviceLifecycleService(persistence, verifier, () => 2_000);
    const req = createEnrollmentRequest({ userScope: 'user-1', requestedDeviceId: 'device-b', requestedPublicIdentityReference: 'identity-b', algorithm: 'vodozemac-v1', knownEpoch: 0, now: 1_500, transactionNonce: 'enrollment-nonce-4' });
    const enrolled = await service.applyEnrollment(await service.approveEnrollment(req, context, { deviceId: 'device-b', publicIdentityReference: 'identity-b' }), context);
    const revoke = await service.approveRevocation('device-b', context);
    await expect(service.applyRevocation({ ...revoke, previousEpoch: 0 }, context)).rejects.toThrow('authorization');
    await service.applyRevocation(revoke, context);
    await expect(service.applyRevocation(revoke, context)).rejects.toThrow();
    expect(enrolled.list.epoch).toBe(1);
  });

  it('binds mutations to the authenticated sender and scope, not authorization fields', async () => {
    const persistence = await makePersistence();
    const verifier = { verify: async (candidate: AuthenticatedDeviceContext, authorization: DeviceAuthorization) => {
      const sender = candidate.authenticatedSender;
      if (!sender.verified || sender.deviceId !== authorization.authorDeviceId || sender.identityReference !== authorization.authorIdentityReference || sender.userScope !== candidate.userScope) throw new Error('invalid authenticated sender');
    } };
    const service = new DeviceLifecycleService(persistence, verifier, () => 2_000);
    const request = createEnrollmentRequest({ userScope: 'user-1', requestedDeviceId: 'device-c', requestedPublicIdentityReference: 'identity-c', algorithm: 'vodozemac-v1', knownEpoch: 0, now: 1_500, transactionNonce: 'enrollment-nonce-5' });
    const approval = await service.approveEnrollment(request, context, { deviceId: 'device-c', publicIdentityReference: 'identity-c' });
    await expect(service.applyEnrollment(approval, { ...context, authenticatedSender: { ...context.authenticatedSender, deviceId: 'device-b' } })).rejects.toThrow('invalid authenticated sender');
    await expect(service.applyEnrollment(approval, { ...context, userScope: 'other-user', authenticatedSender: { ...context.authenticatedSender, userScope: 'other-user' } })).rejects.toThrow('authorization');
    await expect(service.applyEnrollment({ ...approval, authorIdentityReference: 'forged-identity' }, context)).rejects.toThrow('invalid authenticated sender');
    await service.applyEnrollment(approval, context);
    const revoke = await service.approveRevocation('device-c', context);
    await expect(service.applyRevocation(revoke, { ...context, authenticatedSender: { ...context.authenticatedSender, verified: false } })).rejects.toThrow('Authenticated device context unavailable');
  });
});
