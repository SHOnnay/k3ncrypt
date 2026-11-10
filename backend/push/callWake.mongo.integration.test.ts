import { MongoClient } from 'mongodb';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'crypto';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { canonicalPushEvent, MongoPushStore, PrivatePushRegistry, tokenHash, type PushEvent } from './privateWake';
import { applyWakeSchema, ownerKey, PUSH_ROUTES, routeKey } from './durableWakeStore';
import { revokeWakeRoute } from './authenticatedWakeRoutes';
import { applyMigrations } from '../db/migrations';
import { requestCallWake } from './callWake';
import type { BootstrapRequest, DeviceProofRequest } from '../../service/src/devices/trustProtocol';

jest.mock('./privateWake', () => ({ ...jest.requireActual('./privateWake'), sendFcm: jest.fn(async () => undefined) }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sendFcm = require('./privateWake').sendFcm as jest.Mock;

const uri = process.env.K3NCRYPT_TEST_MONGO_URI;
const localSuite = uri ? describe : describe.skip;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const saved = { ...process.env };

localSuite('Mongo-backed call wake [integration test]', () => {
  let client: MongoClient; let database: ReturnType<MongoClient['db']>; let authority: DurableDeviceTrustAuthority; let registry: PrivatePushRegistry;
  beforeAll(async () => {
    const endpoint = new URL(uri!); if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Disposable loopback Mongo required');
    client = new MongoClient(uri!); await client.connect(); database = client.db(`k3ncrypt_test_call_wake_${randomUUID().replace(/-/g, '')}`);
    await applyMigrations(database); await applyWakeSchema(database);
    authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), 'synthetic-isolated-call-wake-secret'.repeat(2));
    registry = new PrivatePushRegistry(new MongoPushStore(database, client), (proof) => authority.verify(proof, 'device-control'), () => true);
    process.env.K3NCRYPT_FCM_ENABLED = 'true'; process.env.K3NCRYPT_FCM_PROJECT_ID = 'synthetic'; process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH = __filename;
    process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'true'; process.env.K3NCRYPT_MAINTENANCE_MODE = 'false';
  });
  afterAll(async () => { process.env = { ...saved }; if (database) await database.dropDatabase(); await client?.close(); });
  beforeEach(() => sendFcm.mockClear());

  const device = async () => {
    const pair = generateKeyPairSync('ed25519'); const deviceId = randomUUID(); const identity = `synthetic-${randomUUID()}`; const now = Date.now();
    const value: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId, deviceIdentityReference: identity, verificationKey: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'), fingerprint: identity, createdAt: now, expiresAt: now + 30000, nonce: randomUUID().replace(/-/g, '') };
    const signer = (v: object) => sign(null, Buffer.from(JSON.stringify(v)), pair.privateKey).toString('base64url');
    return { accepted: await authority.bootstrap({ ...value, signature: signer(value) }), signer, identity };
  };
  const register = async (owner: Awaited<ReturnType<typeof device>>, token: string) => {
    const now = Date.now(); const nonce = randomUUID().replace(/-/g, '');
    const request: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accepted.accountIdentityReference, deviceId: owner.accepted.deviceId, deviceIdentityReference: owner.identity, operation: 'device-control', nonce, epoch: 1, createdAt: now, expiresAt: now + 30000 };
    const proof = await authority.issue({ ...request, signature: owner.signer(request) });
    const event: PushEvent = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accepted.accountIdentityReference, deviceId: owner.accepted.deviceId, deviceIdentityReference: owner.identity, trustEpoch: 1, operation: 'register', tokenHash: tokenHash(token), createdAt: now, expiresAt: now + 30000, nonce, signature: '' };
    event.signature = owner.signer(JSON.parse(canonicalPushEvent(event))); await registry.update(event, proof, token);
  };
  /** A callee with a registered token and a captured route for (room, recipient), plus the live room and publication a real admission needs. */
  const scene = async () => {
    const callee = await device(); const caller = await device(); const room = randomUUID(); const recipient = randomUUID(); const control = `c-${randomUUID()}`; const proof = Buffer.from(randomUUID().replace(/-/g, '').padEnd(32, '0')).toString('base64url').slice(0, 43);
    await register(callee, `synthetic-call-token-${randomUUID()}`);
    await database.collection('links').insertOne({ hash: room, deleted: false, expired: false, controlCapabilityHash: sha(control) });
    await database.collection('prekey_bundles').insertOne({ channel: room, address: recipient, expiresAt: new Date(Date.now() + 3_600_000), renewalProofHash: sha(`k3ncrypt-prekey-renewal-v1\0${proof}`), bundle: {} });
    const now = new Date();
    await database.collection(PUSH_ROUTES).insertOne({ _id: ownerKey(callee.accepted.accountIdentityReference, callee.accepted.deviceId), accountIdentityReference: callee.accepted.accountIdentityReference, deviceId: callee.accepted.deviceId, deviceIdentityReference: callee.identity, trustEpoch: 1, revision: randomUUID(),
      routes: [{ key: routeKey(room, recipient), room, routingAddress: recipient, identityReference: callee.identity, verifiedAt: now, validUntil: new Date(now.getTime() + 86_400_000) }], updatedAt: now, expiresAt: new Date(now.getTime() + 86_400_000) } as never);
    return { callee, caller, room, recipient, control, proof };
  };
  const ring = (s: Awaited<ReturnType<typeof scene>>, kind: 'ring' | 'cancel', wakeId: string) =>
    requestCallWake(database, { room: s.room, recipient: s.recipient, callerAccount: s.caller.accepted.accountIdentityReference, callerDevice: s.caller.accepted.deviceId, wakeId, kind });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  test('a ring reaches the callee once with a content-free payload and no collapse key', async () => {
    const s = await scene(); const id = randomUUID(); ring(s, 'ring', id); await settle();
    expect(sendFcm).toHaveBeenCalledTimes(1);
    const [token, data, ttl, collapse] = sendFcm.mock.calls[0];
    expect(typeof token).toBe('string'); expect(collapse).toBeUndefined(); expect(ttl).toBeLessThanOrEqual(45_000);
    expect(Object.keys(data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']); expect(data).toMatchObject({ type: 'call', eventId: id, version: '1' });
  });

  test('the same caller cannot ring the same person twice within 8 seconds', async () => {
    const s = await scene(); ring(s, 'ring', randomUUID()); ring(s, 'ring', randomUUID()); await settle();
    expect(sendFcm).toHaveBeenCalledTimes(1);
  });

  test('a cancel is honoured once, only for a ring that caller really made, with the same id', async () => {
    const s = await scene(); const id = randomUUID(); ring(s, 'ring', id); await settle(); sendFcm.mockClear();
    const stranger = { ...s, caller: await device() }; ring(stranger, 'cancel', id); await settle(); expect(sendFcm).not.toHaveBeenCalled();
    ring(s, 'cancel', randomUUID()); await settle(); expect(sendFcm).not.toHaveBeenCalled();
    ring(s, 'cancel', id); await settle(); expect(sendFcm).toHaveBeenCalledTimes(1);
    expect(sendFcm.mock.calls[0][1]).toMatchObject({ type: 'call-cancel', eventId: id });
    sendFcm.mockClear(); ring(s, 'cancel', id); await settle(); expect(sendFcm).not.toHaveBeenCalled();
  });

  test('a removed contact cannot ring: revoking the route needs the room capability and the routing proof', async () => {
    const s = await scene();
    expect(await revokeWakeRoute(database, { room: s.room, address: s.recipient, control: 'wrong', routingProof: s.proof })).toBe(false);
    expect(await revokeWakeRoute(database, { room: s.room, address: s.recipient, control: s.control, routingProof: 'x'.repeat(43) })).toBe(false);
    ring(s, 'ring', randomUUID()); await settle(); expect(sendFcm).toHaveBeenCalledTimes(1); sendFcm.mockClear();
    expect(await revokeWakeRoute(database, { room: s.room, address: s.recipient, control: s.control, routingProof: s.proof })).toBe(true);
    const next = { ...s, caller: await device() }; ring(next, 'ring', randomUUID()); await settle(); expect(sendFcm).not.toHaveBeenCalled();
  });

  test('no ring when the room was deleted, the publication lapsed, or the callee device was revoked', async () => {
    const deleted = await scene(); await database.collection('links').updateOne({ hash: deleted.room }, { $set: { deleted: true } }); ring(deleted, 'ring', randomUUID());
    const lapsed = await scene(); await database.collection('prekey_bundles').updateOne({ channel: lapsed.room }, { $set: { expiresAt: new Date(Date.now() - 1000) } }); ring(lapsed, 'ring', randomUUID());
    const stale = await scene(); await database.collection('device_lifecycle').updateOne({ deviceId: stale.callee.accepted.deviceId }, { $set: { state: 'revoked' } }); ring(stale, 'ring', randomUUID());
    await settle(); expect(sendFcm).not.toHaveBeenCalled();
  });

  test('no ring while the switch is off, and a ring writes nothing durable', async () => {
    const s = await scene(); const before = await Promise.all(['private_wake_slots_v1', 'offline_messages', 'device_push_routes_v1', 'device_push_tokens_v1'].map((name) => database.collection(name).countDocuments({})));
    process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'false'; ring(s, 'ring', randomUUID()); await settle(); expect(sendFcm).not.toHaveBeenCalled();
    process.env.K3NCRYPT_CALL_WAKE_ENABLED = 'true'; ring(s, 'ring', randomUUID()); await settle(); expect(sendFcm).toHaveBeenCalledTimes(1);
    const after = await Promise.all(['private_wake_slots_v1', 'offline_messages', 'device_push_routes_v1', 'device_push_tokens_v1'].map((name) => database.collection(name).countDocuments({})));
    expect(after).toEqual(before);
  });
});
