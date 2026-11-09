import type { ProductSecureStorage } from './sessionStore';

/** N1: per-chat mute, kept in the encrypted vault like other private records (never plain localStorage). */
const TYPE = 'product-muted-chats';
const ID = 'all';
const MAX_CHATS = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const parse = (bytes: ArrayBuffer | undefined): string[] | undefined => {
  if (!bytes) return undefined;
  try {
    const value = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_CHATS) : [];
  } catch { return []; }
};

/** `legacy` is the old plain-localStorage list; it seeds the encrypted record once and is then ignored. */
export const readMutedChats = async (storage: ProductSecureStorage, legacy: readonly string[] = []): Promise<string[]> => {
  const stored = parse(await storage.read(TYPE, ID));
  return stored ?? Array.from(new Set(legacy)).slice(0, MAX_CHATS);
};

export const setChatMuted = async (storage: ProductSecureStorage, roomId: string, muted: boolean, legacy: readonly string[] = []): Promise<string[]> => {
  const current = await readMutedChats(storage, legacy);
  const next = muted ? Array.from(new Set([...current, roomId])).slice(-MAX_CHATS) : current.filter((id) => id !== roomId);
  await storage.write(TYPE, ID, encoder.encode(JSON.stringify(next)).buffer as ArrayBuffer);
  return next;
};
