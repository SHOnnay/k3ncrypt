import makeRequest from './client';
import type { VodozemacPublicBundle, VodozemacPublicKeyMaterial } from '../identity/vodozemacBundle';

const CONTROL_CAPABILITY_HEADER = 'X-K3ncrypt-Control-Capability';

export const publishVodozemacBundle = async (channelId: string, controlCapability: string, bundle: VodozemacPublicBundle): Promise<{ address: string }> =>
  makeRequest<{ address: string }, VodozemacPublicBundle>(`chat-link/${encodeURIComponent(channelId)}/prekeys`, {
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
