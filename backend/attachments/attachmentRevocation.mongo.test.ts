import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, webcrypto } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import express, { type Request } from 'express';
import db from '../db';
import { applyMigrations } from '../db/migrations';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import type { DeviceOperation } from '../security/deviceTrust';
import type { SignedLifecycleEvent } from '../security/lifecycleEvent';
import { fingerprintVodozemacIdentity } from '../../service/src/identity/vodozemacIdentity';
import { authenticateAttachment } from '../api/attachments/production';
import { createFileRouter } from '../api/attachments/files';
import { FileLedgerService, MongoFileLedgerPersistence, type FileLedger } from './fileLedger';
import { MongoAttachmentPersistence } from './mongoAttachmentPersistence';
import { AttachmentService, PersistentAttachmentDeliveryStore } from '../../service/src/attachments';
import { AuthenticatedAttachmentService } from '../security/authenticatedAttachmentService';
import { ConversationAuthorizationService, type AttachmentAccessRecord } from '../security/authorizationContext';
import { createAttachmentRouter } from '../api/attachments';
import type { BootstrapRequest, DeviceProofRequest, EnrollmentEvent } from '../../service/src/devices/trustProtocol';
const request = require('supertest');
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const uri = process.env.K3NCRYPT_ATTACHMENT_TRUST_MONGO_URI;
const suite = uri ? describe : describe.skip;
const signed = <T extends object>(value: T, key: ReturnType<typeof generateKeyPairSync>['privateKey']) => ({ ...value, signature: sign(null, Buffer.from(JSON.stringify(value)), key).toString('base64url') });
const keys = () => { const key = generateKeyPairSync('ed25519'); return { key: key.privateKey, public: key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url') }; };
const gate = () => { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r; }), wait: new Promise<void>(r => { release = r; }), enter: () => enter(), release: () => release() }; };
suite('request-scoped attachment revocation using real signed devices and Mongo', () => {
  let client: MongoClient, database: Db, authority: DurableDeviceTrustAuthority, store: MongoDeviceTrustStore;
  const databaseName = 'k3ncrypt_phase38_' + randomUUID().replace(/-/g, '');
  const originalSecret = process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET;
  let sealKey: CryptoKey;
  beforeAll(async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Disposable loopback Mongo only');
    client = await new MongoClient(uri, { monitorCommands: true }).connect(); database = client.db(databaseName); await applyMigrations(database);
    process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = randomBytes(32).toString('hex');
    store = new MongoDeviceTrustStore(database); authority = new DurableDeviceTrustAuthority(store, process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET);
    jest.spyOn(db, 'getDatabase').mockReturnValue(database);
    jest.spyOn(db, 'findOneFromDB').mockImplementation(async (query, collection) => await database.collection(collection).findOne(query) as any);
    sealKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
  afterAll(async () => { jest.restoreAllMocks(); if (client) { await database.dropDatabase(); await client.close(); } if (originalSecret === undefined) delete process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET; else process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = originalSecret; });
  async function device() {
    const issuer = keys(), target = keys(), issuerId = randomUUID(), targetId = randomUUID(), createdAt = Date.now();
    const publicIdentity = { ed25519: target.public, curve25519: randomBytes(32).toString('base64url') };
    const identity = await fingerprintVodozemacIdentity(publicIdentity);
    const initial: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId: issuerId, deviceIdentityReference: 'synthetic-issuer', fingerprint: 'synthetic-issuer', verificationKey: issuer.public, nonce: randomBytes(24).toString('base64url'), createdAt, expiresAt: createdAt + 30000 };
    const account = await authority.bootstrap(signed(initial, issuer.key));
    const enrollment: Omit<EnrollmentEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account.accountIdentityReference, issuerDeviceId: issuerId, issuerIdentityReference: account.deviceIdentityReference, issuerEpoch: 1, targetDeviceId: targetId, targetIdentityReference: identity, targetVerificationKey: target.public, targetFingerprint: identity, nonce: randomBytes(24).toString('base64url'), createdAt, expiresAt: createdAt + 30000 };
    const proof = async (operation: DeviceOperation, isIssuer = false, room?: string) => {
      const at = Date.now();
      const value: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account.accountIdentityReference, deviceId: isIssuer ? issuerId : targetId, deviceIdentityReference: isIssuer ? account.deviceIdentityReference : identity, operation, nonce: randomBytes(24).toString('base64url'), epoch: isIssuer ? 1 : 3, createdAt: at, expiresAt: at + 30000, ...(room ? { resource: { conversationId: room } } : {}) };
      return authority.issue(signed(value, isIssuer ? issuer.key : target.key));
    };
    await authority.enroll(signed(enrollment, issuer.key), await proof('device-control', true));
    const activation: Omit<SignedLifecycleEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account.accountIdentityReference, issuerDeviceId: targetId, issuerIdentityReference: identity, targetDeviceId: targetId, targetIdentityReference: identity, operation: 'activate', previousEpoch: 2, nextEpoch: 3, createdAt, expiresAt: createdAt + 30000 };
    await authority.activate(signed(activation, target.key));
    return { identity, publicIdentity, proof, account: account.accountIdentityReference, id: targetId, revoke: async () => {
      const at = Date.now(); const event: Omit<SignedLifecycleEvent, 'signature'> = { version: 1, eventId: randomUUID(), accountIdentityReference: account.accountIdentityReference, issuerDeviceId: issuerId, issuerIdentityReference: account.deviceIdentityReference, targetDeviceId: targetId, targetIdentityReference: identity, operation: 'revoke', previousEpoch: 1, nextEpoch: 2, createdAt: at, expiresAt: at + 30000 };
      await authority.update(signed(event, issuer.key), await proof('device-control', true));
    } };
  }
  async function fixture() {
    const sender = await device(), recipient = await device(), room = randomUUID(), capability = randomBytes(32).toString('base64url');
    await database.collection('links').insertOne({ hash: room, controlCapabilityHash: createHash('sha256').update(capability).digest('hex'), expired: false, deleted: false });
    const routes = new Map<string, string>();
    for (const actor of [sender, recipient]) { const route = randomBytes(32).toString('base64url'); routes.set(actor.id, route); await database.collection('prekey_bundles').insertOne({ channel: room, address: actor.id, renewalProofHash: createHash('sha256').update('k3ncrypt-prekey-renewal-v1\0' + route).digest('hex'), expiresAt: new Date(Date.now() + 3600000), bundle: { identity: actor.publicIdentity } }); }
    const headers = async (actor: typeof sender, operation: DeviceOperation) => {
      const proof = await actor.proof(operation, false, room);
      return { 'X-K3ncrypt-Conversation': room, 'X-K3ncrypt-Participant': actor.id, 'X-K3ncrypt-Control-Capability': capability, 'X-K3ncrypt-Routing-Proof': routes.get(actor.id)!, 'X-K3ncrypt-Request-Id': randomUUID(), 'X-K3ncrypt-Device-Proof': Buffer.from(JSON.stringify(proof)).toString('base64url'), 'X-K3ncrypt-Device-Nonce': proof.nonce, 'X-K3ncrypt-File-Version': '2' };
    };
    const admitted = async (actor: typeof sender, op: DeviceOperation) => { const h = await headers(actor, op); const result = await authenticateAttachment({ get: (key: string) => h[key as keyof typeof h] } as Request, op); if (!result) throw new Error('Fixture admission failed'); return result; };
    const persistence = new MongoFileLedgerPersistence(database);
    const service = new FileLedgerService(persistence, async (r, p) => r !== room ? undefined : p === sender.id ? sender.identity : p === recipient.id ? recipient.identity : undefined);
    const binding = { conversationId: room, senderParticipantId: sender.id, recipientParticipantId: recipient.id, senderIdentityReference: sender.identity, recipientIdentityReference: recipient.identity };
    const input = { version: 2 as const, binding, fileSize: 1 };
    const sealed = async (size: number) => { const nonce = randomBytes(12); return { nonce: nonce.toString('base64url'), ciphertext: Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sealKey, new Uint8Array(size))).toString('base64url') }; };
    const app = express(); app.use(express.json()); app.use('/files', createFileRouter(authenticateAttachment, () => service));
    return { sender, recipient, headers, admitted, persistence, service, input, sealed, app };
  }
  test.each(['create', 'status', 'manifest', 'chunk-upload', 'chunk-download', 'complete', 'cancel'])('%s rejects a request revoked after admission at a deterministic storage gate', async operation => {
    const f = await fixture(); let id = '';
    if (operation !== 'create') {
      id = (await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input)).context.transferId;
      if (operation === 'complete' || operation === 'chunk-download') {
        await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 'manifest', await f.sealed(64));
        await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 0, await f.sealed(1));
      }
      if (operation === 'chunk-download') await f.service.complete(await f.admitted(f.sender, 'attachment:write'), id);
    }
    const actor = operation === 'chunk-download' ? f.recipient : f.sender;
    const op: DeviceOperation = operation === 'create' ? 'attachment:create' : ['status', 'chunk-download'].includes(operation) ? 'attachment:read' : operation === 'cancel' ? 'attachment:delete' : 'attachment:write';
    const h = await f.headers(actor, op), block = gate();
    const method = operation === 'create' ? 'read' : operation === 'chunk-download' ? 'object' : 'locate';
    const original = f.persistence[method].bind(f.persistence) as (...args: any[]) => Promise<any>;
    const spy = jest.spyOn(f.persistence, method).mockImplementationOnce(async (...args: any[]) => { const value = await original(...args); block.enter(); await block.wait; return value; });
    let call: any;
    if (operation === 'create') call = request(f.app).post('/files/create').set(h).send(f.input);
    else if (operation === 'status') call = request(f.app).get('/files/' + id).set(h);
    else if (operation === 'manifest') call = request(f.app).put('/files/' + id + '/manifest').set(h).send(await f.sealed(64));
    else if (operation === 'chunk-upload') { const chunk = await f.sealed(1); call = request(f.app).put('/files/' + id + '/chunks/0').set(h).set('Content-Type', 'application/octet-stream').set('X-K3ncrypt-File-Nonce', chunk.nonce).send(Buffer.from(chunk.ciphertext, 'base64url')); }
    else if (operation === 'chunk-download') call = request(f.app).get('/files/' + id + '/chunks/0').set(h);
    else if (operation === 'complete') call = request(f.app).post('/files/' + id + '/complete').set(h).send({});
    else call = request(f.app).delete('/files/' + id).set(h);
    const writes = jest.spyOn(f.persistence, 'replace');
    const response = Promise.resolve(call);
    try { await block.entered; await actor.revoke(); } finally { block.release(); }
    const result = await response; spy.mockRestore();
    expect(result.status).toBe(403); expect(result.body).toEqual({ failure: 'authorization' });
    expect(writes).not.toHaveBeenCalled(); writes.mockRestore();
  }, 20000);

  test('uninterrupted signed requests succeed; foreign bindings, canceled and expired chunks fail safely', async () => {
    const f = await fixture();
    const file = await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input);
    const id = file.context.transferId;
    await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 'manifest', await f.sealed(64));
    const chunk = await f.sealed(1);
    await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 0, chunk);
    await f.service.complete(await f.admitted(f.sender, 'attachment:write'), id);
    const result = await request(f.app).get('/files/' + id + '/chunks/0').set(await f.headers(f.recipient, 'attachment:read'));
    expect(result.status).toBe(200); expect(result.body).toEqual(chunk);
    expect((await request(f.app).get('/files/' + id + '/chunks/0').set(await f.headers(f.sender, 'attachment:read'))).status).toBe(403);
    const foreign = await f.headers(f.recipient, 'attachment:read'); foreign['X-K3ncrypt-Participant'] = randomUUID();
    expect((await request(f.app).get('/files/' + id).set(foreign)).status).toBe(403);
    await f.service.cancel(await f.admitted(f.sender, 'attachment:delete'), id);
    expect((await request(f.app).get('/files/' + id + '/chunks/0').set(await f.headers(f.recipient, 'attachment:read'))).status).toBe(409);
    const next = await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input);
    await database.collection<FileLedger>('file_ledgers_v2').updateOne({ _id: f.sender.account }, { $set: { 'transfers.1.expiresAt': Date.now() - 1 } });
    const expired = await request(f.app).get('/files/' + next.context.transferId).set(await f.headers(f.recipient, 'attachment:read'));
    expect(expired.status).toBe(200); expect(expired.body.state).toBe('expired'); expect(expired.body.indices).toEqual([]);
    expect((await request(f.app).get('/files/' + next.context.transferId + '/chunks/0').set(await f.headers(f.recipient, 'attachment:read'))).status).toBe(410);
  }, 20000);

  test('revocation after a mutation commits denies the response without unsafe rollback', async () => {
    const f = await fixture(), block = gate();
    const original = f.persistence.replace.bind(f.persistence);
    jest.spyOn(f.persistence, 'replace').mockImplementationOnce(async (...args) => { const value = await original(...args); block.enter(); await block.wait; return value; });
    const response = Promise.resolve(request(f.app).post('/files/create').set(await f.headers(f.sender, 'attachment:create')).send(f.input));
    try { await block.entered; await f.sender.revoke(); } finally { block.release(); }
    expect((await response).status).toBe(403);
    // One bounded encrypted allocation may already exist; don't undo another worker's state.
    expect((await f.persistence.read(f.sender.account))?.transfers).toHaveLength(1);
  }, 20000);

  test('continuation cannot survive a lifecycle identity/epoch replacement', async () => {
    const f = await fixture(), admitted = await f.admitted(f.sender, 'attachment:read');
    await admitted.deviceTrust.assertTrusted();
    const observed = await store.read(f.sender.account, f.sender.id);
    await store.upsert({ ...observed!, trustEpoch: observed!.trustEpoch + 1 }, observed!.trustEpoch);
    await expect(admitted.deviceTrust.assertTrusted()).rejects.toThrow('authorization');
  }, 20000);

  async function legacyFixture() {
    const f = await fixture(), persistence = new MongoAttachmentPersistence(database);
    const records = database.collection<AttachmentAccessRecord & { attachmentId: string }>('attachment_access');
    const access = { register: async (attachmentId: string, record: AttachmentAccessRecord) => { await records.insertOne({ attachmentId, ...record }); }, lookup: async (attachmentId: string) => await records.findOne({ attachmentId }) ?? undefined };
    const memberships = { isMember: async (room: string, participant: string) => room === f.input.binding.conversationId && (participant === f.sender.id || participant === f.recipient.id), identityReference: async (_room: string, participant: string) => participant === f.sender.id ? f.sender.identity : participant === f.recipient.id ? f.recipient.identity : undefined };
    const underlying = new AttachmentService(new PersistentAttachmentDeliveryStore(persistence));
    const service = new AuthenticatedAttachmentService(new ConversationAuthorizationService(memberships, access), underlying, access);
    const metadata = await f.sealed(64), object = await f.sealed(1);
    const file = await service.createUpload(await f.admitted(f.sender, 'attachment:create'), { size: 1, chunkCount: 1, expiresAt: Date.now() + 60000, encryptedMetadata: { nonce: Buffer.from(metadata.nonce, 'base64url'), ciphertext: Buffer.from(metadata.ciphertext, 'base64url') }, recipientParticipantId: f.recipient.id, recipientIdentityReference: f.recipient.identity });
    await service.storeChunk(await f.admitted(f.sender, 'attachment:write'), file.id, file.capability, { attachmentId: file.id, index: 0, total: 1, nonce: Buffer.from(object.nonce, 'base64url'), ciphertext: Buffer.from(object.ciphertext, 'base64url') });
    await service.completeUpload(await f.admitted(f.sender, 'attachment:write'), file.id, file.capability);
    const app = express(); app.use(express.json()); app.use('/legacy', createAttachmentRouter({ authenticate: authenticateAttachment, attachments: service }));
    const h = () => f.headers(f.recipient, 'attachment:read');
    return { f, persistence, app, file, object, metadata, h };
  }

  test('legacy binary round-trip preserves stored encrypted bytes', async () => {
    const { app, file, object, metadata, persistence, h } = await legacyFixture();
    const normal = await request(app).get('/legacy/' + file.id + '/chunks').set(await h()).set('X-K3ncrypt-Attachment-Capability', file.capability);
    expect(normal.status).toBe(200); expect(normal.body[0].ciphertext).toBe(object.ciphertext);
    expect(normal.body[0].nonce).toBe(object.nonce);
    const record = await persistence.metadata.find(file.id);
    expect(Buffer.from(record!.encryptedMetadata.nonce).toString('base64url')).toBe(metadata.nonce);
    expect(Buffer.from(record!.encryptedMetadata.ciphertext).toString('base64url')).toBe(metadata.ciphertext);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(object.nonce, 'base64url') }, sealKey, Buffer.from(normal.body[0].ciphertext, 'base64url'));
    expect(new Uint8Array(plaintext)).toEqual(new Uint8Array(1));
    const corrupted = Buffer.from(normal.body[0].ciphertext, 'base64url'); corrupted[0] ^= 1;
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(object.nonce, 'base64url') }, sealKey, corrupted)).rejects.toThrow();
  }, 20000);

  test('legacy completion is fenced after signed revocation during Mongo fetch', async () => {
    const { f, persistence, app, file, h } = await legacyFixture();
    const block = gate(), original = persistence.chunks.list.bind(persistence.chunks);
    jest.spyOn(persistence.chunks, 'list').mockImplementationOnce(async id => { const chunks = await original(id); block.enter(); await block.wait; return chunks; });
    const response = Promise.resolve(request(app).get('/legacy/' + file.id + '/chunks').set(await h()).set('X-K3ncrypt-Attachment-Capability', file.capability));
    try { await block.entered; await f.recipient.revoke(); } finally { block.release(); }
    const result = await response; expect(result.status).toBe(404); expect(result.body).toEqual({ error: 'Attachment unavailable' });
  }, 20000);

  test('fresh continuation reads add no proof claims or ledger writes', async () => {
    const f = await fixture(), admitted = await f.admitted(f.sender, 'attachment:read');
    const before = await database.collection('device_proof_nonces').countDocuments({ deviceId: f.sender.id });
    const at = performance.now();
    for (let n = 0; n < 100; n++) await admitted.deviceTrust.assertTrusted();
    console.log('ATTACHMENT_TRUST_SAFE', JSON.stringify({ checks: 100, elapsedMs: Math.round((performance.now() - at) * 100) / 100 }));
    expect(await database.collection('device_proof_nonces').countDocuments({ deviceId: f.sender.id })).toBe(before);
    expect(await f.persistence.read(f.sender.account)).toBeUndefined();
  }, 20000);

  test('a CAS conflict cannot reuse admission after revocation on the retry', async () => {
    const f = await fixture(); const id = (await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input)).context.transferId;
    const write = jest.spyOn(f.persistence, 'replace').mockImplementationOnce(async () => { await f.sender.revoke(); return false; });
    const result = await request(f.app).put('/files/' + id + '/manifest').set(await f.headers(f.sender, 'attachment:write')).send(await f.sealed(64));
    expect(result.status).toBe(403); expect(write).toHaveBeenCalledTimes(1);
    expect((await f.persistence.read(f.sender.account))?.transfers[0].manifest).toBeUndefined();
  }, 20000);

  test('proof replay and a separately authenticated foreign room remain denied', async () => {
    const f = await fixture(), other = await fixture();
    const id = (await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input)).context.transferId;
    const h = await f.headers(f.sender, 'attachment:read');
    expect((await request(f.app).get('/files/' + id).set(h)).status).toBe(200);
    expect((await request(f.app).get('/files/' + id).set(h)).status).toBe(403);
    expect((await request(f.app).get('/files/' + id).set(await other.headers(other.sender, 'attachment:read'))).status).toBe(403);
  }, 20000);

  test('available recipient manifest metadata is denied after revocation at the final status read', async () => {
    const f = await fixture(), id = (await f.service.create(await f.admitted(f.sender, 'attachment:create'), f.input)).context.transferId;
    await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 'manifest', await f.sealed(64));
    await f.service.put(await f.admitted(f.sender, 'attachment:write'), id, 0, await f.sealed(1));
    await f.service.complete(await f.admitted(f.sender, 'attachment:write'), id);
    const block = gate(), original = f.persistence.read.bind(f.persistence);
    jest.spyOn(f.persistence, 'read').mockImplementationOnce(async account => { const value = await original(account); block.enter(); await block.wait; return value; });
    const response = Promise.resolve(request(f.app).get('/files/' + id).set(await f.headers(f.recipient, 'attachment:read')));
    try { await block.entered; await f.recipient.revoke(); } finally { block.release(); }
    const result = await response; expect(result.status).toBe(403); expect(result.body).toEqual({ failure: 'authorization' });
  }, 20000);
  test('V2-only staging performs signed encrypted round-trip without any legacy Mongo collection operation', async () => {
    const f = await fixture();
    const { allowStagingPath } = require('../../scripts/staging/attachmentPolicy.cjs');
    const app = express(); app.use(express.json());
    app.use((req, res, next) => allowStagingPath(req.originalUrl) ? next() : void res.sendStatus(404));
    app.use('/api/attachments/v2', createFileRouter(authenticateAttachment, () => f.service));
    let legacyDispatches = 0, legacyCommands = 0;
    app.use('/api/attachments', (_req, res) => { legacyDispatches++; res.sendStatus(500); });
    const observed = (event: any) => {
      const command = event.command;
      if (['attachment_metadata', 'attachment_chunks', 'attachment_access'].includes(command.find ?? command.insert ?? command.update ?? command.delete)) legacyCommands++;
    };
    client.on('commandStarted', observed);
    try {
      expect((await request(app).post('/api/attachments/create').set(await f.headers(f.sender, 'attachment:create')).send(f.input)).status).toBe(404);
      const created = await request(app).post('/api/attachments/v2/create').set(await f.headers(f.sender, 'attachment:create')).send(f.input);
      expect(created.status).toBe(200); const id = created.body.context.transferId;
      expect((await request(app).put('/api/attachments/v2/' + id + '/manifest').set(await f.headers(f.sender, 'attachment:write')).send(await f.sealed(64))).status).toBe(200);
      const chunk = await f.sealed(1);
      expect((await request(app).put('/api/attachments/v2/' + id + '/chunks/0').set(await f.headers(f.sender, 'attachment:write')).set('Content-Type', 'application/octet-stream').set('X-K3ncrypt-File-Nonce', chunk.nonce).send(Buffer.from(chunk.ciphertext, 'base64url'))).status).toBe(200);
      expect((await request(app).post('/api/attachments/v2/' + id + '/complete').set(await f.headers(f.sender, 'attachment:write')).send({})).status).toBe(200);
      const downloaded = await request(app).get('/api/attachments/v2/' + id + '/chunks/0').set(await f.headers(f.recipient, 'attachment:read'));
      expect(downloaded.status).toBe(200); expect(downloaded.body).toEqual(chunk);
      expect((await request(app).get('/api/attachments/v2/' + id).set(await f.headers(f.recipient, 'attachment:read'))).status).toBe(200);
      expect(legacyDispatches).toBe(0); expect(legacyCommands).toBe(0);
    } finally { client.off('commandStarted', observed); }
  }, 20000);

});
