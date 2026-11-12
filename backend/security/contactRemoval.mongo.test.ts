import { spawn, type ChildProcess } from 'node:child_process';
import socketClient, { type Socket } from 'socket.io-client';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, webcrypto } from 'crypto';
import { MongoClient, type Db } from 'mongodb';
import { applyMigrations } from '../db/migrations';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from './durableDeviceTrust';
import { routingProofHash } from './routingOwnership';
import { ownerKey, PUSH_ROUTES, routeKey } from '../push/durableWakeStore';
import type { BootstrapRequest, DeviceProofRequest } from '../../service/src/devices/trustProtocol';
import type { DeviceOperation } from './deviceTrust';
import { fingerprintVodozemacIdentity } from '../../service/src/identity/vodozemacIdentity';
const request = require('supertest');
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

/**
 * Guard for "Remove contact" [integration test]: a real relay process on a disposable loopback Mongo.
 * After the remover revokes its own route, the other participant's send stores nothing and wakes nothing,
 * the remover's waiting mail and wake route are gone, its live socket is ejected, and it can never rejoin.
 */
const uri = process.env.K3NCRYPT_ROUTING_MONGO_URI;
const suite = uri ? describe : describe.skip;
const PORT = 43461, base = `http://127.0.0.1:${PORT}`;
const signed = <T extends object>(value: T, key: ReturnType<typeof generateKeyPairSync>['privateKey']) => ({ ...value, signature: sign(null, Buffer.from(JSON.stringify(value)), key).toString('base64url') });
const envelope = () => ({ version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'synthetic opaque ciphertext ' + randomUUID() } });

suite('remove contact: route revocation, mailbox purge and silent discard', () => {
  let client: MongoClient, database: Db, authority: DurableDeviceTrustAuthority, worker: ChildProcess | undefined;
  const name = 'k3ncrypt_removal_' + randomUUID().replace(/-/g, ''), secret = randomBytes(32).toString('hex');
  const sockets: Socket[] = [];
  beforeAll(async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Disposable loopback Mongo only');
    client = await new MongoClient(uri).connect(); database = client.db(name); await applyMigrations(database);
    authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), secret);
    if (await fetch(`${base}/api/ready`).then(() => true, () => false)) throw new Error('Disposable worker port occupied');
    worker = spawn(process.execPath, ['-r', 'ts-node/register', 'index.ts'], { cwd: process.cwd(), stdio: 'ignore', env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test', PORT: String(PORT), K3NCRYPT_BIND_HOST: '127.0.0.1', MONGO_URI: uri, MONGO_DB_NAME: name,
      K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: secret, K3NCRYPT_DURABLE_ROUTING: 'true', K3NCRYPT_MAINTENANCE_MODE: 'false', K3NCRYPT_ALLOWED_ORIGINS: 'http://127.0.0.1:43432',
    } });
    const deadline = Date.now() + 30000; let ready = false;
    while (Date.now() < deadline && !ready) {
      if (worker.exitCode !== null) throw new Error('Disposable worker exited before ready');
      ready = await fetch(`${base}/api/ready`).then(response => response.status === 200, () => false);
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Disposable worker did not become ready');
  }, 60000);
  afterAll(async () => {
    sockets.forEach(socket => socket.disconnect());
    if (worker && worker.exitCode === null) { const exited = new Promise<void>(resolve => worker!.once('exit', () => resolve())); worker.kill('SIGTERM'); await exited; }
    if (database) await database.dropDatabase(); await client?.close();
  }, 30000);

  async function actor() {
    const pair = generateKeyPairSync('ed25519'), key = pair.privateKey, publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const identity = { curve25519: randomBytes(32).toString('base64url'), ed25519: publicKey };
    const fingerprint = await fingerprintVodozemacIdentity(identity), id = randomUUID(), now = Date.now();
    const bootstrap: Omit<BootstrapRequest, 'signature'> = { version: 1, requestId: randomUUID(), deviceId: id, deviceIdentityReference: fingerprint, fingerprint, verificationKey: publicKey, nonce: randomBytes(24).toString('base64url'), createdAt: now, expiresAt: now + 30000 };
    const account = await authority.bootstrap(signed(bootstrap, key));
    const proof = async (operation: DeviceOperation, channel: string) => {
      const at = Date.now(); const value: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account.accountIdentityReference, deviceId: id, deviceIdentityReference: fingerprint,
        operation, nonce: randomBytes(24).toString('base64url'), epoch: 1, createdAt: at, expiresAt: at + 30000, resource: { conversationId: channel } };
      return authority.issue(signed(value, key));
    };
    return { id, identity, fingerprint, account, proof };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  type Route = { address: string; proof: string };
  async function room() {
    const channel = randomUUID(), capability = randomBytes(32).toString('base64url');
    await database.collection('links').insertOne({ hash: channel, controlCapabilityHash: createHash('sha256').update(capability).digest('hex'), expired: false, deleted: false, invitationPublications: 2, invitationExpiresAt: new Date(0) });
    return { channel, capability };
  }
  type Room = Awaited<ReturnType<typeof room>>;
  async function publication(a: Actor, channel: string): Promise<Route> {
    const address = randomUUID(), proof = randomBytes(32).toString('base64url');
    await database.collection('prekey_bundles').insertOne({ channel, address, renewalProofHash: routingProofHash(proof), createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000),
      bundle: { version: 1, protocol: 'vodozemac-olm-v1', identity: { ...a.identity }, oneTimeKeys: [{ id: 'otk-' + randomBytes(8).toString('hex'), key: randomBytes(32).toString('base64url') }] } });
    return { address, proof };
  }
  async function headers(a: Actor, r: Room, route: Route, participant = route.address) {
    const proof = await a.proof('device-control', r.channel);
    return { 'X-K3ncrypt-Control-Capability': r.capability, 'X-K3ncrypt-Participant': participant, 'X-K3ncrypt-Routing-Proof': route.proof,
      'X-K3ncrypt-Device-Proof': Buffer.from(JSON.stringify(proof)).toString('base64url'), 'X-K3ncrypt-Device-Nonce': proof.nonce };
  }
  async function join(a: Actor, r: Room, route: Route) {
    const socket = socketClient(base, { transports: ['websocket'], reconnection: false }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const proof = await a.proof('relay:message', r.channel);
    const joined = await socket.timeout(5000).emitWithAck('chat-join', { userID: route.address, channelID: r.channel, controlCapability: r.capability, routingProof: route.proof, deviceAuthorizationProof: proof, proofNonce: proof.nonce });
    return { socket, joined };
  }
  async function send(a: Actor, r: Room, socket: Socket, to: string) {
    const proof = await a.proof('relay:message', r.channel);
    return socket.timeout(8000).emitWithAck('chat-message', { recipientRoutingId: to, envelope: envelope(), deviceAuthorizationProof: proof, proofNonce: proof.nonce, proofOperation: 'relay:message' });
  }
  const mail = (r: Room, mailbox: string) => database.collection('offline_messages').countDocuments({ channel: r.channel, mailbox });
  const revokePath = (r: Room, route: Route) => `/api/chat-link/${r.channel}/routing/${route.address}`;
  /** Peer and remover both admitted once (which adopts their routes); the remover then goes offline with one message waiting and a wake route. */
  async function scene() {
    const peer = await actor(), remover = await actor(), r = await room(), p = await publication(peer, r.channel), q = await publication(remover, r.channel);
    const peerSide = await join(peer, r, p); expect(peerSide.joined.status).toBe('accepted');
    const first = await join(remover, r, q); expect(first.joined.status).toBe('accepted');
    first.socket.disconnect(); await new Promise(resolve => setTimeout(resolve, 150));
    const stored = await send(peer, r, peerSide.socket, q.address); expect(stored.stored).toBe(true);
    expect(await mail(r, q.address)).toBe(1);
    const now = new Date(), key = routeKey(r.channel, q.address);
    await database.collection(PUSH_ROUTES).insertOne({ _id: ownerKey(remover.account.accountIdentityReference, remover.id), accountIdentityReference: remover.account.accountIdentityReference, deviceId: remover.id,
      deviceIdentityReference: remover.fingerprint, trustEpoch: 1, revision: randomUUID(), updatedAt: now, expiresAt: new Date(now.getTime() + 86400000),
      routes: [{ key, room: r.channel, routingAddress: q.address, identityReference: remover.fingerprint, verifiedAt: now, validUntil: new Date(now.getTime() + 86400000) }] } as never);
    return { peer, remover, r, p, q, peerSocket: peerSide.socket, key };
  }

  test('after removal the peer\'s send is accepted and dropped: no stored mail, no wake route, no way back in', async () => {
    const s = await scene();
    const response = await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.remover, s.r, s.q)).expect(200);
    expect(response.body).toEqual({ status: 'revoked' });
    expect(await mail(s.r, s.q.address)).toBe(0);
    expect(await database.collection(PUSH_ROUTES).countDocuments({ 'routes.key': s.key })).toBe(0);
    const owners = (await database.collection('links').findOne({ hash: s.r.channel }))!.routingOwners as { address: string; state: string }[];
    expect(owners.find(owner => owner.address === s.q.address)!.state).toBe('revoked');
    expect(owners.find(owner => owner.address === s.p.address)!.state).toBe('active');

    const before = await database.collection('offline_messages').countDocuments({});
    const ack = await send(s.peer, s.r, s.peerSocket, s.q.address);
    expect(ack.error).toBeUndefined(); expect(typeof ack.id).toBe('string'); expect(ack.stored).toBe(true);
    expect(Object.keys(ack).sort()).toEqual(['id', 'stored', 'timestamp']);
    expect(await database.collection('offline_messages').countDocuments({})).toBe(before);
    expect(await mail(s.r, s.q.address)).toBe(0);

    const again = await join(s.remover, s.r, s.q);
    expect(again.joined.status).toBeUndefined(); expect(typeof again.joined.error).toBe('string');
  }, 30000);

  test('revocation is repeatable, and ejects the remover\'s live socket', async () => {
    const s = await scene();
    const live = await join(s.remover, s.r, s.q); expect(live.joined.status).toBe('accepted');
    const dropped = new Promise<string>(resolve => live.socket.once('disconnect', resolve));
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.remover, s.r, s.q)).expect(200);
    expect(typeof await dropped).toBe('string');
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.remover, s.r, s.q)).expect(200);
    expect(await mail(s.r, s.q.address)).toBe(0);
  }, 30000);

  test('only the device that owns the address can remove it', async () => {
    const s = await scene();
    // The peer, holding the same room capability, cannot revoke the other side: not as itself, and not with the other side's leaked routing proof.
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.peer, s.r, s.p)).expect(403);
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.peer, s.r, s.q)).expect(403);
    await request(base).delete(revokePath(s.r, s.q)).set({ ...await headers(s.remover, s.r, s.q), 'X-K3ncrypt-Routing-Proof': randomBytes(32).toString('base64url') }).expect(403);
    expect(await mail(s.r, s.q.address)).toBe(1);
    expect(await database.collection(PUSH_ROUTES).countDocuments({ 'routes.key': s.key })).toBe(1);
    // After a genuine removal, a different device still cannot replay it.
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.remover, s.r, s.q)).expect(200);
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.peer, s.r, s.q)).expect(403);
  }, 30000);

  test('the peer sees nothing new: the removed side\'s pinned identity is still served, and a deleted room answers 410', async () => {
    const s = await scene();
    await request(base).delete(revokePath(s.r, s.q)).set(await headers(s.remover, s.r, s.q)).expect(200);
    const identity = await request(base).get(`/api/chat-link/${s.r.channel}/routing/${s.q.address}/identity`).set(await headers(s.peer, s.r, s.p)).expect(200);
    expect(identity.body).toEqual({ version: 1, identity: s.remover.identity });
    // The tombstone authorises nothing for its former owner.
    await request(base).get(`/api/chat-link/${s.r.channel}/routing/${s.p.address}/identity`).set(await headers(s.remover, s.r, s.q)).expect(403);
    const other = await scene();
    await database.collection('links').updateOne({ hash: other.r.channel }, { $set: { deleted: true } });
    const gone = await request(base).delete(revokePath(other.r, other.q)).set(await headers(other.remover, other.r, other.q)).expect(410);
    expect(gone.body).toEqual({ status: 'gone' });
  }, 30000);
});
