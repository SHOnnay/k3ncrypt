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
