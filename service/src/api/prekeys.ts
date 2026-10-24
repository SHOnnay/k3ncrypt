import { toBase64Url } from '../crypto/base64url';
import type { DeviceProofCarrier } from '../devices/trustProtocol';
import type { VodozemacPublicIdentity } from '../identity/vodozemacIdentity';
import makeRequest from './client';
import type { VodozemacPublicBundle, VodozemacPublicKeyMaterial } from '../identity/vodozemacBundle';

const CONTROL_CAPABILITY_HEADER = 'X-K3ncrypt-Control-Capability';
const RENEWAL_PROOF_HEADER = 'X-K3ncrypt-Prekey-Renewal';

export const publishVodozemacBundle = async (channelId: string, controlCapability: string, bundle: VodozemacPublicBundle): Promise<{ address: string; renewalProof: string }> =>
  makeRequest<{ address: string; renewalProof: string }, VodozemacPublicBundle>(`chat-link/${encodeURIComponent(channelId)}/prekeys`, {
    method: 'POST', body: bundle, headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability },
  });

export const fetchVodozemacBundle = async (channelId: string, controlCapability: string, address: string): Promise<VodozemacPublicBundle> =>
  makeRequest<VodozemacPublicBundle>(`chat-link/${encodeURIComponent(channelId)}/prekeys/${encodeURIComponent(address)}`, {
    method: 'GET', headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability },
  });

export const claimVodozemacOneTimeKey = async (channelId: string, controlCapability: string, address: string, keyId: string): Promise<VodozemacPublicKeyMaterial> =>
  makeRequest<VodozemacPublicKeyMaterial, { keyId: string }>(`chat-link/${encodeURIComponent(channelId)}/prekeys/${encodeURIComponent(address)}/claim`, {
    method: 'POST', body: { keyId }, headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability },
  });

export const renewVodozemacBundle = async (channelId: string, controlCapability: string, address: string, renewalProof: string, bundle: VodozemacPublicBundle): Promise<void> => {
  await makeRequest<{ status: string }, VodozemacPublicBundle>(`chat-link/${encodeURIComponent(channelId)}/prekeys/${encodeURIComponent(address)}/renew`, {
    method: 'POST', body: bundle, headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability, [RENEWAL_PROOF_HEADER]: renewalProof },
  });
};

export type RoutingRequestAuthority = { participant: string; routingProof: string; carrier: DeviceProofCarrier };
const routingHeaders = (capability: string, authority: RoutingRequestAuthority): Record<string, string> => ({
    [CONTROL_CAPABILITY_HEADER]: capability,
    'X-K3ncrypt-Participant': authority.participant,
    'X-K3ncrypt-Routing-Proof': authority.routingProof,
    'X-K3ncrypt-Device-Proof': toBase64Url(new TextEncoder().encode(JSON.stringify(authority.carrier.deviceAuthorizationProof))),
    'X-K3ncrypt-Device-Nonce': authority.carrier.proofNonce,
});

/** Identity only: never substitutes an expired bootstrap key or grants trust. */
export const fetchAuthenticatedRoutingIdentity = async (room: string, capability: string, peer: string, authority: RoutingRequestAuthority): Promise<VodozemacPublicIdentity> => {
    const value = await makeRequest<{ version: number; identity: VodozemacPublicIdentity }>(`chat-link/${encodeURIComponent(room)}/routing/${encodeURIComponent(peer)}/identity`, {
        method: 'GET', headers: routingHeaders(capability, authority),
    });
    if (value.version !== 1) throw new Error('Authenticated routing identity unavailable.');
    return value.identity;
};
export const replenishAuthenticatedPrekeys = async (room: string, capability: string, address: string, authority: RoutingRequestAuthority, bundle: VodozemacPublicBundle): Promise<void> => {
    await makeRequest(`chat-link/${encodeURIComponent(room)}/routing/${encodeURIComponent(address)}/prekeys`, {
        method: 'POST', headers: routingHeaders(capability, authority), body: bundle,
    });
};
