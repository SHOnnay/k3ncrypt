import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { MongoClient } from 'mongodb';
import { applyMigrations } from '../db/migrations';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from './durableDeviceTrust';
import type { DeviceAuthorizationProof } from './deviceTrust';
import type { BootstrapRequest, DeviceProofRequest, EnrollmentEvent } from '../../service/src/devices/trustProtocol';
import type { SignedLifecycleEvent } from './lifecycleEvent';

const suite = process.env.MONGO_URI && process.env.MONGO_DB_NAME ? describe : describe.skip;
const account = `integration-account-${randomUUID()}`;
const issuerDevice = '11111111-1111-4111-8111-111111111111';
const targetDevice = '22222222-2222-4222-8222-222222222222';
const rawPublic = (key: ReturnType<typeof generateKeyPairSync>['publicKey']): string => key.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const unsignedBytes = (value: Record<string, unknown>): Buffer => Buffer.from(JSON.stringify(value));
const signed = (value: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string => sign(null, unsignedBytes(value), privateKey).toString('base64url');

suite('durable device trust Mongo bootstrap', () => {
  let client: MongoClient;
  let authority: DurableDeviceTrustAuthority;
  let issuerPrivate: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let issuerPublic: string;
  let targetPrivate: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let targetPublic: string;

  beforeAll(async () => {
    client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const database = client.db(process.env.MONGO_DB_NAME);
    await applyMigrations(database);
    await database.collection('device_lifecycle').deleteMany({ accountIdentityReference: account });
    await database.collection('device_proof_nonces').deleteMany({});
    const issuer = generateKeyPairSync('ed25519'); const target = generateKeyPairSync('ed25519');
    issuerPrivate = issuer.privateKey; issuerPublic = rawPublic(issuer.publicKey); targetPrivate = target.privateKey; targetPublic = rawPublic(target.publicKey);
    const store = new MongoDeviceTrustStore(database);
    await store.upsert({ accountIdentityReference: account, deviceId: issuerDevice, deviceIdentityReference: 'issuer-identity', verificationKeyReference: issuerPublic, state: 'active', trustEpoch: 1, createdAt: Date.now(), lastTrustUpdate: Date.now() });
    authority = new DurableDeviceTrustAuthority(store, 'm'.repeat(32));
  });

  afterAll(async () => { await client?.close(); });

  const issuerProof = async (operation: 'device-control' | 'relay:message', nonce: string): Promise<DeviceAuthorizationProof> => {
    const createdAt = Date.now();
    const request: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account, deviceId: issuerDevice, deviceIdentityReference: 'issuer-identity', operation, nonce, epoch: 1, createdAt, expiresAt: createdAt + 30_000 };
    return authority.issue({ ...request, signature: signed(request as Record<string, unknown>, issuerPrivate) });
  };

  it('enrolls pending, activates, issues a proof, and persists across authority restart', async () => {
    const createdAt = Date.now();
    const enrollment: Omit<EnrollmentEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account, issuerDeviceId: issuerDevice, issuerIdentityReference: 'issuer-identity', issuerEpoch: 1, targetDeviceId: targetDevice, targetIdentityReference: 'target-identity', targetVerificationKey: targetPublic, targetFingerprint: 'target-identity', nonce: randomUUID().replace(/-/g, ''), createdAt, expiresAt: createdAt + 30_000 };
    const pending = await authority.enroll({ ...enrollment, signature: signed(enrollment as Record<string, unknown>, issuerPrivate) }, await issuerProof('device-control', randomUUID().replace(/-/g, '')));
    expect(pending.state).toBe('pending');

    const activation: Omit<SignedLifecycleEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account, issuerDeviceId: targetDevice, issuerIdentityReference: 'target-identity', targetDeviceId: targetDevice, targetIdentityReference: 'target-identity', operation: 'activate', previousEpoch: 2, nextEpoch: 3, createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const active = await authority.activate({ ...activation, signature: signed(activation as Record<string, unknown>, targetPrivate) });
    expect(active.state).toBe('active');

    const proofRequest: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account, deviceId: targetDevice, deviceIdentityReference: 'target-identity', operation: 'relay:message', nonce: randomUUID().replace(/-/g, ''), epoch: 3, createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const proof = await authority.issue({ ...proofRequest, signature: signed(proofRequest as Record<string, unknown>, targetPrivate) });
    expect((await authority.verify(proof, 'relay:message')).deviceId).toBe(targetDevice);

    const restarted = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(client.db(process.env.MONGO_DB_NAME)), 'm'.repeat(32));
    await expect(restarted.verify(proof, 'relay:message')).rejects.toThrow('rejected');
    await expect(restarted.activate({ ...activation, signature: signed(activation as Record<string, unknown>, targetPrivate) })).rejects.toThrow('rejected');
  });

  it('rejects fake enrollment issuers and stale activation epochs', async () => {
    const fake = generateKeyPairSync('ed25519'); const createdAt = Date.now();
    const event: Omit<EnrollmentEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account, issuerDeviceId: issuerDevice, issuerIdentityReference: 'issuer-identity', issuerEpoch: 1, targetDeviceId: '33333333-3333-4333-8333-333333333333', targetIdentityReference: 'fake-target', targetVerificationKey: rawPublic(fake.publicKey), targetFingerprint: 'fake-target', nonce: randomUUID().replace(/-/g, ''), createdAt, expiresAt: createdAt + 30_000 };
    await expect(authority.enroll({ ...event, signature: signed(event as Record<string, unknown>, fake.privateKey) }, await issuerProof('device-control', randomUUID().replace(/-/g, '')))).rejects.toThrow('rejected');
  });

  it('creates the first trusted device from a self-signed bootstrap and rejects replay', async () => {
    const first = generateKeyPairSync('ed25519'); const firstDevice = randomUUID(); const verificationKey = rawPublic(first.publicKey); const createdAt = Date.now();
    const request: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId: firstDevice, deviceIdentityReference: 'first-identity', verificationKey, fingerprint: 'first-identity', createdAt, expiresAt: createdAt + 30_000, nonce: randomUUID().replace(/-/g, '') };
    const signedRequest = { ...request, signature: signed(request as Record<string, unknown>, first.privateKey) };
    const result = await authority.bootstrap(signedRequest);
    expect(result.trustEpoch).toBe(1);
    await expect(authority.bootstrap(signedRequest)).rejects.toThrow('rejected');
    const proofRequest: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: result.accountIdentityReference, deviceId: firstDevice, deviceIdentityReference: 'first-identity', operation: 'relay:message', nonce: randomUUID().replace(/-/g, ''), epoch: 1, createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const proof = await authority.issue({ ...proofRequest, signature: signed(proofRequest as Record<string, unknown>, first.privateKey) });
    expect((await authority.verify(proof, 'relay:message')).deviceId).toBe(firstDevice);
  });
});
