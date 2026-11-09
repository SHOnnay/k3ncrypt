import { MongoClient, Long, type Db } from 'mongodb';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'crypto';
import { execFileSync } from 'child_process';
import { applyMigrations } from '../db/migrations';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { canonicalPushEvent, MongoPushStore, PrivatePushRegistry, tokenHash, wakePayload, type PushEvent, type PushRow } from './privateWake';
import { applyWakeSchema, DurableWakeStore, PUSH_ROUTES, WAKE_SLOTS, routeKey, wakeSchemaReady, type Slot } from './durableWakeStore';
import { captureAdmittedWakeRoute, validWakeRoute } from './authenticatedWakeRoutes';
import { DurableWakeRuntime } from './durableWakeRuntime';
import { WakeDispatcher, type WakeProvider } from './wakeDispatcher';
import type { BootstrapRequest, DeviceProofRequest } from '../../service/src/devices/trustProtocol';

const uri = process.env.K3NCRYPT_TEST_MONGO_URI;
const suite = uri ? describe : describe.skip;
suite('durable optional wakes on disposable Mongo', () => {
  let client: MongoClient; let db: Db; let queue: DurableWakeStore;
  beforeAll(async () => {
    const endpoint = new URL(uri!); if (!['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('LOOPBACK_TEST_DATABASE_REQUIRED');
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 3000 }); await client.connect();
    db = client.db(`k3ncrypt_test_durable_wakes_${randomUUID().replace(/-/g, '')}`);
    await applyMigrations(db); await applyWakeSchema(db); queue = new DurableWakeStore(db);
  }, 30_000);
  afterAll(async () => { if (db) await db.dropDatabase(); await client?.close(); });
  beforeEach(async () => {
    await db.collection(WAKE_SLOTS).updateMany({}, [{ $replaceWith: { _id: '$_id', generation: { $add: ['$generation', Long.ONE] }, state: { $literal: 'idle' } } }]);
    for (const name of [PUSH_ROUTES, 'device_push_tokens_v1', 'offline_messages', 'links', 'prekey_bundles']) await db.collection(name).deleteMany({});
  });
  const fixture = async () => {
    const pair = generateKeyPairSync('ed25519'); const ed = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const curve = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update(`k3ncrypt:vodozemac-identity:v1\0${curve}\0${ed}`).digest('base64url').toUpperCase();
    const identity = `K3 ${digest.match(/.{1,4}/g)!.join(' ')}`; const device = randomUUID();
    const authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(db), 'synthetic-wake-test-authority-secret-32-characters');
    const signed = (value: object) => sign(null, Buffer.from(JSON.stringify(value)), pair.privateKey).toString('base64url');
    const now = Date.now();
    const boot: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId: device, deviceIdentityReference: identity, verificationKey: ed, fingerprint: identity, createdAt: now, expiresAt: now + 30_000, nonce: randomUUID().replace(/-/g, '') };
    const owner = await authority.bootstrap({ ...boot, signature: signed(boot) });
    const registry = new PrivatePushRegistry(new MongoPushStore(db, client), (proof) => authority.verify(proof, 'device-control'), () => true);
    const register = async (token: string, independent = false) => {
      const now = Date.now(); const nonce = randomUUID().replace(/-/g, '');
      const request: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accountIdentityReference, deviceId: device, deviceIdentityReference: identity, operation: 'device-control', nonce, epoch: 1, createdAt: now, expiresAt: now + 30_000 };
      const proof = await authority.issue({ ...request, signature: signed(request) });
      const event: PushEvent = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accountIdentityReference, deviceId: device, deviceIdentityReference: identity, trustEpoch: 1, operation: 'register', tokenHash: tokenHash(token), createdAt: now, expiresAt: now + 30_000, nonce, signature: '' };
      event.signature = signed(JSON.parse(canonicalPushEvent(event))); await (independent ? new PrivatePushRegistry(new MongoPushStore(db, client), (proof) => authority.verify(proof, 'device-control'), () => true) : registry).update(event, proof, token);
      return (await new MongoPushStore(db).rowsForIdentity(identity))[0];
    };
    const row = await register(`synthetic-push-${randomUUID()}`);
    const room = randomUUID(), address = randomUUID(), control = randomBytes(32).toString('base64url'), routingProof = randomBytes(32).toString('base64url');
    await db.collection('links').insertOne({ hash: room, deleted: false, expired: false, controlCapabilityHash: createHash('sha256').update(control).digest('hex') });
    await db.collection('prekey_bundles').insertOne({ channel: room, address, bundle: { identity: { curve25519: curve, ed25519: ed } }, renewalProofHash: createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${routingProof}`).digest('hex'), expiresAt: new Date(Date.now() + 60_000) });
    const admissionRequest: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: owner.accountIdentityReference, deviceId: device, deviceIdentityReference: identity, operation: 'relay:message', resource: { conversationId: room }, nonce: randomUUID().replace(/-/g, ''), epoch: 1, createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const admissionProof = await authority.issue({ ...admissionRequest, signature: signed(admissionRequest) });
    const admitted = await authority.verify(admissionProof, 'relay:message');
    const input = { account: admitted.accountIdentityReference, device: admitted.deviceId, epoch: admitted.trustEpoch, room, address, control, routingProof, current: () => true };
    expect(await captureAdmittedWakeRoute(db, input)).toBe(true);
    const id = randomUUID();
    await db.collection('offline_messages').insertOne({ id, dedupeKey: randomUUID(), channel: room, mailbox: address, sender: randomUUID(), state: 'active', slot: 0, envelope: { opaque: 'synthetic-encrypted-fixture' }, timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000) });
    return { row, room, address, id, input, owner, register };
  };
  const runtime = (provider: WakeProvider = jest.fn(async () => {}), allowed = () => true) => {
    const dispatcher = new WakeDispatcher(new MongoPushStore(db), provider, allowed, wakePayload);
    return { worker: new DurableWakeRuntime(db, dispatcher, allowed), dispatcher, provider };
  };

  test('schema has exactly 1024 slots, rejects overflow/oversize, and is idempotent', async () => {
    expect(await wakeSchemaReady(db)).toBe(true); await applyWakeSchema(db);
    expect(await db.collection(WAKE_SLOTS).countDocuments()).toBe(1024);
    await expect(db.collection(WAKE_SLOTS).insertOne({ _id: 1024 as never, generation: Long.ZERO, state: 'idle' })).rejects.toThrow();
    await expect(db.collection(WAKE_SLOTS).updateOne({ _id: 0 as never }, { $set: { unexpectedPayload: 'x'.repeat(5000) } })).rejects.toThrow();
  });
  test('concurrent producers coalesce and full capacity never grows storage', async () => {
    const f = await fixture(); const key = routeKey(f.room, f.address);
    await Promise.all(Array.from({ length: 12 }, () => queue.enqueue(f.row, key)));
    expect(await db.collection(WAKE_SLOTS).countDocuments({ state: 'pending' })).toBe(1);
    for (let i = 1; i < 1024; i++) expect(await queue.enqueue({ ...f.row, _id: tokenHash(String(i)) }, key)).toBe(true);
    expect(await queue.enqueue({ ...f.row, _id: tokenHash('overflow') }, key)).toBe(false);
    expect(await db.collection(WAKE_SLOTS).countDocuments()).toBe(1024);
  }, 30_000);
  test('multiple workers atomically claim one lease and stale workers cannot finish or send', async () => {
    const f = await fixture(); await queue.enqueue(f.row, routeKey(f.room, f.address));
    const claims = await Promise.all([queue.claim(), new DurableWakeStore(db).claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1); const old = claims.find(Boolean)!;
    expect(await queue.beginAttempt(old)).toBe(true);
    await db.collection<Slot>(WAKE_SLOTS).updateOne({ _id: old._id }, { $set: { 'lease.until': new Date(0) } });
    const replacement = (await new DurableWakeStore(db).claim())!;
    expect(replacement.event!.id).toBe(old.event!.id); expect(replacement.attempts).toBe(1);
    expect(await queue.beginAttempt(old)).toBe(false); expect(await queue.finish(old, false)).toBe(false);
    expect(await queue.beginAttempt(replacement)).toBe(true); expect(await queue.finish(replacement, false)).toBe(true);
  });
  test('child process termination preserves pending work and exact event across reconstruction', async () => {
    const f = await fixture(); await queue.enqueue(f.row, routeKey(f.room, f.address));
    execFileSync(process.execPath, ['-r', 'ts-node/register', '-e', `
      const {MongoClient}=require('mongodb'); const {DurableWakeStore}=require('./backend/push/durableWakeStore');
      (async()=>{const c=await new MongoClient(process.env.K3NCRYPT_TEST_MONGO_URI).connect(); const q=new DurableWakeStore(c.db(process.env.F1B_CHILD_DB)); const j=await q.claim(); if(!j || !await q.beginAttempt(j)) process.exit(2); process.exit(0);})().catch(()=>process.exit(3));
    `], { cwd: process.cwd(), env: { ...process.env, F1B_CHILD_DB: db.databaseName }, stdio: 'pipe', timeout: 20_000 });
    const old = (await db.collection<Slot>(WAKE_SLOTS).findOne({ state: 'leased' }))!;
    expect(await queue.claim()).toBeNull();
    await db.collection<Slot>(WAKE_SLOTS).updateOne({ _id: old._id }, { $set: { 'lease.until': new Date(0) } });
    const restarted = (await new DurableWakeStore(db).claim())!;
    expect(restarted.event!.id).toBe(old.event!.id); expect(restarted.attempts).toBe(1);
    expect(await queue.finish(restarted, false)).toBe(true);
  }, 30_000);
  test('transient attempt budget and event identity survive independent worker restarts', async () => {
    const f = await fixture(); const first = runtime(jest.fn(async () => { throw Object.assign(new Error('synthetic'), { code: 'messaging/server-unavailable' }); }));
    await first.worker.enqueuePersisted(f.room, f.address, f.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await db.collection(WAKE_SLOTS).updateMany({ state: 'pending' }, { $set: { nextAttemptAt: new Date(0) } });
      const next = runtime(jest.fn(async (_token: string, data: unknown) => { ids.push((data as { eventId: string }).eventId); throw Object.assign(new Error('synthetic'), { code: 'messaging/server-unavailable' }); }));
      await next.worker.runOnce();
    }
    expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(1);
    expect(await db.collection(WAKE_SLOTS).countDocuments({ state: { $ne: 'idle' } })).toBe(0);
  });
  test('missing persisted mail cannot enqueue; expired mail/queue waves do not send', async () => {
    const f = await fixture(); const h = runtime();
    await h.worker.enqueuePersisted(f.room, f.address, randomUUID());
    expect(await db.collection(WAKE_SLOTS).countDocuments({ state: 'pending' })).toBe(0);
    await h.worker.enqueuePersisted(f.room, f.address, f.id);
    await db.collection(WAKE_SLOTS).updateMany({ state: 'pending' }, { $set: { 'event.createdAt': new Date(0), 'event.expiresAt': new Date(1) } });
    await h.worker.runOnce(); expect(h.provider).not.toHaveBeenCalled();
  });
  test('accepted send has strict generic payload; prekey deletion does not invalidate authenticated pointer', async () => {
    const f = await fixture(); const h = runtime(); await db.collection('prekey_bundles').deleteMany({});
    expect(await validWakeRoute(db, f.row, [routeKey(f.room, f.address)])).toBe(true);
    await h.worker.enqueuePersisted(f.room, f.address, f.id); await h.worker.runOnce();
    expect(h.provider).toHaveBeenCalledTimes(1);
    const data = (h.provider as jest.Mock).mock.calls[0][1];
    expect(Object.keys(data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
    expect(JSON.stringify(data)).not.toContain(f.room); expect(JSON.stringify(data)).not.toContain(f.row.deviceIdentityReference);
    expect(await captureAdmittedWakeRoute(db, f.input)).toBe(false);
  });
  test('revoked, replaced identity, expired route and deleted room cannot authorize a queued wake', async () => {
    for (const change of ['revoked', 'identity', 'expired', 'room']) {
      const f = await fixture(); const h = runtime(); await h.worker.enqueuePersisted(f.room, f.address, f.id);
      if (change === 'revoked') await db.collection('device_lifecycle').updateOne({ deviceId: f.row.deviceId }, { $set: { state: 'revoked', trustEpoch: 2 } });
      if (change === 'identity') await db.collection('device_lifecycle').updateOne({ deviceId: f.row.deviceId }, { $set: { deviceIdentityReference: 'changed' } });
      if (change === 'expired') await db.collection(PUSH_ROUTES).updateOne({ deviceId: f.row.deviceId }, { $set: { 'routes.0.verifiedAt': new Date(0), 'routes.0.validUntil': new Date(1) } });
      if (change === 'room') await db.collection('links').updateOne({ hash: f.room }, { $set: { deleted: true } });
      await h.worker.runOnce(); expect(h.provider).not.toHaveBeenCalled();
    }
  });
  test('wrong renewal proof, unbound identity and lost ownership cannot establish a pointer', async () => {
    const f = await fixture(); await db.collection(PUSH_ROUTES).deleteMany({});
    expect(await captureAdmittedWakeRoute(db, { ...f.input, routingProof: 'wrong' })).toBe(false);
    expect(await captureAdmittedWakeRoute(db, { ...f.input, current: () => false })).toBe(false);
    await db.collection('device_lifecycle').updateOne({ deviceId: f.row.deviceId }, { $set: { verificationKeyReference: randomBytes(32).toString('base64url') } });
    expect(await captureAdmittedWakeRoute(db, f.input)).toBe(false);
  });
  test('invalid-token response cannot delete concurrent signed token rotation', async () => {
    const f = await fixture(); let replacement: PushRow | undefined;
    const h = runtime(jest.fn(async () => { replacement = await f.register(`synthetic-rotated-${randomUUID()}`); throw Object.assign(new Error('synthetic'), { code: 'messaging/registration-token-not-registered' }); }));
    await h.worker.enqueuePersisted(f.room, f.address, f.id); await h.worker.runOnce();
    expect(await new MongoPushStore(db).isCurrent(replacement!)).toBe(true);
    expect(h.dispatcher.snapshot().retired).toBe(0);
  });
  test('new activity during lease survives old completion as exactly one bounded successor', async () => {
    const f = await fixture(); const key = routeKey(f.room, f.address); await queue.enqueue(f.row, key);
    const job = (await queue.claim())!; await queue.beginAttempt(job);
    await Promise.all(Array.from({ length: 8 }, () => queue.enqueue(f.row, key)));
    await queue.finish(job, false);
    const next = (await queue.claim())!; expect(next.event!.id).not.toBe(job.event!.id); expect(next.attempts).toBe(0);
    expect(await db.collection(WAKE_SLOTS).countDocuments({ registrationId: f.row._id })).toBe(1);
  });
  test('finite reconciliation repairs a persisted-without-enqueue gap and ignores old/rejected mail', async () => {
    const f = await fixture(); const h = runtime(); await h.worker.reconcileRecent(); await h.worker.runOnce();
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.worker.snapshot().gapScanned).toBe(1);
    await db.collection('offline_messages').updateOne({ id: f.id }, { $set: { state: 'rejected' } });
    await h.worker.reconcileRecent(); expect(h.worker.snapshot().gapScanned).toBe(1);
  });
  test('old databases disable optional work without changing encrypted records', async () => {
    const old = client.db(`k3ncrypt_test_wake_old_${randomUUID().replace(/-/g, '')}`);
    try {
      await old.collection('offline_messages').insertOne({ id: randomUUID(), opaque: 'synthetic encrypted row' });
      const dispatcher = new WakeDispatcher(new MongoPushStore(old), jest.fn(), () => true, wakePayload);
      const worker = new DurableWakeRuntime(old, dispatcher, () => true);
      await worker.runOnce(); expect(worker.snapshot().unavailable).toBe(1);
      expect(await old.collection('offline_messages').countDocuments()).toBe(1);
    } finally { await old.dropDatabase(); }
  });

  test('two complete runtimes dispatch a single wave without simultaneous provider ownership', async () => {
    const f = await fixture(); const provider = jest.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const a = runtime(provider), b = runtime(provider); await a.worker.enqueuePersisted(f.room, f.address, f.id);
    await Promise.all([a.worker.runOnce(), b.worker.runOnce()]); expect(provider).toHaveBeenCalledTimes(1);
  });
  test('persistent timeout is bounded and does not spawn another SDK send for a newer wave', async () => {
    const f = await fixture(); const h = runtime(jest.fn(() => new Promise<void>(() => {})));
    await h.worker.enqueuePersisted(f.room, f.address, f.id); const began = Date.now(); await h.worker.runOnce();
    expect(Date.now() - began).toBeLessThan(7500); expect(h.dispatcher.snapshot().timedOut).toBe(1);
    await h.worker.enqueuePersisted(f.room, f.address, f.id); await h.worker.runOnce(); expect(h.provider).toHaveBeenCalledTimes(1);
    expect(await db.collection(WAKE_SLOTS).countDocuments()).toBe(1024);
  }, 15_000);
  test('same-token same-timestamp replacement is protected by registration revision', async () => {
    const f = await fixture(); const previous = f.row;
    const replacement = await f.register(previous.token);
    expect(replacement.registrationVersion).not.toBe(previous.registrationVersion);
    await db.collection<PushRow>('device_push_tokens_v1').updateOne({ _id: previous._id }, { $set: { updatedAt: previous.updatedAt } });
    expect(await new MongoPushStore(db).removeObserved(previous)).toBe(false);
    expect(await db.collection('device_push_tokens_v1').countDocuments({ registrationVersion: replacement.registrationVersion })).toBe(1);
  });
  test('queue failure and full capacity cannot reject real mailbox persistence', async () => {
    const f = await fixture(); const h = runtime();
    let pending: Promise<void> | undefined; let mail!: typeof import('../db');
    const beforeUri = process.env.MONGO_URI, beforeName = process.env.MONGO_DB_NAME;
    process.env.MONGO_URI = uri; process.env.MONGO_DB_NAME = db.databaseName;
    jest.doMock('./privateWake', () => ({ ...jest.requireActual('./privateWake'), notifyEncryptedMailboxStored: (_db: Db, room: unknown, address: unknown, id: unknown) => { pending = h.worker.enqueuePersisted(room, address, id); } }));
    jest.isolateModules(() => { mail = require('../db'); });
    try {
      await mail.default.connectDb();
      const enqueue = jest.spyOn(h.worker.queue, 'enqueue').mockRejectedValueOnce(new Error('synthetic optional queue outage'));
      const one = { id: randomUUID(), dedupeKey: randomUUID(), channel: f.room, mailbox: f.address, state: 'active', envelope: { opaque: 'synthetic encrypted' }, timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000) };
      await expect(mail.storeOfflineMessage(one)).resolves.toMatchObject({ id: one.id }); await pending;
      expect(h.worker.snapshot().failed).toBe(1); enqueue.mockRestore();
      // Fill through the actual bounded queue API, not an unbounded fallback queue.
      for (let i = 0; i < 1024; i++) await queue.enqueue({ ...f.row, _id: tokenHash('capacity-' + i) }, routeKey(f.room, f.address));
      const two = { ...one, id: randomUUID(), dedupeKey: randomUUID() };
      await expect(mail.storeOfflineMessage(two)).resolves.toMatchObject({ id: two.id }); await pending;
      expect(h.worker.snapshot().overflow).toBeGreaterThan(0);
      expect(await db.collection('offline_messages').countDocuments({ id: { $in: [one.id, two.id] } })).toBe(2);
    } finally {
      await mail?.default.disconnectDb(); jest.dontMock('./privateWake');
      if (beforeUri === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = beforeUri;
      if (beforeName === undefined) delete process.env.MONGO_DB_NAME; else process.env.MONGO_DB_NAME = beforeName;
    }
  }, 30_000);

  test('maintenance/lease loss leaves claimed work recoverable instead of discarding it', async () => {
    const f = await fixture(); let permitted = true; const h = runtime(jest.fn(async () => {}), () => permitted);
    await h.worker.enqueuePersisted(f.room, f.address, f.id);
    const begin = jest.spyOn(h.worker.queue, 'beginAttempt').mockImplementation(async () => { permitted = false; return false; });
    await h.worker.runOnce(); expect(h.provider).not.toHaveBeenCalled();
    const leased = (await db.collection<Slot>(WAKE_SLOTS).findOne({ state: 'leased' }))!;
    expect(leased).not.toBeNull(); expect(leased.attempts).toBe(0);
    permitted = true; begin.mockRestore();
    await db.collection<Slot>(WAKE_SLOTS).updateOne({ _id: leased._id }, { $set: { 'lease.until': new Date(0) } });
    await h.worker.runOnce(); expect(h.provider).toHaveBeenCalledTimes(1);
  });
  test('route-key overflow and invalid wave lifetime fail boundedly', async () => {
    const f = await fixture();
    for (let i = 0; i < 8; i++) expect(await queue.enqueue(f.row, tokenHash(String(i)))).toBe(true);
    expect(await queue.enqueue(f.row, tokenHash('ninth'))).toBe(false);
    const pending = (await db.collection<Slot>(WAKE_SLOTS).findOne({ state: 'pending' }))!;
    await expect(db.collection<Slot>(WAKE_SLOTS).updateOne({ _id: pending._id }, { $set: { 'event.expiresAt': new Date(pending.event!.createdAt.getTime() + 60_001) } })).rejects.toThrow();
    expect((await db.collection<Slot>(WAKE_SLOTS).findOne({ _id: pending._id }))!.event!.routeKeys).toHaveLength(8);
  });

  test('token ownership conflict rolls back replacement and concurrent registries keep one token per device', async () => {
    const alice = await fixture(), bob = await fixture();
    await expect(bob.register(alice.row.token)).rejects.toThrow();
    expect(await new MongoPushStore(db).isCurrent(alice.row)).toBe(true);
    expect(await new MongoPushStore(db).isCurrent(bob.row)).toBe(true);
    const results = await Promise.allSettled([alice.register('synthetic-concurrent-token-a', true), alice.register('synthetic-concurrent-token-b', true)]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await db.collection('device_push_tokens_v1').countDocuments({ deviceId: alice.row.deviceId })).toBe(1);
  });
  test('migration preserves old registration fields and refuses duplicates without deleting them', async () => {
    const f = await fixture();
    const old = client.db(`k3ncrypt_test_wake_migration_${randomUUID().replace(/-/g, '')}`);
    try {
      await applyMigrations(old);
      const { registrationVersion: _version, ...legacy } = f.row;
      await old.collection<PushRow>('device_push_tokens_v1').insertOne(legacy);
      await applyWakeSchema(old);
      const upgraded = (await old.collection<PushRow>('device_push_tokens_v1').findOne({ _id: legacy._id }))!;
      expect(upgraded).toMatchObject(legacy); expect(upgraded.registrationVersion).toMatch(/^[a-f0-9-]{36}$/);
      expect(await new MongoPushStore(old).removeObserved(legacy)).toBe(false);
    } finally { await old.dropDatabase(); }
    const duplicate = client.db(`k3ncrypt_test_wake_duplicates_${randomUUID().replace(/-/g, '')}`);
    try {
      await duplicate.collection<PushRow>('device_push_tokens_v1').insertMany([f.row, { ...f.row, _id: tokenHash('duplicate'), token: 'synthetic duplicate' }]);
      await expect(applyWakeSchema(duplicate)).rejects.toThrow('PUSH_REGISTRATION_CONFLICT');
      expect(await duplicate.collection('device_push_tokens_v1').countDocuments()).toBe(2);
      expect(await duplicate.listCollections({ name: WAKE_SLOTS }).hasNext()).toBe(false);
    } finally { await duplicate.dropDatabase(); }
  });
  test('route document validation prevents excess routes, duplicates and oversized retention', async () => {
    const f = await fixture();
    const doc = (await db.collection(PUSH_ROUTES).findOne({ deviceId: f.row.deviceId }))!;
    await expect(db.collection(PUSH_ROUTES).updateOne({ deviceId: f.row.deviceId }, { $set: { routes: Array(33).fill(doc.routes[0]) } })).rejects.toThrow();
    await expect(db.collection(PUSH_ROUTES).updateOne({ deviceId: f.row.deviceId }, { $set: { routes: [doc.routes[0], doc.routes[0]] } })).rejects.toThrow();
    await expect(db.collection(PUSH_ROUTES).updateOne({ deviceId: f.row.deviceId }, { $set: { 'routes.0.validUntil': new Date(doc.routes[0].verifiedAt.getTime() + 31 * 24 * 60 * 60_000) } })).rejects.toThrow();
  });
  test('repeated start creates one loop and stop cancels its timer without provider access', async () => {
    const h = runtime(jest.fn(async () => {}), () => false);
    const run = jest.spyOn(h.worker, 'runOnce');
    h.worker.start(); h.worker.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1); h.worker.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1); expect(h.provider).not.toHaveBeenCalled();
  });
});
