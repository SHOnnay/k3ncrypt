import { ContactIdentityRegistry } from '../identity/contactIdentityRegistry';
import { VodozemacCryptoSession } from '../core/vodozemacCryptoSession';
import { conversationCreationPolicy } from '../crypto/conversationPolicy';
if (!(globalThis as typeof globalThis & { window?: unknown }).window) Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'), atob: (value: string) => Buffer.from(value, 'base64').toString('binary') } });

describe('modern messaging security invariants', () => {
  it('pins first contact as unverified and never infers trust', async () => {
    const values = new Map<string, ArrayBuffer>();
    const storage = { read: async (type: string, id: string) => values.get(`${type}:${id}`), write: async (type: string, id: string, value: ArrayBuffer) => { values.set(`${type}:${id}`, value); } } as any;
    const registry = new ContactIdentityRegistry(storage);
    const event = await registry.observe('opaque-contact', { identityId: 'fingerprint', publicKey: new Uint8Array([1]), algorithm: 'test', verification: 'verified' });
    expect(event.current.verification).toBe('unverified');
  });

  it('keeps legacy creation policy as the default', () => {
    delete process.env.K3NCRYPT_CONVERSATION_POLICY;
    expect(conversationCreationPolicy()).toBe('legacy-default');
  });

  it('does not accept a legacy envelope through the modern session boundary', async () => {
    const handle = { sessionId: () => 's', encrypt: () => '', decrypt: () => new Uint8Array([1, 1]), saveSession: () => new Uint8Array() };
    const session = new VodozemacCryptoSession(handle);
    await session.initialize('s');
    await expect(session.decrypt('message', { version: 1, strategy: 'legacy', data: {} })).rejects.toThrow();
  });
});
