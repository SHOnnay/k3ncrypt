import type { ProductSecureStorage } from './sessionStore';
import type { UnreadCounts } from './alerts';

/** Unread badges survive reload and restart. Kept only in the encrypted vault, like every other private record. */
const TYPE = 'product-unread';
const ID = 'all';
const MAX_CHATS = 1000;
const MAX_COUNT = 999;
const roomPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const sanitizeUnread = (value: unknown): UnreadCounts => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const counts: Record<string, number> = {};
  for (const [roomId, count] of Object.entries(value as Record<string, unknown>).slice(0, MAX_CHATS)) {
    if (roomPattern.test(roomId) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0) counts[roomId] = Math.min(MAX_COUNT, count);
  }
  return counts;
};

export const readUnread = async (storage: ProductSecureStorage): Promise<UnreadCounts> => {
  try {
    const bytes = await storage.read(TYPE, ID);
    return bytes ? sanitizeUnread(JSON.parse(decoder.decode(new Uint8Array(bytes)))) : {};
  } catch { return {}; }
};

export const writeUnread = async (storage: ProductSecureStorage, counts: UnreadCounts): Promise<void> => {
  await storage.write(TYPE, ID, encoder.encode(JSON.stringify(sanitizeUnread(counts))).buffer as ArrayBuffer);
};

/** Counts for chats that no longer exist (removed contacts) are dropped. */
export const keepKnownRooms = (counts: UnreadCounts, roomIds: readonly string[]): UnreadCounts => {
  const known = new Set(roomIds);
  const kept = Object.fromEntries(Object.entries(counts).filter(([roomId]) => known.has(roomId)));
  return Object.keys(kept).length === Object.keys(counts).length ? counts : kept;
};
