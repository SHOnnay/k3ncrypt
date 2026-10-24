import express from 'express';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, webcrypto } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import db from '../db';
import { applyMigrations } from '../db/migrations';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from './durableDeviceTrust';
import { RoutingOwnershipStore, authorizeCurrentRouting, routingContinuation, routingProofHash } from './routingOwnership';
import type { BootstrapRequest, DeviceProofRequest, EnrollmentEvent } from '../../service/src/devices/trustProtocol';
import type { DeviceOperation } from './deviceTrust';
import type { SignedLifecycleEvent } from './lifecycleEvent';
import { fingerprintVodozemacIdentity } from '../../service/src/identity/vodozemacIdentity';
import routingRouter from '../api/chatHash/routing';
import prekeysRouter from '../api/chatHash/prekeys';
const request = require('supertest');
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const uri = process.env.K3NCRYPT_ROUTING_MONGO_URI;
const suite = uri ? describe : describe.skip;
const DAY = 86400000;
const signed = <T extends object>(value: T, key: ReturnType<typeof generateKeyPairSync>['privateKey']) => ({ ...value, signature: sign(null, Buffer.from(JSON.stringify(value)), key).toString('base64url') });
const gate = () => { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r; }), wait: new Promise<void>(r => { release = r; }), enter: () => enter(), release: () => release() }; };

suite('durable routing with signed disposable devices and actual Mongo TTL', () => {
  let client: MongoClient, database: Db, store: RoutingOwnershipStore, authority: DurableDeviceTrustAuthority;
  const name = 'k3ncrypt_routing_' + randomUUID().replace(/-/g, '');
  const oldSecret = process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET, oldFlag = process.env.K3NCRYPT_DURABLE_ROUTING;
  beforeAll(async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Disposable loopback Mongo only');
    client = await new MongoClient(uri).connect(); database = client.db(name); await applyMigrations(database);
    process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = randomBytes(32).toString('hex'); process.env.K3NCRYPT_DURABLE_ROUTING = 'true';
    authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET);
    store = new RoutingOwnershipStore(database, client);
    jest.spyOn(db, 'getDatabase').mockReturnValue(database); jest.spyOn(db, 'getMongoClient').mockReturnValue(client);
    jest.spyOn(db, 'findOneFromDB').mockImplementation(async (q, c) => await database.collection(c).findOne(q) as any);
  });
  afterAll(async () => {
    jest.restoreAllMocks(); if (database) await database.dropDatabase(); await client?.close();
    if (oldSecret === undefined) delete process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET; else process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = oldSecret;
    if (oldFlag === undefined) delete process.env.K3NCRYPT_DURABLE_ROUTING; else process.env.K3NCRYPT_DURABLE_ROUTING = oldFlag;
  });
  async function actor() {
    const pair = generateKeyPairSync('ed25519'), key = pair.privateKey, publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const identity = { curve25519: randomBytes(32).toString('base64url'), ed25519: publicKey };
    const fingerprint = await fingerprintVodozemacIdentity(identity), id = randomUUID(), now = Date.now();
    const bootstrap: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId: id, deviceIdentityReference: fingerprint, fingerprint, verificationKey: publicKey, nonce: randomBytes(24).toString('base64url'), createdAt: now, expiresAt: now + 30000 };
    const account = await authority.bootstrap(signed(bootstrap, key));
    const proof = async (operation: DeviceOperation, channel?: string) => {
      const at = Date.now(); const value: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account.accountIdentityReference, deviceId: id, deviceIdentityReference: fingerprint,
        operation, nonce: randomBytes(24).toString('base64url'), epoch: 1, createdAt: at, expiresAt: at + 30000, ...(channel ? { resource: { conversationId: channel } } : {}) };
      return authority.issue(signed(value, key));
    };
    const bundle = () => ({ version: 1, protocol: 'vodozemac-olm-v1', identity: { ...identity }, oneTimeKeys: [{ id: 'otk-' + randomBytes(8).toString('hex'), key: randomBytes(32).toString('base64url') }] });
    return { id, identity, fingerprint, account, proof, bundle, key };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function room() {
    const channel = randomUUID(), capability = randomBytes(32).toString('base64url');
    await database.collection('links').insertOne({ hash: channel, controlCapabilityHash: createHash('sha256').update(capability).digest('hex'), expired: false, deleted: false, invitationPublications: 2, invitationExpiresAt: new Date(0) });
    return { channel, capability };
  }
  async function publication(a: Actor, channel: string) {
    const address = randomUUID(), proof = randomBytes(32).toString('base64url');
    await database.collection('prekey_bundles').insertOne({ channel, address, renewalProofHash: routingProofHash(proof), bundle: a.bundle(), createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * DAY) });
    return { address, proof };
  }
  async function admitted(a: Actor, channel: string) {
    const proof = await a.proof('device-control', channel);
    return { device: await authority.verify(proof, 'device-control', { conversationId: channel }), until: proof.expiresAt };
  }
  async function adopt(a: Actor, r: Awaited<ReturnType<typeof room>>, p: Awaited<ReturnType<typeof publication>>) {
    const d = await admitted(a, r.channel); return store.adopt(r.channel, p.address, p.proof, d.device, d.until);
  }
  async function headers(a: Actor, r: Awaited<ReturnType<typeof room>>, p: Awaited<ReturnType<typeof publication>>) {
    const proof = await a.proof('device-control', r.channel);
    return { 'X-K3ncrypt-Control-Capability': r.capability, 'X-K3ncrypt-Participant': p.address, 'X-K3ncrypt-Routing-Proof': p.proof,
      'X-K3ncrypt-Device-Proof': Buffer.from(JSON.stringify(proof)).toString('base64url'), 'X-K3ncrypt-Device-Nonce': proof.nonce };
  }
  const app = () => { const value = express(); value.use(express.json()); value.use('/api/chat-link/:channel/routing', routingRouter); value.use('/api/chat-link/:channel/prekeys', prekeysRouter); return value; };
  async function ttlGone(channel: string) {
    const end = Date.now() + 10000;
    while (Date.now() < end && await database.collection('prekey_bundles').countDocuments({ channel })) await new Promise(r => setTimeout(r, 50));
    expect(await database.collection('prekey_bundles').countDocuments({ channel })).toBe(0);
  }
  test.each([0, 4, 5, 7, 8, 15, 30])('ownership survives %i-day inactivity and real temporary-key cleanup; fresh signed renewal works', async days => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel); await adopt(a, r, p);
    const createdAt = new Date(Date.now() - days * DAY - 10);
    await database.collection('prekey_bundles').updateOne({ channel: r.channel, address: p.address }, { $set: { createdAt, expiresAt: new Date(createdAt.getTime() + 7 * DAY) } });
    if (days >= 7) await ttlGone(r.channel);
    expect((await store.current(r.channel, p.address))?.identityReference).toBe(a.fingerprint);
    expect(await authorizeCurrentRouting(r.channel, p.address, p.proof)).toBe(true);
    expect(await authorizeCurrentRouting(r.channel, p.address, randomBytes(32).toString('base64url'))).toBe(false);
    const restarted = new RoutingOwnershipStore(database, client); expect(await restarted.current(r.channel, p.address)).toBeDefined();
    const d = await admitted(a, r.channel); await restarted.renew(r.channel, p.address, p.proof, d.device, d.until, a.bundle());
    expect((await database.collection('prekey_bundles').findOne({ channel: r.channel, address: p.address }))!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await database.collection('links').findOne({ hash: r.channel }))!.routingOwners).toHaveLength(1);
  });
  test('already-deleted legacy publication cannot be resurrected by the genuine device, room capability or original proof', async () => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel);
    await database.collection('prekey_bundles').updateOne({ address: p.address }, { $set: { expiresAt: new Date(0) } }); await ttlGone(r.channel);
    const d = await admitted(a, r.channel); await expect(store.adopt(r.channel, p.address, p.proof, d.device, d.until)).rejects.toThrow();
    await request(app()).post(`/api/chat-link/${r.channel}/routing/${p.address}/prekeys`).set(await headers(a, r, p)).send(a.bundle()).expect(403);
    expect((await database.collection('links').findOne({ hash: r.channel }))!.routingOwners).toBeUndefined();
  });
  test('wrong device/identity and cross-room use cannot adopt a published route', async () => {
    const a = await actor(), b = await actor(), r = await room(), other = await room(), p = await publication(a, r.channel);
    const wrong = await admitted(b, r.channel); await expect(store.adopt(r.channel, p.address, p.proof, wrong.device, wrong.until)).rejects.toThrow();
    const good = await admitted(a, r.channel); await expect(store.adopt(other.channel, p.address, p.proof, good.device, good.until)).rejects.toThrow();
    expect(await store.current(r.channel, p.address)).toBeUndefined();
  });
  test('signed API renewal and public identity lookup survive TTL without changing legacy bundle responses; proofs are single-use', async () => {
    const a = await actor(), b = await actor(), r = await room(), p = await publication(a, r.channel), q = await publication(b, r.channel);
    await adopt(a, r, p); await adopt(b, r, q);
    await database.collection('prekey_bundles').updateMany({ channel: r.channel }, { $set: { expiresAt: new Date(0) } }); await ttlGone(r.channel);
    await request(app()).get(`/api/chat-link/${r.channel}/prekeys/${q.address}`).set('X-K3ncrypt-Control-Capability', r.capability).expect(404);
    const h = await headers(a, r, p), path = `/api/chat-link/${r.channel}/routing/${q.address}/identity`;
    const response = await request(app()).get(path).set(h).expect(200); expect(response.body).toEqual({ version: 1, identity: b.identity });
    await request(app()).get(path).set(h).expect(403);
    await request(app()).post(`/api/chat-link/${r.channel}/routing/${p.address}/prekeys`).set(await headers(a, r, p)).send(a.bundle()).expect(200);
    const got = await request(app()).get(`/api/chat-link/${r.channel}/prekeys/${p.address}`).set('X-K3ncrypt-Control-Capability', r.capability).expect(200);
    expect(got.body.identity).toEqual(a.identity); expect(got.body.oneTimeKeys).toHaveLength(1);
    await request(app()).get(path).set(await headers(b, r, p)).expect(403);
  });
  test('cross-room request proof is rejected without consuming it for its proper room', async () => {
    const a = await actor(), r = await room(), other = await room(), p = await publication(a, r.channel); await adopt(a, r, p);
    const h = await headers(a, r, p);
    await request(app()).get(`/api/chat-link/${other.channel}/routing/${p.address}/identity`).set({ ...h, 'X-K3ncrypt-Control-Capability': other.capability }).expect(403);
    await request(app()).get(`/api/chat-link/${r.channel}/routing/${p.address}/identity`).set(h).expect(200);
  });
  test('two concurrent authenticated adoptions create one slot; capacity includes tombstones', async () => {
    const a = await actor(), b = await actor(), c = await actor(), r = await room(), p = await publication(a, r.channel);
    const d = await admitted(a, r.channel), e = await admitted(a, r.channel);
    await Promise.all([store.adopt(r.channel, p.address, p.proof, d.device, d.until), store.adopt(r.channel, p.address, p.proof, e.device, e.until)]);
    const q = await publication(b, r.channel); await adopt(b, r, q); const x = await admitted(a, r.channel); await store.revoke(r.channel, p.address, p.proof, x.device, x.until);
    await expect(adopt(a, r, p)).rejects.toThrow();
    const z = await publication(c, r.channel); await expect(adopt(c, r, z)).rejects.toThrow();
    expect((await database.collection('links').findOne({ hash: r.channel }))!.routingOwners).toHaveLength(2);
  });
  test('room deletion wins at a deterministic pre-write boundary', async () => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel), d = await admitted(a, r.channel), block = gate();
    const original = (store as any).fenceDevice.bind(store);
    const spy = jest.spyOn(store as any, 'fenceDevice').mockImplementationOnce(async (...args: unknown[]) => { block.enter(); await block.wait; return original(...args); });
    const pending = store.adopt(r.channel, p.address, p.proof, d.device, d.until); const outcome = pending.catch(error => error);
    await block.entered; await database.collection('links').updateOne({ hash: r.channel }, { $set: { deleted: true } }); block.release();
    expect(await outcome).toBeInstanceOf(Error); spy.mockRestore();
    expect(await store.current(r.channel, p.address)).toBeUndefined(); expect((await database.collection('links').findOne({ hash: r.channel }))!.routingOwners).toBeUndefined();
  });
  test('ownership revocation fences paused renewal and request continuations without a positive cache', async () => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel), owner = await adopt(a, r, p), d = await admitted(a, r.channel), revoke = await admitted(a, r.channel), block = gate();
    const continuation = routingContinuation(r.channel, p.address, owner, Date.now() + 30000); await continuation.assertTrusted();
    const original = (store as any).fenceDevice.bind(store);
    const spy = jest.spyOn(store as any, 'fenceDevice').mockImplementationOnce(async (...args: unknown[]) => { block.enter(); await block.wait; return original(...args); });
    const pending = store.renew(r.channel, p.address, p.proof, d.device, d.until, a.bundle()).catch(error => error);
    await block.entered; await new RoutingOwnershipStore(database, client).revoke(r.channel, p.address, p.proof, revoke.device, revoke.until); block.release();
    expect(await pending).toBeInstanceOf(Error); spy.mockRestore(); await expect(continuation.assertTrusted()).rejects.toThrow();
    expect(await authorizeCurrentRouting(r.channel, p.address, p.proof)).toBe(false);
    process.env.K3NCRYPT_DURABLE_ROUTING = 'false'; expect(await authorizeCurrentRouting(r.channel, p.address, p.proof)).toBe(false); process.env.K3NCRYPT_DURABLE_ROUTING = 'true';
  });
  test.each(['revoked', 'epoch', 'identity', 'key'])('concurrent device %s change fences admission at a deterministic write boundary', async change => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel), d = await admitted(a, r.channel), block = gate();
    const original = (store as any).fenceDevice.bind(store);
    const spy = jest.spyOn(store as any, 'fenceDevice').mockImplementationOnce(async (...args: unknown[]) => { block.enter(); await block.wait; return original(...args); });
    const outcome = store.adopt(r.channel, p.address, p.proof, d.device, d.until).catch(error => error);
    await block.entered;
    const mutation = change === 'revoked' ? { state: 'revoked', trustEpoch: 2 } : change === 'epoch' ? { trustEpoch: 2 } : change === 'identity' ? { deviceIdentityReference: 'changed-synthetic-identity' } : { verificationKeyReference: 'changed-synthetic-key' };
    await database.collection('device_lifecycle').updateOne({ accountIdentityReference: a.account.accountIdentityReference, deviceId: a.id }, { $set: mutation });
    block.release(); expect(await outcome).toBeInstanceOf(Error); spy.mockRestore();
    expect(await store.current(r.channel, p.address)).toBeUndefined();
    expect((await database.collection('links').findOne({ hash: r.channel }))!.routingOwners).toBeUndefined();
  });
  test('expired proof, expired/deleted room and flag-off cannot authorize an upgraded owner', async () => {
    const a = await actor(), r = await room(), p = await publication(a, r.channel), owner = await adopt(a, r, p);
    const d = await admitted(a, r.channel);
    await expect(store.renew(r.channel, p.address, p.proof, d.device, Date.now() - 1, a.bundle())).rejects.toThrow();
    await expect(routingContinuation(r.channel, p.address, owner, Date.now() - 1).assertTrusted()).rejects.toThrow();
    await database.collection('links').updateOne({ hash: r.channel }, { $set: { expired: true } });
    expect(await store.current(r.channel, p.address)).toBeUndefined();
    await request(app()).get(`/api/chat-link/${r.channel}/routing/${p.address}/identity`).set(await headers(a, r, p)).expect(403);
    await expect(store.renew(r.channel, p.address, p.proof, d.device, d.until, a.bundle())).rejects.toThrow();
    await database.collection('links').updateOne({ hash: r.channel }, { $set: { expired: false } });
    process.env.K3NCRYPT_DURABLE_ROUTING = 'false';
    try {
      expect(await authorizeCurrentRouting(r.channel, p.address, p.proof)).toBe(false);
      await request(app()).get(`/api/chat-link/${r.channel}/routing/${p.address}/identity`).set(await headers(a, r, p)).expect(503);
    } finally { process.env.K3NCRYPT_DURABLE_ROUTING = 'true'; }
  });
  test('signed device revocation invalidates existing owner and previously issued proof/epoch', async () => {
    const a = await actor(), siblingPair = generateKeyPairSync('ed25519'), sibling = randomUUID(), publicKey = siblingPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const siblingIdentity = 'synthetic-sibling', at = Date.now();
    const enrollment: Omit<EnrollmentEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: a.account.accountIdentityReference, issuerDeviceId: a.id, issuerIdentityReference: a.fingerprint, issuerEpoch: 1,
      targetDeviceId: sibling, targetIdentityReference: siblingIdentity, targetVerificationKey: publicKey, targetFingerprint: siblingIdentity, nonce: randomBytes(24).toString('base64url'), createdAt: at, expiresAt: at + 30000 };
    await authority.enroll(signed(enrollment, a.key), await a.proof('device-control'));
    const activation: Omit<SignedLifecycleEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: a.account.accountIdentityReference, issuerDeviceId: sibling, issuerIdentityReference: siblingIdentity, targetDeviceId: sibling,
      targetIdentityReference: siblingIdentity, operation: 'activate', previousEpoch: 2, nextEpoch: 3, createdAt: at, expiresAt: at + 30000 };
    await authority.activate(signed(activation, siblingPair.privateKey));
    const r = await room(), p = await publication(a, r.channel); await adopt(a, r, p); const h = await headers(a, r, p);
    const now = Date.now(), revokeProof: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: a.account.accountIdentityReference, deviceId: sibling, deviceIdentityReference: siblingIdentity,
      operation: 'device-control', nonce: randomBytes(24).toString('base64url'), epoch: 3, createdAt: now, expiresAt: now + 30000 };
    const event: Omit<SignedLifecycleEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: a.account.accountIdentityReference, issuerDeviceId: sibling, issuerIdentityReference: siblingIdentity,
      targetDeviceId: a.id, targetIdentityReference: a.fingerprint, operation: 'revoke', previousEpoch: 3, nextEpoch: 4, createdAt: now, expiresAt: now + 30000 };
    await authority.update(signed(event, siblingPair.privateKey), await authority.issue(signed(revokeProof, siblingPair.privateKey)));
    expect(await store.current(r.channel, p.address)).toBeUndefined();
    await request(app()).get(`/api/chat-link/${r.channel}/routing/${p.address}/identity`).set(h).expect(403);
    await expect(adopt(a, r, p)).rejects.toThrow();
  });
});
