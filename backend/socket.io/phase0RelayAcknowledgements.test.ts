import { randomUUID } from 'crypto';
import connectionListener from './listeners';
import getClientInstance from './clients';
import * as durableTrust from '../security/durableDeviceTrust';
import db from '../db';
import type { CustomSocket } from './index';

describe('Phase 0 relay acknowledgement characterization', () => {
  const channel = randomUUID();
  const sender = randomUUID();
  const recipient = randomUUID();
  const deviceId = randomUUID();
  const accountIdentityReference = 'phase0-account';
  const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'opaque' } };
  const proof = { deviceId, accountIdentityReference, nonce: 'phase0-nonce', resource: { conversationId: channel } };
  const payload = { envelope, recipientRoutingId: recipient, deviceAuthorizationProof: proof, proofNonce: proof.nonce, proofOperation: 'relay:message' };
  const makeSocket = (userID: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      id: randomUUID(), userID, channelID: channel, deviceId, accountIdentityReference, deviceTrustEpoch: 1,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }),
      emit: jest.fn(), disconnect: jest.fn(),
    } as unknown as CustomSocket;
    return { socket, handlers };
  };

  test('absent recipient produces mailbox-stored ACK, not a peer-persisted receipt', async () => {
    const client = makeSocket(sender);
    const stored = { id: randomUUID(), timestamp: Date.now() };
    const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
    const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
    const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
    const storeSpy = jest.spyOn(db, 'storeOfflineMessage').mockResolvedValue(stored as never);
    const countSpy = jest.spyOn(db, 'countOfflineMessages').mockResolvedValue(1);
    const cleanupSpy = jest.spyOn(db, 'cleanupExpiredOfflineMessages').mockImplementation(() => undefined);
    getClientInstance().setClientToChannel(sender, channel, client.socket.id);
    try {
      connectionListener(client.socket, { sockets: { sockets: new Map() } });
      const ack = jest.fn();
      await client.handlers.get('chat-message')?.(payload, ack);
      expect(storeSpy).toHaveBeenCalledTimes(1);
      expect(ack).toHaveBeenCalledWith({ id: stored.id, timestamp: stored.timestamp, stored: true });
      expect(client.socket.emit).not.toHaveBeenCalledWith('delivered', expect.anything());
    } finally {
      getClientInstance().deleteClient(sender, channel, client.socket.id);
      dbSpy.mockRestore(); authoritySpy.mockRestore(); storeSpy.mockRestore(); countSpy.mockRestore(); cleanupSpy.mockRestore();
    }
  });

  test('live callback accepted yields submission ACK without mailbox-stored flag', async () => {
    const origin = makeSocket(sender);
    const destination = makeSocket(recipient);
    (destination.socket.emit as jest.Mock).mockImplementation((_event: string, _message: unknown, callback: (result: unknown) => void) => callback({ accepted: true }));
    const database = { collection: () => ({ findOne: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) }) };
    const dbSpy = jest.spyOn(db, 'getDatabase').mockReturnValue(database as never);
    const authoritySpy = jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async () => ({ deviceId, accountIdentityReference, trustEpoch: 1, state: 'active' }) } as never);
    const storeSpy = jest.spyOn(db, 'storeOfflineMessage');
    getClientInstance().setClientToChannel(sender, channel, origin.socket.id);
    getClientInstance().setClientToChannel(recipient, channel, destination.socket.id);
    try {
      connectionListener(origin.socket, { sockets: { sockets: new Map([[destination.socket.id, destination.socket]]) } });
      const ack = jest.fn();
      await origin.handlers.get('chat-message')?.(payload, ack);
      expect(destination.socket.emit).toHaveBeenCalledTimes(1);
      expect(storeSpy).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith({ id: expect.any(String), timestamp: expect.any(Number) });
    } finally {
      getClientInstance().deleteClient(sender, channel, origin.socket.id);
      getClientInstance().deleteClient(recipient, channel, destination.socket.id);
      dbSpy.mockRestore(); authoritySpy.mockRestore(); storeSpy.mockRestore();
    }
  });
});
