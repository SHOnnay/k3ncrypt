import type { ProductSecureStorage } from './sessionStore';

/** UX A9: a file's name and type, known to the sender at once and to the recipient after download. */
export interface FileDetails { name: string; mimeType?: string; }

const TYPE = 'product-file-details';
const MAX_ENTRIES = 500;
const MAX_NAME = 120;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const clean = (details: FileDetails): FileDetails => ({ name: details.name.slice(0, MAX_NAME), ...(details.mimeType ? { mimeType: details.mimeType.slice(0, 100) } : {}) });
const parse = (bytes: ArrayBuffer | undefined): Record<string, FileDetails> => {
  if (!bytes) return {};
  try {
    const value = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, FileDetails] => {
      const item = entry[1] as Partial<FileDetails> | null;
      return Boolean(item && typeof item.name === 'string' && (item.mimeType === undefined || typeof item.mimeType === 'string'));
    }));
  } catch { return {}; }
};

/** Details for one chat, keyed by transfer ID. Unreadable records read as empty; nothing about trust depends on them. */
export const readFileDetails = async (storage: ProductSecureStorage, roomId: string): Promise<Record<string, FileDetails>> =>
  parse(await storage.read(TYPE, roomId));

export const rememberFileDetails = async (storage: ProductSecureStorage, entry: { roomId: string; transferId: string; details: FileDetails }): Promise<void> => {
  const { roomId, transferId, details } = entry;
  const current = await readFileDetails(storage, roomId);
  delete current[transferId];
  current[transferId] = clean(details);
  const kept = Object.entries(current).slice(-MAX_ENTRIES);
  await storage.write(TYPE, roomId, encoder.encode(JSON.stringify(Object.fromEntries(kept))).buffer as ArrayBuffer);
};
