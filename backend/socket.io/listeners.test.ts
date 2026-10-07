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
