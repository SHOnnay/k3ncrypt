import { createHash, randomBytes, randomUUID } from 'crypto';
import { authorizeRoutingAddress, isValidWireEnvelope, parseProtocolFeatures } from './listeners';
import connectionListener from './listeners';
import getClientInstance from './clients';
import * as durableTrust from '../security/durableDeviceTrust';
import type { CustomSocket } from './index';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';
import { hashControlCapability } from '../security/controlCapability';
import { muxWouldExceedChannelCapacity, testOnlyResetMuxDeviceRegistry } from './multiplexed';

describe('relay wire-envelope schema', () => {
  it('accepts bounded opaque versioned envelopes', () => {
    expect(isValidWireEnvelope({ version: 1, strategy: 'aes-256-gcm-hkdf-v1', data: { ciphertext: 'opaque' } })).toBe(true);
    expect(isValidWireEnvelope({ version: 2, strategy: 'vodozemac-olm-v1', data: { olmMessage: 'opaque' } })).toBe(true);
  });

  it.each([
    null,
    {},
    { version: 0, strategy: 'x', data: {} },
    { version: 1.5, strategy: 'x', data: {} },
    { version: 1, strategy: '<script>', data: {} },
    { version: 1, strategy: 'x', data: null },
    { version: 1, strategy: 'x', data: {}, critical: true },
  ])('rejects malformed and unknown-critical-field input', (value) => {
    expect(isValidWireEnvelope(value)).toBe(false);
  });
});

describe('optional join protocol feature negotiation', () => {
  it('accepts old clients that omit feature metadata and only whitelisted new features', () => {
    expect(parseProtocolFeatures(undefined)).toEqual([]);
    expect(parseProtocolFeatures(['join-introduction-v1'])).toEqual(['join-introduction-v1']);
    expect(parseProtocolFeatures(['room-message-v1'])).toEqual(['room-message-v1']);
    expect(parseProtocolFeatures(['join-introduction-v1', 'room-message-v1'])).toEqual(['join-introduction-v1', 'room-message-v1']);
  });

  it.each([
    'join-introduction-v1',
    ['unknown-feature'],
    ['join-introduction-v1', 'join-introduction-v1'],
    ['join-introduction-v1', 1],
  ])('rejects malformed or unsupported feature declarations', (value) => {
    expect(parseProtocolFeatures(value)).toBeUndefined();
  });
});

it('requires the address-specific proof before a modern routing identity can join', async () => {
  const channel = randomUUID(); const address = randomUUID(); const proof = randomBytes(32).toString('base64url');
  const renewalProofHash = createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest('hex');
  await db.insertInDb({ channel, address, renewalProofHash, expiresAt: new Date(Date.now() + 60_000) }, PREKEY_COLLECTION);
  await expect(authorizeRoutingAddress(channel, address, randomBytes(32).toString('base64url'))).resolves.toBe(false);
  await expect(authorizeRoutingAddress(channel, address, proof)).resolves.toBe(true);
});

it('does not acknowledge a call signal as delivered when the registered recipient socket is absent', async () => {
  const channel = randomUUID(); const sender = randomUUID(); const recipient = randomUUID();
  const deviceId = randomUUID(); const accountIdentityReference = 'account-test';
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = { id: randomUUID(), userID: sender, channelID: channel, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
  getClientInstance().setClientToChannel(sender, channel, socket.id);
  getClientInstance().setClientToChannel(recipient, channel, 'absent-socket');
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const proof = { deviceId, accountIdentityReference, nonce: 'nonce', resource: { conversationId: channel } };
    const ack = jest.fn();
    await handlers.get('webrtc-signal')?.({ envelope: { version: 1, strategy: 'opaque', data: {} }, deviceAuthorizationProof: proof, proofNonce: 'nonce', proofOperation: 'relay:signal' }, ack);
    expect(ack).toHaveBeenCalledWith({ error: 'Receiver is unavailable.' });
  } finally {
    getClientInstance().deleteClient(sender, channel, socket.id);
    getClientInstance().deleteClient(recipient, channel, 'absent-socket');
    dbSpy.mockRestore(); authoritySpy.mockRestore();
  }
});

it('rejects an encrypted message when its device proof names a different room than the joined socket', async () => {
  const roomA = randomUUID(); const roomB = randomUUID(); const sender = randomUUID();
  const deviceId = randomUUID(); const accountIdentityReference = 'account-test';
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = { id: randomUUID(), userID: sender, channelID: roomB, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const proof = { version: 1, proofId: randomUUID(), deviceId, accountIdentityReference, deviceIdentityReference: 'identity-test',
      operation: 'relay:message', trustEpoch: 1, nonce: 'nonce', resource: { conversationId: roomA },
      issuedAt: Date.now(), expiresAt: Date.now() + 30_000, signature: 'signature' };
    const ack = jest.fn();
    await handlers.get('chat-message')?.({ envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'opaque' } },
      recipientRoutingId: randomUUID(), deviceAuthorizationProof: proof, proofNonce: 'nonce', proofOperation: 'relay:message' }, ack);
    expect(ack).toHaveBeenCalledWith({ error: 'Device authorization rejected.' });
    expect(socket.emit).not.toHaveBeenCalledWith('chat-message', expect.anything(), expect.anything());
  } finally { dbSpy.mockRestore(); authoritySpy.mockRestore(); }
});

it('rejects mailbox replay on an existing socket after durable revocation', async () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = { id: randomUUID(), userID: randomUUID(), channelID: randomUUID(), deviceId: randomUUID(), accountIdentityReference: 'account-test', deviceTrustEpoch: 1,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: () => ({ findOne: async () => ({ trustEpoch: 2, state: 'revoked' }) }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const deleteSpy = jest.spyOn(db, 'ackOfflineMessage');
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const ack = jest.fn();
    await handlers.get('mailbox-replay')?.({}, ack);
    expect(ack).toHaveBeenCalledWith({ error: 'Mailbox replay rejected.' });
    await handlers.get('received')?.({ id: randomUUID() });
    expect(deleteSpy).not.toHaveBeenCalled();
  } finally { dbSpy.mockRestore(); deleteSpy.mockRestore(); }
});

it('terminally rejects a claimed poison entry and continues replay to later accepted events', async () => {
  const channel = randomUUID(); const recipient = randomUUID(); const deviceId = randomUUID();
  const accountIdentityReference = 'mailbox-test-account';
  const poison = { id: randomUUID(), claimId: randomUUID(), sender: randomUUID(), timestamp: 1, envelope: { version: 2, strategy: 'opaque', data: { ciphertext: 'e1' } } };
  const valid = { id: randomUUID(), claimId: randomUUID(), sender: randomUUID(), timestamp: 2, envelope: { version: 2, strategy: 'opaque', data: { ciphertext: 'e2' } } };
  const rows = [poison, valid]; const delivered: string[] = []; const claimsById = new Map<string, string>(); const handlers = new Map<string, (...args: any[]) => unknown>();
  const socket = { id: randomUUID(), userID: recipient, channelID: channel, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    on: jest.fn((event: string, handler: (...args: any[]) => unknown) => { handlers.set(event, handler); }),
    emit: jest.fn((event: string, payload: { id: string; claimId: string; roomId?: string }, ack?: (response: unknown) => void) => {
      if (event !== 'chat-message') return;
      delivered.push(payload.id);
      if (payload.id === poison.id) {
        const rejection = { id: payload.id, roomId: channel, claimId: payload.claimId, reasonClass: 'authenticated-invalid' };
        void Promise.resolve(handlers.get('recipient-rejected')?.(rejection, () => undefined)).then(() =>
          ack?.({ accepted: false, outcome: 'permanent-rejection', reasonClass: 'authenticated-invalid' }));
      } else ack?.({ accepted: true, outcome: 'accepted' });
    }), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const claimSpy = jest.spyOn(db, 'claimOfflineMessage').mockImplementation(async (_mailbox, _channel, _lease, claimId) => {
    const next = rows.shift(); if (next) claimsById.set(next.id, claimId); return next ? { ...next, claimId } as never : undefined;
  });
  const rejectSpy = jest.spyOn(db, 'rejectOfflineMessage').mockResolvedValueOnce('rejected').mockResolvedValueOnce('duplicate');
  const ackSpy = jest.spyOn(db, 'ackOfflineMessage').mockResolvedValue(true);
  const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const replayAck = jest.fn();
    await handlers.get('mailbox-replay')?.({}, replayAck);
    expect(replayAck).toHaveBeenCalledWith({ status: 'accepted' });
    expect(delivered).toEqual([poison.id, valid.id]);
    expect(rejectSpy).toHaveBeenNthCalledWith(1, poison.id, recipient, channel, expect.any(String), 'authenticated-invalid');
    expect(ackSpy).toHaveBeenCalledWith(valid.id, recipient, channel, claimsById.get(valid.id));
    expect(claimSpy).toHaveBeenCalledTimes(3);
  } finally { dbSpy.mockRestore(); claimSpy.mockRestore(); rejectSpy.mockRestore(); ackSpy.mockRestore(); authoritySpy.mockRestore(); }
});

it('requires the joined recipient room and a live claim generation before terminal rejection', async () => {
  const channel = randomUUID(); const otherRoom = randomUUID(); const recipient = randomUUID(); const deviceId = randomUUID();
  const accountIdentityReference = 'mailbox-test-account'; const handlers = new Map<string, (...args: any[]) => unknown>();
  const socket = { id: randomUUID(), userID: recipient, channelID: channel, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    on: jest.fn((event: string, handler: (...args: any[]) => unknown) => { handlers.set(event, handler); }), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const rejectSpy = jest.spyOn(db, 'rejectOfflineMessage').mockResolvedValue('stale');
  const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const ack = jest.fn();
    await handlers.get('recipient-rejected')?.({ id: randomUUID(), roomId: otherRoom, claimId: randomUUID(), reasonClass: 'authenticated-invalid' }, ack);
    expect(rejectSpy).not.toHaveBeenCalled();
    await handlers.get('recipient-rejected')?.({ id: randomUUID(), roomId: channel, claimId: randomUUID(), reasonClass: 'authenticated-invalid' }, ack);
    expect(rejectSpy).toHaveBeenCalledWith(expect.any(String), recipient, channel, expect.any(String), 'authenticated-invalid');
    expect(socket.emit).not.toHaveBeenCalledWith('not-accepted', expect.anything());
    expect(ack).toHaveBeenLastCalledWith({ error: 'Terminal mailbox result rejected.' });
  } finally { dbSpy.mockRestore(); rejectSpy.mockRestore(); authoritySpy.mockRestore(); }
});

it('authenticates one device socket and independently authorizes two room subscriptions', async () => {
  testOnlyResetMuxDeviceRegistry();
  const roomA = randomUUID(); const roomB = randomUUID(); const deviceId = randomUUID(); const accountIdentityReference = 'mux-stage1-account';
  const routeA = randomUUID(); const peerA = randomUUID(); const routeB = randomUUID(); const peerB = randomUUID();
  const capA = randomBytes(32).toString('base64url'); const capB = randomBytes(32).toString('base64url');
  const routeProofs = new Map([[`${roomA}:${routeA}`, randomBytes(32).toString('base64url')], [`${roomA}:${peerA}`, randomBytes(32).toString('base64url')], [`${roomB}:${routeB}`, randomBytes(32).toString('base64url')], [`${roomB}:${peerB}`, randomBytes(32).toString('base64url')]]);
  const roomCaps = new Map([[roomA, capA], [roomB, capB]]);
  const clients = getClientInstance();
  const legacyRoute = randomUUID();
  let currentDevice = { state: 'active', trustEpoch: 4 };
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const socket = { id: randomUUID(), deviceId: undefined as string | undefined, accountIdentityReference: undefined as string | undefined,
    deviceTrustEpoch: undefined as number | undefined, muxConnectionGeneration: undefined as string | undefined, muxSubscriptions: new Map(),
    on: jest.fn((event: string, handler: (...args: any[]) => unknown) => { handlers.set(event, handler); }), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const database = { collection: (name: string) => ({ findOne: async () => name === 'device_lifecycle' ? { deviceId, accountIdentityReference, ...currentDevice } : undefined }) };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
  const lookupSpy = jest.spyOn(db, 'findOneFromDB').mockImplementation(async (query: any, collection: string) => {
    if (collection === 'links') {
      const cap = roomCaps.get(query.hash);
      return cap ? { hash: query.hash, deleted: false, expired: false, controlCapabilityHash: hashControlCapability(cap) } as never : undefined;
    }
    if (collection === PREKEY_COLLECTION) {
      const renewalProof = routeProofs.get(`${query.channel}:${query.address}`);
      return renewalProof ? { channel: query.channel, address: query.address, renewalProofHash: createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${renewalProof}`).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } as never : undefined;
    }
    return undefined;
  });
  const consumed = new Set<string>();
  const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue(({ verify: async (proof: any, operation: string, resource: unknown) => {
    if (consumed.has(proof.proofId) || proof.operation !== operation || JSON.stringify(proof.resource ?? {}) !== JSON.stringify(resource ?? {})) throw new Error('proof rejected');
    consumed.add(proof.proofId);
    return { deviceId, accountIdentityReference, deviceIdentityReference: 'mux-identity', trustEpoch: 4, state: 'active', verificationKeyReference: 'test-key', createdAt: new Date(), lastTrustUpdate: new Date() };
  } } as never));
  const proof = (operation: string, resource: object, nonce: string) => ({ version: 1, proofId: randomUUID(), accountIdentityReference, deviceId,
    deviceIdentityReference: 'mux-identity', operation, trustEpoch: 4, nonce, resource, issuedAt: Date.now(), expiresAt: Date.now() + 300_000, signature: 'sig' });
  const invoke = (event: string, payload: unknown): Promise<any> => new Promise(resolve => { void handlers.get(event)?.(payload, resolve); });
  try {
    connectionListener(socket, { sockets: { sockets: new Map() } });
    const generation = socket.id;
    const authNonce = randomUUID();
    await expect(invoke('mux-authenticate', { connectionGeneration: generation, deviceAuthorizationProof: proof('relay:connect', { connectionGeneration: generation }, authNonce), proofNonce: authNonce, proofOperation: 'relay:connect' })).resolves.toMatchObject({ status: 'authenticated', connectionGeneration: generation });

    const subscribe = async (roomId: string, routingAddress: string, peerRoutingAddress: string, controlCapability: string, routingProof: string, nonce = randomUUID(), proofRoom = roomId) => {
      const resource = { conversationId: proofRoom, routingAddress, peerRoutingAddress, connectionGeneration: generation };
      return invoke('mux-subscribe', { version: 1, roomId, routingAddress, peerRoutingAddress, controlCapability, routingProof, connectionGeneration: generation,
        protocolFeatures: ['room-message-v1'], deviceAuthorizationProof: proof('relay:subscribe', resource, nonce), proofNonce: nonce, proofOperation: 'relay:subscribe' });
    };
    await expect(subscribe(roomA, routeA, peerA, capA, routeProofs.get(`${roomA}:${routeA}`)!)).resolves.toMatchObject({ status: 'subscribed', roomId: roomA, connectionGeneration: generation });
    await expect(subscribe(roomB, routeB, peerB, capB, routeProofs.get(`${roomB}:${routeB}`)!)).resolves.toMatchObject({ status: 'subscribed', roomId: roomB, connectionGeneration: generation });
    expect(socket.muxSubscriptions?.size).toBe(2);
    expect(clients.getSIDByIDs(routeA, roomA)).toBeFalsy();

    const priorMuxGate = process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY;
    process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true';
    const storeOfflineSpy = jest.spyOn(db, 'storeOfflineMessage').mockImplementation(async (message) => message as never);
    const countOfflineSpy = jest.spyOn(db, 'countOfflineMessages').mockResolvedValue(1);
    const cleanupOfflineSpy = jest.spyOn(db, 'cleanupExpiredOfflineMessages').mockReturnValue(0);
    const muxEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'ciphertext' } };
    const sendNonce = randomUUID();
    const sendResource = { conversationId: roomA, routingAddress: routeA, peerRoutingAddress: peerA, connectionGeneration: generation };
    await expect(invoke('mux-send-message', { version: 1, roomId: roomA, envelope: muxEnvelope,
      deviceAuthorizationProof: proof('relay:message', sendResource, sendNonce), proofNonce: sendNonce, proofOperation: 'relay:message' }))
      .resolves.toMatchObject({ version: 1, status: 'stored' });
    expect(storeOfflineSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: roomA, mailbox: peerA, sender: routeA, envelope: muxEnvelope }));
    const wrongRoomNonce = randomUUID();
    await expect(invoke('mux-send-message', { version: 1, roomId: roomA, envelope: muxEnvelope,
      deviceAuthorizationProof: proof('relay:message', { conversationId: roomB, routingAddress: routeB, peerRoutingAddress: peerB, connectionGeneration: generation }, wrongRoomNonce),
      proofNonce: wrongRoomNonce, proofOperation: 'relay:message' })).resolves.toEqual({ error: 'Multiplexed message rejected.' });
    expect(storeOfflineSpy).toHaveBeenCalledTimes(1);
    storeOfflineSpy.mockRestore(); countOfflineSpy.mockRestore(); cleanupOfflineSpy.mockRestore();
    if (priorMuxGate === undefined) delete process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY;
    else process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = priorMuxGate;

    clients.setClientToChannel(legacyRoute, roomA, 'legacy-test-socket');
    expect(muxWouldExceedChannelCapacity(randomUUID(), roomA, 2)).toBe(true);
    expect(muxWouldExceedChannelCapacity(routeA, roomA, 2)).toBe(false);

    await expect(subscribe(roomA, routeA, routeA, capA, routeProofs.get(`${roomA}:${routeA}`)!)).resolves.toEqual({ error: 'Room subscription rejected.' });
    await expect(subscribe(roomA, routeA, peerA, capA, routeProofs.get(`${roomA}:${routeA}`)!, randomUUID(), roomB)).resolves.toEqual({ error: 'Room subscription rejected.' });
    await expect(subscribe(randomUUID(), randomUUID(), randomUUID(), randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url'))).resolves.toEqual({ error: 'Room subscription rejected.' });
    const replayNonce = randomUUID(); const replayProof = proof('relay:subscribe', { conversationId: roomA, routingAddress: routeA, peerRoutingAddress: peerA, connectionGeneration: generation }, replayNonce);
    const replayPayload = { version: 1, roomId: roomA, routingAddress: routeA, peerRoutingAddress: peerA, controlCapability: capA, routingProof: routeProofs.get(`${roomA}:${routeA}`), connectionGeneration: generation, protocolFeatures: [], deviceAuthorizationProof: replayProof, proofNonce: replayNonce, proofOperation: 'relay:subscribe' };
    await expect(invoke('mux-subscribe', replayPayload)).resolves.toMatchObject({ status: 'subscribed' });
    await expect(invoke('mux-subscribe', replayPayload)).resolves.toEqual({ error: 'Room subscription rejected.' });
    await expect(invoke('mux-unsubscribe', { roomId: roomA, connectionGeneration: 'stale-generation', subscriptionNonce: replayNonce })).resolves.toEqual({ error: 'Room unsubscribe rejected.' });
    const raceNonce = randomUUID();
    const raceUnsubscribe = invoke('mux-unsubscribe', { roomId: roomA, connectionGeneration: generation, subscriptionNonce: replayNonce });
    const raceSubscribe = subscribe(roomA, routeA, peerA, capA, routeProofs.get(`${roomA}:${routeA}`)!, raceNonce);
    await expect(Promise.all([raceUnsubscribe, raceSubscribe])).resolves.toEqual([
      { status: 'unsubscribed', roomId: roomA, connectionGeneration: generation },
      expect.objectContaining({ status: 'subscribed', roomId: roomA }),
    ]);
    expect(socket.muxSubscriptions?.get(roomA)?.nonce).toBe(raceNonce);
    currentDevice = { state: 'revoked', trustEpoch: 5 };
    await expect(invoke('mux-unsubscribe', { roomId: roomB, connectionGeneration: generation, subscriptionNonce: socket.muxSubscriptions?.get(roomB)?.nonce })).resolves.toEqual({ error: 'Room unsubscribe rejected.' });
  } finally {
    handlers.get('disconnect')?.();
    clients.deleteClient(legacyRoute, roomA, 'legacy-test-socket');
    testOnlyResetMuxDeviceRegistry();
    lookupSpy.mockRestore(); dbSpy.mockRestore(); authoritySpy.mockRestore();
  }
});
