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
export interface ParsedModernInvite { roomId: string; controlCapability: string; address: string; }

export function parseModernInviteInput(input: string): ParsedModernInvite | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  const fragment = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : trimmed;
  const params = new URLSearchParams(fragment);
  const keys = Array.from(params.keys());
  if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some((key) => !['modern', 'control', 'address'].includes(key))) return null;
  const roomId = params.get('modern');
  const controlCapability = params.get('control');
  const address = params.get('address');
  return roomId && controlCapability && address && ROOM_ID.test(roomId) && SECRET_256.test(controlCapability) && ROOM_ID.test(address)
    ? { roomId, controlCapability, address } : null;
}

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
