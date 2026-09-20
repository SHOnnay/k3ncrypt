import type { EncryptedEnvelope, CryptoSession, TransportManager } from '../core/contracts';
import { AuthenticatedDeviceControlChannel } from './runtime';

const envelope: EncryptedEnvelope = { version: 1, strategy: 'test', data: {} };

describe('authenticated device control channel', () => {
  it('requires an encrypted ready session and preserves opaque transport', async () => {
    const sent: EncryptedEnvelope[] = [];
    const session: CryptoSession = {
      encrypted: true, ready: true, initialize: async () => undefined,
      encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
      decrypt: async (_channel, value) => new TextEncoder().encode((value.data as string)).buffer as ArrayBuffer,
      destroy: () => undefined,
    };
    const transport = { sendEnvelope: async (_channel: 'message' | 'signaling', value: EncryptedEnvelope) => { sent.push(value); return {}; } } as unknown as TransportManager;
    const channel = new AuthenticatedDeviceControlChannel(session, transport);
    await channel.send({ type: 'enrollment-rejection', payload: { version: 1, transactionNonce: 'nonce' } });
    expect(sent).toHaveLength(1);
    await expect(channel.receive(envelope)).resolves.toBeUndefined();
  });

  it('fails closed when the session is not authenticated', async () => {
    const session: CryptoSession = { encrypted: false, ready: false, initialize: async () => undefined, encrypt: async () => envelope, decrypt: async () => new ArrayBuffer(0), destroy: () => undefined };
    const transport = { sendEnvelope: async () => ({}) } as unknown as TransportManager;
    const channel = new AuthenticatedDeviceControlChannel(session, transport);
    await expect(channel.send({ type: 'revocation', payload: {} })).rejects.toThrow('unavailable');
  });
});
