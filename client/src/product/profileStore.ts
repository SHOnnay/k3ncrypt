import type { ProductSecureStorage } from './sessionStore';
import { normalizeDisplayName } from './profileMetadata';
const TYPE = 'product-profile';
const ID = 'local';
export const readLocalProfile = async (storage: ProductSecureStorage): Promise<{ displayName: string; revision: number } | undefined> => {
  const bytes = await storage.read(TYPE, ID);
  if (!bytes) return undefined;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed === 'string') return { displayName: normalizeDisplayName(parsed), revision: 1 };
  if (!parsed || typeof parsed !== 'object' || !('displayName' in parsed) || !('revision' in parsed) || !Number.isSafeInteger(parsed.revision)) throw new Error('Saved profile is invalid.');
  return { displayName: normalizeDisplayName(parsed.displayName), revision: parsed.revision as number };
};
export const readProfileName = async (storage: ProductSecureStorage): Promise<string | undefined> => (await readLocalProfile(storage))?.displayName;
export const writeProfileName = async (storage: ProductSecureStorage, value: string): Promise<string> => {
  const displayName = normalizeDisplayName(value);
  const previous = await readLocalProfile(storage);
  const revision = Math.max(Date.now(), (previous?.revision ?? 0) + 1);
  await storage.write(TYPE, ID, new TextEncoder().encode(JSON.stringify({ displayName, revision })).buffer as ArrayBuffer);
  return displayName;
};
