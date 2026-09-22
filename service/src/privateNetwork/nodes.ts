import { sha256 } from 'hash-wasm';
import type { NetworkTrustBoundary } from './contracts';

export type NodeRole = 'client' | 'active' | 'permanent';
export type NodeCapabilities = { relay: boolean; bridge: boolean; storage: false };
export type NodeStatus = 'online' | 'offline' | 'stale';
export type AdaptiveNode = { version: 1; networkId: string; deviceId: string; identityReference: string; role: NodeRole; capabilities: NodeCapabilities; status: NodeStatus; lastSeenAt: number; expiresAt: number };
export type NodeAuthorization = { version: 1; authorizationId: string; networkId: string; issuerDeviceId: string; issuerIdentityReference: string; targetDeviceId: string; targetIdentityReference: string; operation: 'register' | 'update-capabilities' | 'remove'; role?: NodeRole; capabilities?: NodeCapabilities; expiresAt: number; digest: string };
export type SiteRouteAuthorization = { version: 1; networkId: string; bridgeDeviceId: string; cidrs: readonly string[]; expiresAt: number };
export interface AdaptiveNodePersistence { read(networkId: string): Promise<readonly AdaptiveNode[]>; write(networkId: string, nodes: readonly AdaptiveNode[]): Promise<void>; claim(networkId: string, key: string, expiresAt: number): Promise<boolean>; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cidr = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)\d{1,3}\.\d{1,3}\/([8-9]|1\d|2\d|3[0-2])$/;
const validCaps = (value: unknown): value is NodeCapabilities => !!value && typeof value === 'object' && typeof (value as NodeCapabilities).relay === 'boolean' && typeof (value as NodeCapabilities).bridge === 'boolean' && (value as NodeCapabilities).storage === false;
const nodeDigest = async (value: Omit<NodeAuthorization, 'digest'>): Promise<string> => sha256(JSON.stringify(value));

/** Existing trusted devices authorize optional routing helpers; node roles do not create identities or trust. */
export class AdaptiveNodeRuntime {
  constructor(private readonly persistence: AdaptiveNodePersistence, private readonly trust: NetworkTrustBoundary, private readonly now: () => number = Date.now) {}
  async authorize(networkId: string, issuer: { deviceId: string; identityReference: string }, target: { deviceId: string; identityReference: string }, operation: NodeAuthorization['operation'], role?: NodeRole, capabilities?: NodeCapabilities, ttlMs = 5 * 60_000): Promise<NodeAuthorization> {
    await this.trust.assertTrusted(); const snapshot = await this.trust.snapshot();
    if (!uuid.test(networkId) || !uuid.test(issuer.deviceId) || !uuid.test(target.deviceId) || !snapshot.list.devices.some((device) => device.deviceId === issuer.deviceId && device.publicIdentityReference === issuer.identityReference && device.state === 'active') || (operation !== 'remove' && (!role || !validCaps(capabilities)))) throw new Error('Node authorization rejected.');
    const unsigned = { version: 1 as const, authorizationId: crypto.randomUUID(), networkId, issuerDeviceId: issuer.deviceId, issuerIdentityReference: issuer.identityReference, targetDeviceId: target.deviceId, targetIdentityReference: target.identityReference, operation, role, capabilities, expiresAt: this.now() + ttlMs };
    return { ...unsigned, digest: await nodeDigest(unsigned) };
  }
  async apply(authorization: NodeAuthorization): Promise<readonly AdaptiveNode[]> {
    const { digest, ...unsigned } = authorization; await this.trust.assertTrusted(); const snapshot = await this.trust.snapshot();
    if (authorization.expiresAt <= this.now() || digest !== await nodeDigest(unsigned) || !snapshot.list.devices.some((device) => device.deviceId === authorization.issuerDeviceId && device.publicIdentityReference === authorization.issuerIdentityReference && device.state === 'active') || !await this.persistence.claim(authorization.networkId, authorization.authorizationId, authorization.expiresAt)) throw new Error('Node authorization rejected.');
    const nodes = [...await this.persistence.read(authorization.networkId)]; const index = nodes.findIndex((node) => node.deviceId === authorization.targetDeviceId);
    if (authorization.operation === 'remove') { if (index < 0) throw new Error('Unknown node.'); nodes.splice(index, 1); }
    else if (authorization.operation === 'register') { if (index >= 0 || !authorization.role || !validCaps(authorization.capabilities)) throw new Error('Node registration rejected.'); nodes.push({ version: 1, networkId: authorization.networkId, deviceId: authorization.targetDeviceId, identityReference: authorization.targetIdentityReference, role: authorization.role, capabilities: authorization.capabilities, status: 'offline', lastSeenAt: 0, expiresAt: authorization.expiresAt }); }
    else { if (index < 0 || !validCaps(authorization.capabilities)) throw new Error('Node capability update rejected.'); nodes[index] = { ...nodes[index], capabilities: authorization.capabilities }; }
    await this.persistence.write(authorization.networkId, nodes); return nodes;
  }
  async heartbeat(networkId: string, deviceId: string, identityReference: string, ttlMs = 90_000): Promise<void> { await this.trust.assertTrusted(); const snapshot = await this.trust.snapshot(); if (!snapshot.list.devices.some((device) => device.deviceId === deviceId && device.publicIdentityReference === identityReference && device.state === 'active')) throw new Error('Node trust rejected.'); const nodes = [...await this.persistence.read(networkId)]; const index = nodes.findIndex((node) => node.deviceId === deviceId && node.identityReference === identityReference); if (index < 0) throw new Error('Unknown node.'); nodes[index] = { ...nodes[index], status: 'online', lastSeenAt: this.now(), expiresAt: this.now() + ttlMs }; await this.persistence.write(networkId, nodes); }
  async available(networkId: string): Promise<readonly AdaptiveNode[]> { await this.trust.assertTrusted(); const now = this.now(); return (await this.persistence.read(networkId)).map((node) => node.expiresAt <= now ? { ...node, status: 'stale' as const } : node).filter((node) => node.status === 'online'); }
  async authorizeRoute(route: SiteRouteAuthorization): Promise<void> { await this.trust.assertTrusted(); if (!uuid.test(route.networkId) || !uuid.test(route.bridgeDeviceId) || route.expiresAt <= this.now() || route.cidrs.length === 0 || route.cidrs.some((value) => !cidr.test(value))) throw new Error('Site route authorization rejected.'); const node = (await this.persistence.read(route.networkId)).find((entry) => entry.deviceId === route.bridgeDeviceId && entry.role === 'permanent' && entry.capabilities.bridge); if (!node) throw new Error('Site route authorization rejected.'); }
}

export const chooseAdaptiveRoute = (directAvailable: boolean, nodes: readonly AdaptiveNode[]): 'direct' | 'active-node' | 'server-relay' => directAvailable ? 'direct' : nodes.some((node) => node.status === 'online' && node.capabilities.relay) ? 'active-node' : 'server-relay';
export class MemoryAdaptiveNodePersistence implements AdaptiveNodePersistence { private readonly nodes = new Map<string, AdaptiveNode[]>(); private readonly claims = new Set<string>(); async read(networkId: string): Promise<readonly AdaptiveNode[]> { return structuredClone(this.nodes.get(networkId) ?? []); } async write(networkId: string, nodes: readonly AdaptiveNode[]): Promise<void> { this.nodes.set(networkId, structuredClone([...nodes])); } async claim(networkId: string, key: string, expiresAt: number): Promise<boolean> { const id = `${networkId}:${key}`; if (expiresAt <= Date.now() || this.claims.has(id)) return false; this.claims.add(id); return true; } }
