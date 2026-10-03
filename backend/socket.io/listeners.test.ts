import { createHash, randomBytes, randomUUID } from 'crypto';
import { authorizeRoutingAddress, isValidWireEnvelope, parseProtocolFeatures } from './listeners';
import connectionListener from './listeners';
import getClientInstance from './clients';
import * as durableTrust from '../security/durableDeviceTrust';
import type { CustomSocket } from './index';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';

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

it.each(['offline', 'accepted', 'declined'])('Stage 0 relay %s preserves exact acknowledgement evidence', async (mode) => {
  const channel = randomUUID(), sender = randomUUID(), recipient = randomUUID(), deviceId = randomUUID();
  const accountIdentityReference = 'stage0-synthetic-account';
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const socket = { id: randomUUID(), userID: sender, channelID: channel, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    on: jest.fn((event, handler) => handlers.set(event, handler)), emit: jest.fn(), disconnect: jest.fn() } as unknown as CustomSocket;
  const record = { deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' };
  const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue({ collection: () => ({ findOne: async () => record }) } as never);
  const authority = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => record } as never);
  const stored = jest.spyOn(db, 'storeOfflineMessage');
  const receiver = { id: randomUUID(), deviceId, accountIdentityReference, deviceTrustEpoch: 1,
    emit: jest.fn((_event, _payload, ack) => ack({ accepted: mode === 'accepted' })) };
  const clients = getClientInstance();
  clients.setClientToChannel(sender, channel, socket.id);
  if (mode !== 'offline') clients.setClientToChannel(recipient, channel, receiver.id);
  try {
    connectionListener(socket, { sockets: { sockets: new Map([[receiver.id, receiver]]) } });
    const proof = { deviceId, accountIdentityReference, nonce: 'synthetic-nonce', resource: { conversationId: channel } };
    const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'synthetic-opaque-frame' } };
    const ack = jest.fn();
    await handlers.get('chat-message')!({ envelope, recipientRoutingId: recipient, deviceAuthorizationProof: proof, proofNonce: proof.nonce, proofOperation: 'relay:message' }, ack);
    const result = ack.mock.calls[0][0];
    expect(Object.keys(result).sort()).toEqual(mode === 'accepted' ? ['id', 'timestamp'] : ['id', 'stored', 'timestamp']);
    expect(result.id).toEqual(expect.any(String)); expect(result.timestamp).toEqual(expect.any(Number));
    expect(result.peerPersisted).toBeUndefined();
    if (mode === 'accepted') expect(stored).not.toHaveBeenCalled();
    else {
      expect(result.stored).toBe(true);
      expect(stored).toHaveBeenCalledWith(expect.objectContaining({ envelope, mailbox: recipient, sender }));
    }
  } finally {
    clients.deleteClient(sender, channel, socket.id); clients.deleteClient(recipient, channel, receiver.id);
    stored.mockRestore(); authority.mockRestore(); dbSpy.mockRestore();
  }
});
