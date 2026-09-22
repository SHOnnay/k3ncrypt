import { sha256 } from 'hash-wasm';
import type { PrivateNetworkAuthorization, PrivateNetworkMember, PrivateNetworkPersistence, PrivateNetworkState, NetworkTrustBoundary } from './contracts';

const canonical = (value: unknown): string => JSON.stringify(value);
const digest = async (value: unknown): Promise<string> => sha256(canonical(value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const member = (value: PrivateNetworkMember): boolean => !!value && UUID.test(value.deviceId) && typeof value.identityReference === 'string' && value.identityReference.length > 0 && ['owner', 'member', 'bridge'].includes(value.role) && ['active', 'removed'].includes(value.state);
export const privateNetworkCommitment = async (state: Omit<PrivateNetworkState, 'commitment'>): Promise<string> => digest({ ...state, members: [...state.members].sort((a, b) => a.deviceId.localeCompare(b.deviceId)) });
export const privateNetworkAuthorizationDigest = async (authorization: Omit<PrivateNetworkAuthorization, 'digest'>): Promise<string> => digest(authorization);

/** Membership authority is existing trusted-device authority, not a new network identity system. */
export class PrivateNetworkRuntime {
  constructor(private readonly persistence: PrivateNetworkPersistence, private readonly trust: NetworkTrustBoundary, private readonly now: () => number = Date.now) {}
  async create(networkId: string, accountScope: string, owner: Omit<PrivateNetworkMember, 'role' | 'state'>): Promise<PrivateNetworkState> {
    await this.trust.assertTrusted(); if (!UUID.test(networkId) || !accountScope || !UUID.test(owner.deviceId) || !owner.identityReference) throw new Error('Invalid private network creation.');
    const existing = await this.persistence.read(networkId); if (existing) throw new Error('Private network already exists.');
    const base = { version: 1 as const, networkId, accountScope, epoch: 0, members: [{ ...owner, role: 'owner' as const, state: 'active' as const }] };
    const state: PrivateNetworkState = { ...base, commitment: await privateNetworkCommitment(base) };
    if (!await this.persistence.compareAndSwap(networkId, undefined, state)) throw new Error('Private network creation conflict.'); return state;
  }
  async authorize(networkId: string, target: Omit<PrivateNetworkMember, 'state'>, operation: 'join' | 'remove', ttlMs = 5 * 60_000): Promise<PrivateNetworkAuthorization> {
    await this.trust.assertTrusted(); const state = await this.required(networkId); const trust = await this.trust.snapshot();
    const issuer = trust.list.devices.find((item) => item.deviceId && item.state === 'active' && state.members.some((m) => m.deviceId === item.deviceId && m.role === 'owner' && m.state === 'active'));
    if (!issuer || !UUID.test(target.deviceId) || !target.identityReference || (operation === 'join' && !target.role)) throw new Error('Private network authorization rejected.');
    const unsigned = { version: 1 as const, authorizationId: crypto.randomUUID(), networkId, accountScope: state.accountScope, issuerDeviceId: issuer.deviceId, issuerIdentityReference: issuer.publicIdentityReference, targetDeviceId: target.deviceId, targetIdentityReference: target.identityReference, operation, role: operation === 'join' ? target.role : undefined, previousEpoch: state.epoch, previousCommitment: state.commitment, expiresAt: this.now() + ttlMs };
    return { ...unsigned, digest: await privateNetworkAuthorizationDigest(unsigned) };
  }
  async apply(authorization: PrivateNetworkAuthorization): Promise<PrivateNetworkState> {
    const { digest: claimedDigest, ...unsigned } = authorization;
    await this.trust.assertTrusted(); if (!UUID.test(authorization.networkId) || authorization.expiresAt <= this.now() || claimedDigest !== await privateNetworkAuthorizationDigest(unsigned)) throw new Error('Private network authorization rejected.');
    const current = await this.required(authorization.networkId); const trusted = await this.trust.snapshot();
    const issuer = trusted.list.devices.find((item) => item.deviceId === authorization.issuerDeviceId && item.publicIdentityReference === authorization.issuerIdentityReference && item.state === 'active');
    const owner = current.members.find((item) => item.deviceId === authorization.issuerDeviceId && item.identityReference === authorization.issuerIdentityReference && item.role === 'owner' && item.state === 'active');
    if (!issuer || !owner || current.accountScope !== authorization.accountScope || current.epoch !== authorization.previousEpoch || current.commitment !== authorization.previousCommitment || !await this.persistence.claim(current.networkId, authorization.authorizationId, authorization.expiresAt)) throw new Error('Private network authorization rejected.');
    const target = current.members.find((item) => item.deviceId === authorization.targetDeviceId && item.identityReference === authorization.targetIdentityReference && item.state === 'active');
    if (authorization.operation === 'remove' && !target) throw new Error('Private network member rejected.');
    const members = current.members.map((item) => item.deviceId === authorization.targetDeviceId ? { ...item, state: 'removed' as const } : item);
    if (authorization.operation === 'join') {
      if (!authorization.role || members.some((item) => item.deviceId === authorization.targetDeviceId)) throw new Error('Private network member rejected.');
      members.push({ deviceId: authorization.targetDeviceId, identityReference: authorization.targetIdentityReference, role: authorization.role, state: 'active' });
    }
    const base = { version: 1 as const, networkId: current.networkId, accountScope: current.accountScope, epoch: current.epoch + 1, previousCommitment: current.commitment, members };
    if (members.some((item) => !member(item))) throw new Error('Private network state rejected.');
    const next: PrivateNetworkState = { ...base, commitment: await privateNetworkCommitment(base) };
    if (!await this.persistence.compareAndSwap(current.networkId, current, next)) throw new Error('Private network update conflict.'); return next;
  }
  async members(networkId: string): Promise<readonly PrivateNetworkMember[]> { await this.trust.assertTrusted(); return (await this.required(networkId)).members.filter((item) => item.state === 'active'); }
  private async required(networkId: string): Promise<PrivateNetworkState> { const state = await this.persistence.read(networkId); if (!state || state.networkId !== networkId || state.commitment !== await privateNetworkCommitment({ version: state.version, networkId: state.networkId, accountScope: state.accountScope, epoch: state.epoch, previousCommitment: state.previousCommitment, members: state.members })) throw new Error('Private network state unavailable.'); return state; }
}

export class MemoryPrivateNetworkPersistence implements PrivateNetworkPersistence {
  private readonly states = new Map<string, PrivateNetworkState>(); private readonly claims = new Map<string, number>();
  async read(networkId: string): Promise<PrivateNetworkState | undefined> { const value = this.states.get(networkId); return value && structuredClone(value); }
  async compareAndSwap(networkId: string, expected: PrivateNetworkState | undefined, next: PrivateNetworkState): Promise<boolean> { if (canonical(this.states.get(networkId)) !== canonical(expected)) return false; this.states.set(networkId, structuredClone(next)); return true; }
  async claim(networkId: string, key: string, expiresAt: number): Promise<boolean> { const id = `${networkId}:${key}`; if (expiresAt <= Date.now() || this.claims.has(id)) return false; this.claims.set(id, expiresAt); return true; }
}
