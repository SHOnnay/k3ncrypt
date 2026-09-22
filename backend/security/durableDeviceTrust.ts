import type { Collection, Db } from 'mongodb';
import type { DeviceLifecycleRecord } from './deviceTrust';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import type { BootstrapRequest, EnrollmentEvent, DeviceProofRequest, DeviceResourceContext } from '../../service/src/devices/trustProtocol';
import type { SignedLifecycleEvent } from './lifecycleEvent';
import { verifyBootstrapSignature, verifyDeviceControlSignature, verifyLifecycleEvent } from './lifecycleEvent';

const deviceOperations = new Set<import('./deviceTrust').DeviceOperation>(['relay:message', 'relay:signal', 'attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete', 'private-network:relay', 'bridge:authorize', 'device-control']);

export type ConsumedProofRecord = { proofId: string; deviceId: string; expiresAt: Date; consumedAt: Date };

/** Mongo persistence for public lifecycle metadata and one-time proof claims. */
export class MongoDeviceTrustStore {
  private readonly devices: Collection<DeviceLifecycleRecord>;
  private readonly proofs: Collection<ConsumedProofRecord>;
  constructor(database: Db) { this.devices = database.collection<DeviceLifecycleRecord>('device_lifecycle'); this.proofs = database.collection<ConsumedProofRecord>('device_proof_nonces'); }
  async read(accountIdentityReference: string, deviceId: string): Promise<DeviceLifecycleRecord | undefined> { return (await this.devices.findOne({ accountIdentityReference, deviceId })) ?? undefined; }
  async readAnyDevice(deviceId: string): Promise<DeviceLifecycleRecord | undefined> { return (await this.devices.findOne({ deviceId })) ?? undefined; }
  async upsert(record: DeviceLifecycleRecord, expectedEpoch?: number): Promise<boolean> {
    const filter: Record<string, unknown> = { accountIdentityReference: record.accountIdentityReference, deviceId: record.deviceId };
    if (expectedEpoch !== undefined) filter.trustEpoch = expectedEpoch;
    // `createdAt` is part of the record and is already included in `$set`.
    // Repeating it in `$setOnInsert` causes MongoDB path-conflict errors.
    const result = await this.devices.updateOne(filter, { $set: record }, { upsert: expectedEpoch === undefined });
    return result.matchedCount === 1 || result.upsertedCount === 1;
  }
  async consume(proofId: string, deviceId: string, expiresAt: number): Promise<boolean> {
    if (expiresAt <= Date.now()) return false;
    try { await this.proofs.insertOne({ proofId, deviceId, expiresAt: new Date(expiresAt), consumedAt: new Date() }); return true; } catch { return false; }
  }
}

/** Durable authority: only a verified Ed25519 control event can mutate lifecycle state. */
export class DurableDeviceTrustAuthority {
  constructor(private readonly store: MongoDeviceTrustStore, private readonly secret: string, private readonly now: () => number = Date.now) { if (secret.length < 32) throw new Error('Device trust proof secret is unavailable.'); }
  private sign(value: object): string { return createHmac('sha256', this.secret).update(`k3ncrypt-device-proof-v1\0${JSON.stringify(value)}`).digest('base64url'); }
  async bootstrap(request: BootstrapRequest): Promise<{ accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; trustEpoch: number }> {
    const now = this.now();
    if (request.version !== 1 || !/^[0-9a-f-]{36}$/i.test(request.requestId) || !/^[0-9a-f-]{36}$/i.test(request.deviceId) || !request.deviceIdentityReference || request.fingerprint !== request.deviceIdentityReference || !/^[A-Za-z0-9_-]{43}$/.test(request.verificationKey) || !/^[A-Za-z0-9_-]{16,128}$/.test(request.nonce) || request.createdAt > now || request.expiresAt <= now || request.expiresAt - request.createdAt > 5 * 60_000 || !verifyBootstrapSignature(request, request.verificationKey)) throw new Error('Initial device bootstrap rejected.');
    if (await this.store.readAnyDevice(request.deviceId) || !await this.store.consume(request.requestId, request.deviceId, request.expiresAt)) throw new Error('Initial device bootstrap rejected.');
    const accountIdentityReference = `account-${randomUUID()}`; const createdAt = now;
    const record: DeviceLifecycleRecord = { accountIdentityReference, deviceId: request.deviceId, deviceIdentityReference: request.deviceIdentityReference, verificationKeyReference: request.verificationKey, state: 'active', trustEpoch: 1, createdAt, lastTrustUpdate: createdAt };
    if (!await this.store.upsert(record)) throw new Error('Initial device bootstrap rejected.');
    return { accountIdentityReference, deviceId: request.deviceId, deviceIdentityReference: request.deviceIdentityReference, trustEpoch: 1 };
  }
  async enroll(event: EnrollmentEvent, issuerProof: import('./deviceTrust').DeviceAuthorizationProof): Promise<DeviceLifecycleRecord> {
    const now = this.now(); const target = await this.store.read(event.accountIdentityReference, event.targetDeviceId);
    const issuer = await this.store.read(event.accountIdentityReference, event.issuerDeviceId);
    const issuerKey = issuer?.verificationKeyReference;
    if (target || !issuer || issuer.state !== 'active' || !issuerKey || event.expiresAt <= now || event.createdAt > now ||
      event.issuerDeviceId === event.targetDeviceId || event.issuerEpoch !== issuer.trustEpoch ||
      event.issuerIdentityReference !== issuer.deviceIdentityReference || !event.targetFingerprint ||
      !verifyDeviceControlSignature(event, issuerKey)) throw new Error('Lifecycle enrollment rejected.');
    const verified = await this.verify(issuerProof, 'device-control');
    if (verified.accountIdentityReference !== event.accountIdentityReference || verified.deviceId !== event.issuerDeviceId || verified.deviceIdentityReference !== event.issuerIdentityReference || verified.trustEpoch !== event.issuerEpoch) throw new Error('Lifecycle enrollment rejected.');
    if (!await this.store.consume(event.eventId, event.issuerDeviceId, event.expiresAt)) throw new Error('Lifecycle enrollment rejected.');
    const record: DeviceLifecycleRecord = { accountIdentityReference: event.accountIdentityReference, deviceId: event.targetDeviceId, deviceIdentityReference: event.targetIdentityReference, verificationKeyReference: event.targetVerificationKey, state: 'pending', trustEpoch: event.issuerEpoch + 1, createdAt: now, lastTrustUpdate: now };
    if (!await this.store.upsert(record)) throw new Error('Lifecycle enrollment conflict.'); return record;
  }
  /** The enrolled device activates itself after local confirmation. Its durable epoch must advance exactly once. */
  async activate(event: SignedLifecycleEvent): Promise<DeviceLifecycleRecord> {
    const now = this.now(); const target = await this.store.read(event.accountIdentityReference, event.targetDeviceId);
    if (!target || target.state !== 'pending' || event.operation !== 'activate' || event.issuerDeviceId !== target.deviceId || event.issuerIdentityReference !== target.deviceIdentityReference || event.targetIdentityReference !== target.deviceIdentityReference || event.previousEpoch !== target.trustEpoch || event.nextEpoch !== target.trustEpoch + 1 || !verifyLifecycleEvent(event, target.verificationKeyReference, now) || !await this.store.consume(event.eventId, target.deviceId, event.expiresAt)) throw new Error('Lifecycle activation rejected.');
    const next: DeviceLifecycleRecord = { ...target, state: 'active', trustEpoch: event.nextEpoch, lastTrustUpdate: now };
    if (!await this.store.upsert(next, target.trustEpoch)) throw new Error('Lifecycle activation conflict.'); return next;
  }
  async update(event: SignedLifecycleEvent, issuerProof: import('./deviceTrust').DeviceAuthorizationProof): Promise<DeviceLifecycleRecord> {
    const now = this.now(); const issuer = await this.store.read(event.accountIdentityReference, event.issuerDeviceId); const target = await this.store.read(event.accountIdentityReference, event.targetDeviceId);
    if (!issuer || !target || issuer.state !== 'active' || target.state !== 'active' || event.operation !== 'revoke' || issuer.trustEpoch !== event.previousEpoch || target.trustEpoch !== event.previousEpoch || event.nextEpoch !== event.previousEpoch + 1 || !verifyLifecycleEvent(event, issuer.verificationKeyReference, now)) throw new Error('Lifecycle update rejected.');
    const verified = await this.verify(issuerProof, 'device-control');
    if (verified.accountIdentityReference !== event.accountIdentityReference || verified.deviceId !== event.issuerDeviceId || verified.trustEpoch !== event.previousEpoch) throw new Error('Lifecycle update rejected.');
    if (!await this.store.consume(event.eventId, event.issuerDeviceId, event.expiresAt)) throw new Error('Lifecycle update rejected.');
    const next: DeviceLifecycleRecord = { ...target, state: 'revoked', trustEpoch: event.nextEpoch, lastTrustUpdate: now, revokedAt: now };
    if (!await this.store.upsert(next, target.trustEpoch)) throw new Error('Lifecycle update conflict.'); return next;
  }
  async issue(request: DeviceProofRequest): Promise<import('./deviceTrust').DeviceAuthorizationProof> {
    const record = await this.store.read(request.accountIdentityReference, request.deviceId); const now = this.now();
    if (!record || record.state !== 'active' || !deviceOperations.has(request.operation as import('./deviceTrust').DeviceOperation) || record.deviceIdentityReference !== request.deviceIdentityReference || record.trustEpoch !== request.epoch || request.expiresAt <= now || request.createdAt > now || !verifyDeviceControlSignature(request, record.verificationKeyReference) || !await this.store.consume(request.requestId, request.deviceId, request.expiresAt)) throw new Error('Device proof request rejected.');
    const unsigned = { version: 1 as const, proofId: randomUUID(), accountIdentityReference: request.accountIdentityReference, deviceId: request.deviceId, deviceIdentityReference: request.deviceIdentityReference, operation: request.operation as import('./deviceTrust').DeviceOperation, trustEpoch: request.epoch, nonce: request.nonce, ...(request.resource ? { resource: request.resource } : {}), issuedAt: now, expiresAt: Math.min(request.expiresAt, now + 30_000) };
    return { ...unsigned, signature: this.sign(unsigned) };
  }
  async verify(proof: import('./deviceTrust').DeviceAuthorizationProof, expectedOperation: import('./deviceTrust').DeviceOperation, expectedResource?: DeviceResourceContext): Promise<DeviceLifecycleRecord> {
    const { signature, ...unsigned } = proof ?? {} as import('./deviceTrust').DeviceAuthorizationProof;
    const actual = Buffer.from(signature ?? ''); const expected = Buffer.from(this.sign(unsigned));
    if (!proof || proof.operation !== expectedOperation || proof.expiresAt <= this.now() || actual.length !== expected.length || !timingSafeEqual(actual, expected) || (expectedResource && JSON.stringify(proof.resource ?? {}) !== JSON.stringify(expectedResource))) throw new Error('Device proof rejected.');
    const record = await this.store.read(proof.accountIdentityReference, proof.deviceId);
    if (!record || record.state !== 'active' || record.deviceIdentityReference !== proof.deviceIdentityReference || record.trustEpoch !== proof.trustEpoch || !await this.store.consume(proof.proofId, proof.deviceId, proof.expiresAt)) throw new Error('Device proof rejected.');
    return record;
  }
}

export const durableDeviceTrustAuthority = (database: Db | undefined): DurableDeviceTrustAuthority | undefined => {
  const secret = process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET;
  return database && secret ? new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), secret) : undefined;
};
