import { AuthenticatedPrivateNetworkTransport } from './transport';
import { MemoryPrivateNetworkPersistence, PrivateNetworkRuntime } from './runtime';
import { DeviceContextAuthority } from '../devices/authenticatedContext';

const ownerId = '11111111-1111-4111-8111-111111111111'; const memberId = '22222222-2222-4222-8222-222222222222'; const networkId = '33333333-3333-4333-8333-333333333333';
const trust = (revoked = false) => ({ assertTrusted: async () => { if (revoked) throw new Error('revoked'); }, snapshot: async () => ({ list: { identityReference: 'account', epoch: 1, devices: [{ deviceId: ownerId, publicIdentityReference: 'owner-identity', state: 'active' as const }] }, commitment: 'trusted' }) });
const context = () => new DeviceContextAuthority({ ready: true, encrypted: true, initialize: async () => undefined, destroy: () => undefined, encrypt: async () => ({ version: 1, strategy: 'test', data: {} }), decrypt: async () => new ArrayBuffer(0) }, 'private-network', { deviceId: ownerId, identityReference: 'owner-identity', userScope: 'account', verified: true }).localContext();

describe('private network trust and transport boundaries', () => {
  it('rejects fake, replayed, and revoked membership operations', async () => {
    const persistence = new MemoryPrivateNetworkPersistence(); const runtime = new PrivateNetworkRuntime(persistence, trust());
    await runtime.create(networkId, 'account', { deviceId: ownerId, identityReference: 'owner-identity' });
    const join = await runtime.authorize(context(), networkId, { deviceId: memberId, identityReference: 'member-identity', role: 'member' }, 'join');
    await expect(runtime.apply(context(), { ...join, digest: 'tampered' })).rejects.toThrow('authorization rejected');
    await runtime.apply(context(), join); await expect(runtime.apply(context(), join)).rejects.toThrow('authorization rejected');
    const revoked = new PrivateNetworkRuntime(persistence, trust(true)); await expect(revoked.members(networkId)).rejects.toThrow('revoked');
  });

  it('accepts only encrypted peer packets once and rejects sender substitution', async () => {
    let inbound: ((sender: string, envelope: any) => Promise<void>) | undefined; const relay = { send: jest.fn(async (_target, envelope) => { await inbound?.(memberId, envelope); }), onEnvelope: jest.fn((listener) => { inbound = listener; return () => undefined; }) };
    const crypto = { ready: true, encrypted: true, initialize: async () => undefined, destroy: () => undefined, encrypt: async (_c: string, bytes: ArrayBuffer) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(bytes) }), decrypt: async (_c: string, envelope: any) => new TextEncoder().encode(envelope.data).buffer };
    const receiver = new AuthenticatedPrivateNetworkTransport({ networkId, localDeviceId: ownerId, localIdentityReference: 'owner-identity', peerDeviceId: memberId, peerIdentityReference: 'member-identity', sessionId: 'session', cryptoSession: crypto }, relay, async () => undefined);
    const transport = new AuthenticatedPrivateNetworkTransport({ networkId, localDeviceId: memberId, localIdentityReference: 'member-identity', peerDeviceId: ownerId, peerIdentityReference: 'owner-identity', sessionId: 'session', cryptoSession: crypto }, relay, async () => undefined);
    const received: unknown[] = []; receiver.onPacket(async (packet) => { received.push(packet.payload); }); await transport.send({ route: 'lan' });
    expect(received).toEqual([{ route: 'lan' }]);
    const envelope = (relay.send as jest.Mock).mock.calls[0][1]; await expect(inbound!(memberId, envelope)).rejects.toThrow('replayed'); await expect(inbound!('fake-device', envelope)).rejects.toThrow('peer rejected');
  });
});
