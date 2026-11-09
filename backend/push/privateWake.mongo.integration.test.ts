import { MongoClient } from 'mongodb';
import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { canonicalPushEvent, MongoPushStore, PrivatePushRegistry, tokenHash, type PushEvent, type PushRow } from './privateWake';
import { applyWakeSchema } from './durableWakeStore';
import { applyMigrations } from '../db/migrations';
import type { BootstrapRequest, DeviceProofRequest } from '../../service/src/devices/trustProtocol';

const uri = process.env.K3NCRYPT_TEST_MONGO_URI;
const localSuite = uri ? describe : describe.skip;
localSuite('Mongo-backed private push token binding', () => {
  let client: MongoClient;
  let database: ReturnType<MongoClient['db']>;
  let authority: DurableDeviceTrustAuthority;
  let registry: PrivatePushRegistry;
  let store: MongoPushStore;
  beforeAll(async () => {
    const endpoint = new URL(uri!); if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Disposable loopback Mongo required');
    client = new MongoClient(uri!); await client.connect(); database = client.db(`k3ncrypt_test_android_push_${randomUUID().replace(/-/g, '')}`);
    await applyMigrations(database); await applyWakeSchema(database); store = new MongoPushStore(database, client);
    authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), 'synthetic-isolated-push-proof-secret'.repeat(2));
    registry = new PrivatePushRegistry(store, (proof) => authority.verify(proof, 'device-control'), () => true);
  });
  afterAll(async () => { if (database) await database.dropDatabase(); await client?.close(); });
  const own = async () => {
    const pair = generateKeyPairSync('ed25519'); const deviceId = randomUUID(); const identity = `synthetic-${randomUUID()}`; const now = Date.now();
    const value: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId, deviceIdentityReference: identity, verificationKey: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'), fingerprint: identity, createdAt: now, expiresAt: now + 30000, nonce: randomUUID().replace(/-/g, '') };
    const signer = (value: object) => sign(null, Buffer.from(JSON.stringify(value)), pair.privateKey).toString('base64url');
    const accepted = await authority.bootstrap({ ...value, signature: signer(value) });
    return { accepted, signer, identity };
  };
  const register = async (owner: Awaited<ReturnType<typeof own>>, token: string) => {
    const now = Date.now(); const nonce = randomUUID().replace(/-/g, '');
    const request: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accepted.accountIdentityReference, deviceId: owner.accepted.deviceId, deviceIdentityReference: owner.identity, operation: 'device-control', nonce, epoch: 1, createdAt: now, expiresAt: now + 30000 };
    const proof = await authority.issue({ ...request, signature: owner.signer(request) });
    const event: PushEvent = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accepted.accountIdentityReference, deviceId: owner.accepted.deviceId, deviceIdentityReference: owner.identity, trustEpoch: 1, operation: 'register', tokenHash: tokenHash(token), createdAt: now, expiresAt: now + 30000, nonce, signature: '' };
    event.signature = owner.signer(JSON.parse(canonicalPushEvent(event)));
    await registry.update(event, proof, token); return { event, proof };
  };
  test('real signed proof is single-use and token cannot move to another identity', async () => {
    const alice = await own(); const bob = await own(); const token = 'synthetic-private-push-token-1';
    const submitted = await register(alice, token);
    await expect(registry.update(submitted.event, submitted.proof, token)).rejects.toThrow();
    await expect(register(bob, token)).rejects.toThrow();
    expect((await store.rowsForIdentity(alice.identity)).length).toBe(1); expect((await store.rowsForIdentity(bob.identity)).length).toBe(0);
  });
  test('renewal is bounded to one token and authorized removal preserves other devices', async () => {
    const alice = await own(); const bob = await own();
    await Promise.all([register(alice, 'synthetic-private-push-token-2'), register(alice, 'synthetic-private-push-token-3')]);
    await register(bob, 'synthetic-private-push-token-4');
    expect((await store.rowsForIdentity(alice.identity)).length).toBe(1);
    await store.remove(alice.accepted.accountIdentityReference, alice.accepted.deviceId);
    expect((await store.rowsForIdentity(alice.identity)).length).toBe(0); expect((await store.rowsForIdentity(bob.identity)).length).toBe(1);
  });
  test('stale provider cleanup preserves a rotated token and same-token newer epoch/timestamp', async () => {
    const alice = await own();
    await register(alice, 'synthetic-private-push-rotation-old');
    const old = (await store.rowsForIdentity(alice.identity))[0];
    expect(await store.isCurrent(old)).toBe(true);
    await register(alice, 'synthetic-private-push-rotation-new');
    expect(await store.removeObserved(old)).toBe(false);
    const replacement = (await store.rowsForIdentity(alice.identity))[0];
    expect(replacement._id).not.toBe(old._id);
    await database.collection<PushRow>('device_push_tokens_v1').updateOne({ _id: replacement._id }, { $set: { trustEpoch: 2, updatedAt: new Date(replacement.updatedAt.getTime() + 1) } });
    expect(await store.removeObserved(replacement)).toBe(false);
    expect(await store.isCurrent(replacement)).toBe(false);
    const current = (await store.rowsForIdentity(alice.identity))[0];
    expect(await store.removeObserved(current)).toBe(true);
    expect(await store.rowsForIdentity(alice.identity)).toHaveLength(0);
  });
});
