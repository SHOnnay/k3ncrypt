/**
 * Invitation-fragment URL handling utilities.
 *
 * Invitations carry a room id, message secret, and independent room-control
 * capability in the URL fragment. Browsers do not send fragments to servers.
 * Browsers never send the URL fragment as part of an HTTP request, so the
 * secret parsed/written here never reaches the server.
 */

export interface ParsedInvite {
  roomId: string;
  secret: string;
  controlCapability: string;
}

const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_256 = /^[A-Za-z0-9_-]{43}$/;
export interface SignedModernInvitation {
  version: 2;
  type: 'k3ncrypt-first-contact-invitation';
  invitationId: string;
  roomId: string;
  controlCapability: string;
  inviterAddress: string;
  identityCommitment: string;
  capabilities: readonly ['join-introduction-v1', 'room-message-v1'];
  createdAt: number;
  expiresAt: number;
  signature: string;
}
export type ParsedModernInvite =
  | { version: 1; roomId: string; controlCapability: string; address: string; identityCommitment: string }
  | { version: 2; invitation: SignedModernInvitation; roomId: string; controlCapability: string; address: string; identityCommitment: string };

export function parseModernInviteInput(input: string): ParsedModernInvite | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  const fragment = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : trimmed;
  const params = new URLSearchParams(fragment);
  if (Array.from(params.keys()).length === 1 && params.has('invite')) {
    const encoded = params.get('invite');
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
      const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)), character => character.charCodeAt(0));
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const item = value as Record<string, unknown>;
      const keysExpected = ['capabilities', 'createdAt', 'controlCapability', 'expiresAt', 'identityCommitment', 'invitationId', 'inviterAddress', 'roomId', 'signature', 'type', 'version'];
      if (Object.keys(item).sort().join(',') !== keysExpected.sort().join(',') || item.version !== 2 || item.type !== 'k3ncrypt-first-contact-invitation' ||
          typeof item.invitationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.invitationId) ||
          typeof item.roomId !== 'string' || !ROOM_ID.test(item.roomId) || typeof item.controlCapability !== 'string' || !SECRET_256.test(item.controlCapability) ||
          typeof item.inviterAddress !== 'string' || !ROOM_ID.test(item.inviterAddress) || typeof item.identityCommitment !== 'string' || !/^K3 [A-Z0-9_ -]{20,128}$/.test(item.identityCommitment) ||
          !Array.isArray(item.capabilities) || item.capabilities.length !== 2 || item.capabilities[0] !== 'join-introduction-v1' || item.capabilities[1] !== 'room-message-v1' ||
          !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.expiresAt) || typeof item.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(item.signature)) return null;
      const invitation = item as unknown as SignedModernInvitation;
      return { version: 2, invitation, roomId: invitation.roomId, controlCapability: invitation.controlCapability, address: invitation.inviterAddress, identityCommitment: invitation.identityCommitment };
    } catch { return null; }
  }
  const keys = Array.from(params.keys());
  if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some((key) => !['modern', 'control', 'address', 'identity'].includes(key))) return null;
  const roomId = params.get('modern');
  const controlCapability = params.get('control');
  const address = params.get('address');
  const identityCommitment = params.get('identity');
  return roomId && controlCapability && address && identityCommitment && ROOM_ID.test(roomId) && SECRET_256.test(controlCapability) && ROOM_ID.test(address) && /^K3 [A-Z0-9_ -]{20,128}$/.test(identityCommitment)
    ? { version: 1, roomId, controlCapability, address, identityCommitment } : null;
}

export const encodeSignedModernInvitation = (invitation: SignedModernInvitation): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(invitation));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `invite=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
};

/** Parse `#room=...&secret=...&control=...` from the current URL, if present. */
export function getUrlInvite(): ParsedInvite | null {
  return parseInviteFragment(window.location.hash);
}

/** Parse a raw fragment string into a room id, message secret, and control capability. */
export function parseInviteFragment(fragment: string): ParsedInvite | null {
  if (!fragment || fragment.length > 2048) {
    return null;
  }
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(raw);
  const keys = Array.from(params.keys());
  if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some((key) => !['room', 'secret', 'control'].includes(key))) {
    return null;
  }
  const roomId = params.get('room');
  const secret = params.get('secret');
  const controlCapability = params.get('control');
  if (!roomId || !secret || !controlCapability || !ROOM_ID.test(roomId) ||
      !SECRET_256.test(secret) || !SECRET_256.test(controlCapability)) {
    return null;
  }
  return { roomId, secret, controlCapability };
}

/**
 * Parse a full invite string, which may be:
 *  - a full URL with a `#room=...&secret=...&control=...` fragment,
 *  - or the same fragment with or without the leading `#`.
 */
export function parseInviteInput(input: string): ParsedInvite | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 4096) {
    return null;
  }
  const hashIndex = trimmed.indexOf('#');
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex) : trimmed;
  return parseInviteFragment(fragment);
}

/** Update the URL with the invitation fragment, without a page reload. */
export function updateUrlInvite(roomId: string, secret: string, controlCapability: string): void {
  if (!roomId || !secret || !controlCapability) {
    return;
  }
  window.location.hash = `room=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(secret)}&control=${encodeURIComponent(controlCapability)}`;
}

/** Whether the current URL contains a parseable invite fragment. */
export function hasValidInvite(): boolean {
  return getUrlInvite() !== null;
}
