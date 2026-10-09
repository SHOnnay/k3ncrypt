import { createServer, type Server as HttpServer } from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import db from '../db';
import { LINK_COLLECTION, PREKEY_COLLECTION } from '../db/const';
import * as durableTrust from '../security/durableDeviceTrust';
import { hashControlCapability } from '../security/controlCapability';
import { initSocket, type CustomSocket } from './index';
import getClients from './clients';
import { registerMultiplexedRelay, testOnlyResetMuxDeviceRegistry } from './multiplexed';

const events = ['mux-authenticate', 'mux-subscribe', 'mux-unsubscribe', 'mux-send-message', 'mux-send-signal', 'mux-mailbox-replay'] as const;
const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'test-ciphertext' } };
type RecordResponse = Record<string, unknown>;
const ack = (socket: Socket, event: string, payload: unknown): Promise<RecordResponse> => socket.timeout(2_000).emitWithAck(event, payload);
const savedEnv = { node: process.env.NODE_ENV, flag: process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY };
const records = new Map<string, { deviceId: string; accountIdentityReference: string; trustEpoch: number; state: string }>();
const verify = jest.fn(async (proof: { deviceId: string }) => records.get(proof.deviceId));
let http: HttpServer; let relay: Server; let url: string;
const sockets: Socket[] = [];

const peer = async () => {
  const deviceId = randomUUID(); const accountIdentityReference = `gate-${randomUUID()}`;
  records.set(deviceId, { deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' });
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const proof = (operation: string, resource: object = {}) => {
    const nonce = randomUUID();
    return { deviceAuthorizationProof: { version: 1, proofId: randomUUID(), deviceId, accountIdentityReference,
      operation, resource, trustEpoch: 1, nonce, expiresAt: Date.now() + 60_000 }, proofNonce: nonce, proofOperation: operation };
  };
  return { socket, proof, server: relay.sockets.sockets.get(socket.id!) as CustomSocket };
};
const room = async () => {
  const roomId = randomUUID(); const controlCapability = randomBytes(32).toString('base64url');
  const routes = [randomUUID(), randomUUID()]; const proofs = routes.map(() => randomBytes(32).toString('base64url'));
  await db.insertInDb({ hash: roomId, controlCapabilityHash: hashControlCapability(controlCapability), deleted: false, expired: false }, LINK_COLLECTION);
  for (let i = 0; i < 2; i += 1) await db.insertInDb({ channel: roomId, address: routes[i],
    renewalProofHash: createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proofs[i]}`).digest('hex'), expiresAt: new Date(Date.now() + 60_000) }, PREKEY_COLLECTION);
  return { roomId, controlCapability, routes, proofs };
};
const authenticate = (p: Awaited<ReturnType<typeof peer>>) => ack(p.socket, 'mux-authenticate', {
  connectionGeneration: p.socket.id, ...p.proof('relay:connect', { connectionGeneration: p.socket.id }),
});
const subscribe = (p: Awaited<ReturnType<typeof peer>>, r: Awaited<ReturnType<typeof room>>, side: number) => ack(p.socket, 'mux-subscribe', {
  version: 1, roomId: r.roomId, routingAddress: r.routes[side], peerRoutingAddress: r.routes[1 - side],
  controlCapability: r.controlCapability, routingProof: r.proofs[side], connectionGeneration: p.socket.id,
  protocolFeatures: ['room-message-v1', 'room-call-signal-v2'],
  ...p.proof('relay:subscribe', { conversationId: r.roomId, routingAddress: r.routes[side], peerRoutingAddress: r.routes[1 - side], connectionGeneration: p.socket.id }),
});
const legacyJoin = (p: Awaited<ReturnType<typeof peer>>, r: Awaited<ReturnType<typeof room>>, side: number) => {
  const carrier = p.proof('relay:message');
  return ack(p.socket, 'chat-join', { userID: r.routes[side], channelID: r.roomId,
    controlCapability: r.controlCapability, routingProof: r.proofs[side],
    deviceAuthorizationProof: carrier.deviceAuthorizationProof, proofNonce: carrier.proofNonce });
};

beforeAll(async () => {
  jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify } as never);
  jest.spyOn(db, 'getDatabase').mockReturnValue({ collection: () => ({ findOne: async (filter: { deviceId: string }) => records.get(filter.deviceId) }) } as never);
  jest.spyOn(db, 'storeOfflineMessage');
  http = createServer(); relay = initSocket(http);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Test listener unavailable.');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  // Drain the actual server disconnect events before changing environment policy.
  await new Promise<void>(resolve => setImmediate(resolve));
  relay.disconnectSockets(true);
  testOnlyResetMuxDeviceRegistry();
  jest.clearAllMocks();
});
afterAll(async () => {
  await new Promise<void>(resolve => relay.close(() => resolve()));
  jest.restoreAllMocks();
  if (savedEnv.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnv.node;
  if (savedEnv.flag === undefined) delete process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY; else process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = savedEnv.flag;
});

it.each([
  ['production', undefined], ['production', 'true'], ['development', undefined], ['development', 'false'],
  ['test', undefined], ['test', 'false'],
])('disables the full Mux surface in %s with flag %s while legacy messages remain usable', async (node, flag) => {
  process.env.NODE_ENV = node;
  if (flag === undefined) delete process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY; else process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = flag;
  const r = await room(); const alice = await peer(); const bob = await peer();
  const databaseReads = jest.mocked(db.getDatabase);
  const verificationBoundary = jest.mocked(durableTrust.durableDeviceTrustAuthority);
  for (const event of events) expect(alice.server.listenerCount(event)).toBe(0);
  // The exported registration path must also enforce the policy.
  registerMultiplexedRelay(alice.server, relay);
  for (const event of events) expect(alice.server.listenerCount(event)).toBe(0);
  await Promise.all(events.map(event => expect(alice.socket.timeout(100).emitWithAck(event, {
    version: 1, roomId: r.roomId, routingAddress: r.routes[0], peerRoutingAddress: r.routes[1],
    connectionGeneration: alice.socket.id, controlCapability: r.controlCapability, routingProof: r.proofs[0],
    envelope, ...alice.proof('relay:connect', { connectionGeneration: alice.socket.id }),
  })).rejects.toThrow()));
  expect(alice.server.muxConnectionGeneration).toBeUndefined();
  expect(alice.server.muxSubscriptions).toBeUndefined();
  expect(getClients().getClientsByChannel(r.roomId)).toEqual({});
  expect(databaseReads).not.toHaveBeenCalled();
  expect(verificationBoundary).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
  expect(db.storeOfflineMessage).not.toHaveBeenCalled();
  // Join with correctly correlated proof nonces.
  for (const [p, side] of [[alice, 0], [bob, 1]] as const) {
    const carrier = p.proof('relay:message');
    expect(await ack(p.socket, 'chat-join', { userID: r.routes[side], channelID: r.roomId,
      controlCapability: r.controlCapability, routingProof: r.proofs[side], deviceAuthorizationProof: carrier.deviceAuthorizationProof,
      proofNonce: carrier.proofNonce })).toMatchObject({ status: 'accepted' });
  }
  const received = new Promise<RecordResponse>(resolve => bob.socket.once('chat-message', (message, accept) => { accept({ outcome: 'accepted' }); resolve(message); }));
  expect(await ack(alice.socket, 'chat-message', { envelope, ...alice.proof('relay:message', { conversationId: r.roomId }) })).toHaveProperty('id');
  expect(await received).toMatchObject({ envelope, sender: r.routes[0] });
});

it('enables two rooms, background delivery and call signaling only with an explicit development opt-in', async () => {
  process.env.NODE_ENV = 'development'; process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
  const first = await room(); const second = await room(); const alice = await peer(); const bob = await peer(); const carol = await peer();
  for (const p of [alice, bob, carol]) expect(await authenticate(p)).toMatchObject({ status: 'authenticated' });
  for (const [p, r, side] of [[alice, first, 0], [alice, second, 0], [bob, first, 1], [carol, second, 1]] as const)
    expect(await subscribe(p, r, side)).toMatchObject({ status: 'subscribed', roomId: r.roomId });
  expect(alice.server.muxSubscriptions?.size).toBe(2);
  const received = new Promise<RecordResponse>(resolve => alice.socket.once('mux-envelope', (frame, accept) => {
    accept({ outcome: 'accepted', roomId: frame.roomId, id: frame.id, claimId: frame.claimId,
      connectionGeneration: frame.connectionGeneration, subscriptionNonce: frame.subscriptionNonce }); resolve(frame);
  }));
  expect(await ack(carol.socket, 'mux-send-message', { version: 1, roomId: second.roomId, envelope,
    ...carol.proof('relay:message', { conversationId: second.roomId, routingAddress: second.routes[1], peerRoutingAddress: second.routes[0], connectionGeneration: carol.socket.id }) })).toMatchObject({ status: 'stored' });
  expect(await received).toMatchObject({ roomId: second.roomId, envelope, senderRoutingAddress: second.routes[1] });
  const signal = new Promise<RecordResponse>(resolve => alice.socket.once('mux-call-signal', resolve));
  expect(await ack(bob.socket, 'mux-send-signal', { version: 1, roomId: first.roomId, envelope,
    ...bob.proof('relay:signal', { conversationId: first.roomId, routingAddress: first.routes[1], peerRoutingAddress: first.routes[0], connectionGeneration: bob.socket.id }) })).toMatchObject({ status: 'routed' });
  expect(await signal).toMatchObject({ roomId: first.roomId, envelope });
  await new Promise<void>(resolve => setImmediate(resolve));
  jest.clearAllMocks();
  process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'false';
  // Even previously registered handlers must stop before authorization or state writes.
  for (const event of events) expect(await ack(alice.socket, event, {})).toHaveProperty('error');
  expect(verify).not.toHaveBeenCalled(); expect(db.getDatabase).not.toHaveBeenCalled(); expect(db.storeOfflineMessage).not.toHaveBeenCalled();
});

it('keeps legacy as the exclusive room owner and delivers one live message with one recipient acceptance', async () => {
  process.env.NODE_ENV = 'development'; process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
  const r = await room(); const alice = await peer(); const bob = await peer(); const muxContender = await peer();
  expect(await legacyJoin(alice, r, 0)).toMatchObject({ status: 'accepted' });
  expect(await legacyJoin(bob, r, 1)).toMatchObject({ status: 'accepted' });
  expect(await authenticate(muxContender)).toMatchObject({ status: 'authenticated' });
  expect(await subscribe(muxContender, r, 0)).toHaveProperty('error');
  expect(muxContender.server.muxSubscriptions?.has(r.roomId)).not.toBe(true);

  let recipientAcceptances = 0; let deliveredEvents = 0;
  const received = new Promise<RecordResponse>(resolve => bob.socket.once('chat-message', (message, accept) => {
    deliveredEvents += 1; recipientAcceptances += 1; accept({ outcome: 'accepted' }); resolve(message);
  }));
  const result = await ack(alice.socket, 'chat-message', { envelope, ...alice.proof('relay:message', { conversationId: r.roomId }) });
  expect(result).toHaveProperty('id');
  expect(await received).toMatchObject({ envelope, sender: r.routes[0] });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(deliveredEvents).toBe(1);
  expect(recipientAcceptances).toBe(1);
  expect(alice.server.muxSubscriptions).toBeUndefined();
});

it('keeps Mux as the exclusive room owner and prevents legacy competing delivery acknowledgements', async () => {
  process.env.NODE_ENV = 'development'; process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
  const r = await room(); const alice = await peer(); const bob = await peer(); const legacyContender = await peer();
  for (const p of [alice, bob]) expect(await authenticate(p)).toMatchObject({ status: 'authenticated' });
  expect(await subscribe(alice, r, 0)).toMatchObject({ status: 'subscribed' });
  expect(await subscribe(bob, r, 1)).toMatchObject({ status: 'subscribed' });
  expect(await legacyJoin(legacyContender, r, 0)).toMatchObject({ error: expect.any(String), code: 'room-transport-conflict' });
  expect(legacyContender.server.userID).toBeUndefined();

  let muxDeliveries = 0; let muxAcceptances = 0; let senderStatuses = 0;
  const status = new Promise<void>(resolve => bob.socket.on('mux-delivery-status', (value) => {
    if (value.status === 'accepted' && value.roomId === r.roomId) { senderStatuses += 1; resolve(); }
  }));
  const received = new Promise<RecordResponse>(resolve => alice.socket.once('mux-envelope', (frame, accept) => {
    muxDeliveries += 1; accept({ outcome: 'accepted', roomId: frame.roomId, id: frame.id, claimId: frame.claimId,
      connectionGeneration: frame.connectionGeneration, subscriptionNonce: frame.subscriptionNonce });
    muxAcceptances += 1; resolve(frame);
  }));
  expect(await ack(bob.socket, 'mux-send-message', { version: 1, roomId: r.roomId, envelope,
    ...bob.proof('relay:message', { conversationId: r.roomId, routingAddress: r.routes[1], peerRoutingAddress: r.routes[0], connectionGeneration: bob.socket.id }) }))
    .toMatchObject({ status: 'stored' });
  expect(await received).toMatchObject({ roomId: r.roomId, envelope, senderRoutingAddress: r.routes[1] });
  await status;
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(muxDeliveries).toBe(1);
  expect(muxAcceptances).toBe(1);
  expect(senderStatuses).toBe(1);
  expect(legacyContender.server.muxSubscriptions).toBeUndefined();
});

it('arbitrates concurrent legacy join and Mux subscribe with exactly one room owner', async () => {
  process.env.NODE_ENV = 'development'; process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
  const r = await room(); const legacy = await peer(); const mux = await peer();
  expect(await authenticate(mux)).toMatchObject({ status: 'authenticated' });

  const [legacyResult, muxResult] = await Promise.all([legacyJoin(legacy, r, 0), subscribe(mux, r, 0)]);
  const legacyOwns = legacyResult.status === 'accepted';
  const muxOwns = muxResult.status === 'subscribed';
  expect(Number(legacyOwns) + Number(muxOwns)).toBe(1);
  expect(getClients().getSIDByIDs(r.routes[0], r.roomId)?.sid === legacy.socket.id).toBe(legacyOwns);
  expect(mux.server.muxSubscriptions?.has(r.roomId) === true).toBe(muxOwns);
});

it('replays a durably queued legacy message after the legacy room owner releases the room to Mux', async () => {
  process.env.NODE_ENV = 'development'; process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
  const r = await room(); const legacySender = await peer();
  expect(await legacyJoin(legacySender, r, 1)).toMatchObject({ status: 'accepted' });
  const queued = await ack(legacySender.socket, 'chat-message', { envelope,
    ...legacySender.proof('relay:message', { conversationId: r.roomId }), recipientRoutingId: r.routes[0] });
  expect(queued).toMatchObject({ stored: true });

  legacySender.socket.disconnect();
  await new Promise<void>(resolve => setImmediate(resolve));
  const muxRecipient = await peer();
  expect(await authenticate(muxRecipient)).toMatchObject({ status: 'authenticated' });
  const subscribed = await subscribe(muxRecipient, r, 0);
  expect(subscribed).toMatchObject({ status: 'subscribed' });

  const originalAckOffline = db.ackOfflineMessage;
  let resolveDurableAck!: (removed: boolean) => void;
  const durableAck = new Promise<boolean>(resolve => { resolveDurableAck = resolve; });
  const ackOffline = jest.spyOn(db, 'ackOfflineMessage').mockImplementation(async (...args) => {
    const removed = await originalAckOffline(...args);
    resolveDurableAck(removed);
    return removed;
  });
  let deliveries = 0; let recipientAcceptances = 0;
  const received = new Promise<RecordResponse>(resolve => muxRecipient.socket.once('mux-envelope', (frame, accept) => {
    deliveries += 1;
    accept({ outcome: 'accepted', roomId: frame.roomId, id: frame.id, claimId: frame.claimId,
      connectionGeneration: frame.connectionGeneration, subscriptionNonce: frame.subscriptionNonce });
    recipientAcceptances += 1; resolve(frame);
  }));
  expect(await ack(muxRecipient.socket, 'mux-mailbox-replay', { version: 1, roomId: r.roomId,
    connectionGeneration: muxRecipient.socket.id, subscriptionNonce: subscribed.subscriptionNonce })).toMatchObject({ status: 'accepted' });
  expect(await received).toMatchObject({ id: queued.id, roomId: r.roomId, senderRoutingAddress: r.routes[1], envelope });
  expect(await durableAck).toBe(true);
  expect(deliveries).toBe(1);
  expect(recipientAcceptances).toBe(1);
  expect(ackOffline).toHaveBeenCalledTimes(1);
  expect(ackOffline).toHaveBeenCalledWith(queued.id, r.routes[0], r.roomId, expect.any(String));
});
