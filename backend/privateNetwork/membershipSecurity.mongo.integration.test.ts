import { createServer, type Server as HttpServer } from 'http';
import { MongoClient, type Db } from 'mongodb';
import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import socketIOClient, { type Socket } from 'socket.io-client';
import db from '../db';
import { applyMigrations } from '../db/migrations';
import { initPrivateNetworkRelay, PRIVATE_NETWORK_SOCKET_PATH } from './relay';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { DurableNetworkMembershipAuthority } from '../security/networkMembership';
import type { DeviceProofRequest, NetworkMembershipEvent } from '../../service/src/devices/trustProtocol';

const suite = process.env.MONGO_URI && process.env.MONGO_DB_NAME ? describe : describe.skip;
const secret = process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET ?? 'phase8m-membership-test-secret-at-least-32';
const rawPublic = (key: ReturnType<typeof generateKeyPairSync>['publicKey']): string => key.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const signed = (value: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string => sign(null, Buffer.from(JSON.stringify(value)), privateKey).toString('base64url');
const wait = <T>(socket: Socket, event: string): Promise<T> => new Promise((resolve, reject) => { socket.once(event, resolve); socket.once('connect_error', reject); });

suite('private-network durable membership enforcement', () => {
  let mongo: MongoClient; let database: Db; let http: HttpServer; let url: string; const sockets: Socket[] = [];
  const accountA = `account-a-${randomUUID()}`; const accountB = `account-b-${randomUUID()}`; const network = randomUUID();
  const ownerId = randomUUID(); const memberId = randomUUID(); const foreignId = randomUUID();
  const owner = generateKeyPairSync('ed25519'); const member = generateKeyPairSync('ed25519'); const foreign = generateKeyPairSync('ed25519');
  const storeRecord = async (account: string, deviceId: string, identity: string, key: string) => database.collection('device_lifecycle').insertOne({ accountIdentityReference: account, deviceId, deviceIdentityReference: identity, verificationKeyReference: key, state: 'active', trustEpoch: 1, createdAt: Date.now(), lastTrustUpdate: Date.now() });
  const proof = async (authority: DurableDeviceTrustAuthority, account: string, deviceId: string, identity: string, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], operation = 'private-network:relay') => {
    const now = Date.now(); const request: Omit<DeviceProofRequest, 'signature'> = { version: 1, requestId: randomUUID(), accountIdentityReference: account, deviceId, deviceIdentityReference: identity, operation, nonce: randomUUID().replace(/-/g, ''), epoch: 1, resource: operation === 'private-network:relay' ? { networkId: network } : undefined, createdAt: now, expiresAt: now + 30_000 };
    return authority.issue({ ...request, signature: signed(request as Record<string, unknown>, privateKey) });
  };

  beforeAll(async () => {
    mongo = new MongoClient(process.env.MONGO_URI!); await mongo.connect(); database = mongo.db(process.env.MONGO_DB_NAME); await applyMigrations(database);
    await database.collection('device_lifecycle').deleteMany({ deviceId: { $in: [ownerId, memberId, foreignId] } });
    await database.collection('private_network_members').deleteMany({ networkId: network }); await database.collection('private_network_membership_events').deleteMany({ networkId: network });
    await storeRecord(accountA, ownerId, 'owner-identity', rawPublic(owner.publicKey)); await storeRecord(accountA, memberId, 'member-identity', rawPublic(member.publicKey)); await storeRecord(accountB, foreignId, 'foreign-identity', rawPublic(foreign.publicKey));
    await database.collection('private_network_members').insertOne({ networkId: network, accountIdentityReference: accountA, deviceId: ownerId, identityReference: 'owner-identity', state: 'active', epoch: 1, deviceTrustEpoch: 1, capabilities: ['network-owner'], updatedAt: Date.now() });
    await database.collection('private_network_members').insertOne({ networkId: network, accountIdentityReference: accountA, deviceId: memberId, identityReference: 'member-identity', state: 'active', epoch: 1, deviceTrustEpoch: 1, capabilities: [], updatedAt: Date.now() });
    await db.connectDb(); http = createServer(); initPrivateNetworkRelay(http); await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve)); const port = (http.address() as { port: number }).port; url = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => { sockets.forEach((socket) => socket.disconnect()); await new Promise<void>((resolve) => setTimeout(resolve, 10)); await new Promise<void>((resolve) => http.close(() => resolve())); await mongo.close(); });

  it('disconnects an existing member after durable removal and blocks subsequent packets', async () => {
    const authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), secret);
    const ownerProof = await proof(authority, accountA, ownerId, 'owner-identity', owner.privateKey); const memberProof = await proof(authority, accountA, memberId, 'member-identity', member.privateKey);
    const connect = (deviceId: string, carrier: Awaited<ReturnType<typeof proof>>) => { const socket = socketIOClient(url, { path: PRIVATE_NETWORK_SOCKET_PATH, transports: ['websocket'], auth: { networkId: network, deviceId, nonce: carrier.nonce, proof: carrier } }); sockets.push(socket); return socket; };
    const ownerSocket = connect(ownerId, ownerProof); const memberSocket = connect(memberId, memberProof); await Promise.all([wait(ownerSocket, 'connect'), wait(memberSocket, 'connect')]);
    const received = wait<{ senderDeviceId: string }>(ownerSocket, 'private-network-envelope');
    let acknowledgement: { status?: string } | undefined;
    for (let attempt = 0; attempt < 20 && acknowledgement?.status !== 'accepted'; attempt += 1) {
      acknowledgement = await new Promise<{ status?: string } | undefined>((resolve) => { const timeout = setTimeout(() => resolve(undefined), 50); memberSocket.emit('private-network-envelope', { targetDeviceId: ownerId, envelope: { opaque: true } }, (value: { status?: string }) => { clearTimeout(timeout); resolve(value); }); });
    }
    expect(acknowledgement?.status).toBe('accepted');
    expect((await received).senderDeviceId).toBe(memberId);
    await database.collection('private_network_members').updateOne({ networkId: network, deviceId: memberId }, { $set: { state: 'removed' } });
    let forwardedAfterRemoval = false;
    ownerSocket.once('private-network-envelope', () => { forwardedAfterRemoval = true; });
    const disconnected = wait<void>(memberSocket, 'disconnect');
    memberSocket.emit('private-network-envelope', { targetDeviceId: ownerId, envelope: { opaque: true } });
    await disconnected;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(forwardedAfterRemoval).toBe(false);
    ownerSocket.disconnect();
  });

  it('rejects adding an active device from another account', async () => {
    const authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), secret); const now = Date.now();
    const proofOwner = await proof(authority, accountA, ownerId, 'owner-identity', owner.privateKey, 'device-control');
    const event: Omit<NetworkMembershipEvent, 'signature'> = { version: 1, eventId: randomUUID(), networkId: network, accountIdentityReference: accountA, issuerDeviceId: ownerId, issuerIdentityReference: 'owner-identity', targetDeviceId: foreignId, targetIdentityReference: 'foreign-identity', operation: 'add-member', previousEpoch: 1, nextEpoch: 2, capabilities: [], createdAt: now, expiresAt: now + 30_000, nonce: randomUUID().replace(/-/g, '') };
    await expect(new DurableNetworkMembershipAuthority(database).apply({ ...event, signature: signed(event as Record<string, unknown>, owner.privateKey) }, proofOwner)).rejects.toThrow('rejected');
    expect(await database.collection('private_network_members').findOne({ networkId: network, deviceId: foreignId })).toBeNull();
  });
});
