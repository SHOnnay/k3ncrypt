import makeRequest from './client';
import { generateInviteSecret } from '../crypto/inviteCrypto';
import type { LinkObjType } from '../public/types';

type ServerLinkResponse = { hash: string, expired: boolean, deleted: boolean };
const CONTROL_CAPABILITY_HEADER = 'X-K3ncrypt-Control-Capability';

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Builds a fragment containing independent message and control secrets. Fragments
 * are never sent by the browser as part of an HTTP request, so this is the
 * only place the secret is combined with the room id — and it happens
 * entirely on this device.
 */
const buildInviteLink = (roomId: string, secret: string, controlCapability: string): { link: string, absoluteLink: string | undefined } => {
  const fragment = `#room=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(secret)}&control=${encodeURIComponent(controlCapability)}`;
  const hasWindow = typeof window !== 'undefined' && !!window.location;
  const path = hasWindow ? `${window.location.pathname}${fragment}` : fragment;
  const absoluteLink = hasWindow ? `${window.location.origin}${path}` : undefined;
  return { link: path, absoluteLink };
};

/**
 * Create a new chat room and generate a fresh client-side invitation secret.
 * The secret is 256 bits of local randomness and is never sent to the
 * server — only the server-issued room id is exchanged over the network.
 */
export const getLink = async (): Promise<LinkObjType> => {
  const controlCapability = generateInviteSecret();
  const controlCapabilityHash = await sha256Hex(controlCapability);
  const { hash, expired, deleted } = await makeRequest<ServerLinkResponse>('chat-link', {
    method: 'POST',
    body: { controlCapabilityHash },
  });
  const secret = generateInviteSecret();
  const { link, absoluteLink } = buildInviteLink(hash, secret, controlCapability);
  return { hash, secret, controlCapability, link, absoluteLink, expired, deleted };
};

/** Delete a chat link/channel. */
export const deleteLink = async ({ channelID, controlCapability }: { channelID?: string, controlCapability?: string }): Promise<unknown> => {
  return makeRequest<unknown>(`/chat-link/${channelID}`, {
    method: 'DELETE',
    headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability ?? '' },
  });
};

export const getLinkStatus = async ({ channelID, controlCapability }: { channelID: string, controlCapability: string }): Promise<{ status: string, state: string }> =>
  makeRequest<{ status: string, state: string }>(`chat-link/status/${encodeURIComponent(channelID)}`, {
    method: 'GET',
    headers: { [CONTROL_CAPABILITY_HEADER]: controlCapability },
  });
