import type { ProductSecureStorage } from './sessionStore';

const RECORD_TYPE = 'product-profile';
const RECORD_ID = 'local';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const normalizeName = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Display name is invalid.');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('Display name must be 1–40 characters.');
  const name = trimmed.replace(/\s+/g, ' ');
  return name;
};

export const readProfileName = async (storage: ProductSecureStorage): Promise<string | undefined> => {
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  if (!bytes) return undefined;
  const parsed: unknown = JSON.parse(decoder.decode(new Uint8Array(bytes)));
  return normalizeName(parsed);
};

export const writeProfileName = async (storage: ProductSecureStorage, value: string): Promise<string> => {
  const name = normalizeName(value);
  await storage.write(RECORD_TYPE, RECORD_ID, encoder.encode(JSON.stringify(name)).buffer as ArrayBuffer);
  return name;
};
