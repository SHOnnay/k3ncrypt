import { AdaptiveNodeRuntime, MemoryAdaptiveNodePersistence } from './nodes';
import { MemorySiteRoutePersistence, SiteToSiteBridgeRuntime } from './bridge';
import { DeviceContextAuthority } from '../devices/authenticatedContext';

const owner = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';
const na = '44444444-4444-4444-8444-444444444444';
const nb = '55555555-5555-4555-8555-855555555555';
const trust = (revoked = false) => ({ assertTrusted: async () => { if (revoked) throw new Error('revoked'); }, snapshot: async () => ({ list: { identityReference: 'account', epoch: 1, devices: [{ deviceId: owner, publicIdentityReference: 'owner', state: 'active' as const }, { deviceId: a, publicIdentityReference: a, state: 'active' as const }, { deviceId: b, publicIdentityReference: b, state: 'active' as const }] }, commitment: 'trusted' }) });
const context = () => new DeviceContextAuthority({ ready: true, encrypted: true, initialize: async () => undefined, destroy: () => undefined, encrypt: async () => ({ version: 1, strategy: 'test', data: {} }), decrypt: async () => new ArrayBuffer(0) }, 'bridge', { deviceId: owner, identityReference: 'owner', userScope: 'account', verified: true }).localContext();

describe('site-to-site bridge isolation', () => {
  it('allows only owner-authorized host/service routes and rejects CIDR expansion/replay', async () => {
    const nodes = new MemoryAdaptiveNodePersistence(); const runtime = new AdaptiveNodeRuntime(nodes, trust());
    for (const [network, device] of [[na, a], [nb, b]] as const) {
      const auth = await runtime.authorize(context(), network, { deviceId: device, identityReference: device }, 'register', 'permanent', { relay: true, bridge: true, storage: false });
      await runtime.apply(context(), auth); await runtime.heartbeat(network, device, device);
    }
    const states = { state: async (id: string) => id === na ? { epoch: 1, commitment: 'a', isOwner: (d: string, i: string) => d === owner && i === 'owner' } : id === nb ? { epoch: 1, commitment: 'b', isOwner: (d: string, i: string) => d === owner && i === 'owner' } : undefined };
    const bridge = new SiteToSiteBridgeRuntime(nodes, states, new MemorySiteRoutePersistence(), trust());
    const route = await bridge.authorize(context(), { sourceNetworkId: na, destinationNetworkId: nb, sourceBridgeDeviceId: a, destinationBridgeDeviceId: b, sourceCidr: '192.168.1.10/32', destinationCidr: '192.168.10.20/32', services: [{ protocol: 'tcp', port: 443 }] });
    await bridge.install(context(), route);
    expect(await bridge.allows(route.routeId, '192.168.1.10', '192.168.10.20', { protocol: 'tcp', port: 443 })).toBe(true);
    await expect(bridge.install(context(), route)).rejects.toThrow('replayed');
    await expect(bridge.authorize(context(), { sourceNetworkId: na, destinationNetworkId: nb, sourceBridgeDeviceId: a, destinationBridgeDeviceId: b, sourceCidr: '192.168.1.0/24', destinationCidr: '192.168.10.20/32', services: [{ protocol: 'tcp', port: 443 }] })).rejects.toThrow('rejected');
  });
  it('rejects revoked trust and offline bridge nodes', async () => {
    const bridge = new SiteToSiteBridgeRuntime(new MemoryAdaptiveNodePersistence(), { state: async () => undefined }, new MemorySiteRoutePersistence(), trust(true));
    await expect(bridge.allows('missing', '192.168.1.1', '192.168.10.1', { protocol: 'tcp', port: 1 })).rejects.toThrow('revoked');
  });
});
