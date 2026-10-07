import type { SecureRecordUpdate } from '../../../service/src/core/contracts';
import type { ProductSecureStorage } from './sessionStore';

export const PROFILE_PREFIX = 'k3ncrypt-profile:';
export const MAX_DISPLAY_NAME_BYTES = 160;
export interface ClaimedProfile { version: 1; displayName: string; identityFingerprint: string; revision: number; }
const encoder = new TextEncoder();
const TYPE = 'product-remote-profile';

export const normalizeDisplayName = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Display name is invalid.');
  const name = value.trim().normalize('NFC').replace(/\s+/g, ' ');
  if (!name || name.length > 40 || encoder.encode(name).length > MAX_DISPLAY_NAME_BYTES ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new Error('Display name must be 1–40 characters and at most 160 UTF-8 bytes.');
  return name;
};

const parse = (value: unknown): ClaimedProfile | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== 'displayName,identityFingerprint,revision,version' || item.version !== 1 ||
      typeof item.identityFingerprint !== 'string' || !/^K3 [A-Z0-9_ -]{20,128}$/.test(item.identityFingerprint) ||
      !Number.isSafeInteger(item.revision) || (item.revision as number) < 1) return undefined;
  try { return { version: 1, displayName: normalizeDisplayName(item.displayName), identityFingerprint: item.identityFingerprint, revision: item.revision as number }; }
  catch { return undefined; }
};

export const encodeProfileMessage = (profile: ClaimedProfile): string => {
  const valid = parse(profile);
  if (!valid) throw new Error('Profile metadata is invalid.');
  return PROFILE_PREFIX + JSON.stringify(valid);
};

export const decodeProfileMessage = (text: string): ClaimedProfile | undefined => {
  if (!text.startsWith(PROFILE_PREFIX) || encoder.encode(text).length > 1024) return undefined;
  try { return parse(JSON.parse(text.slice(PROFILE_PREFIX.length))); } catch { return undefined; }
};

export const readRemoteProfile = async (storage: ProductSecureStorage, roomId: string, fingerprint?: string): Promise<ClaimedProfile | undefined> => {
  const bytes = await storage.read(TYPE, roomId);
  if (!bytes || !fingerprint) return undefined;
  try {
    const profile = parse(JSON.parse(new TextDecoder().decode(bytes)));
    return profile?.identityFingerprint === fingerprint ? profile : undefined;
  } catch { return undefined; }
};

/** Called only for plaintext accepted by the existing pinned-peer encrypted session. */
export const prepareProfileAcceptance = async (storage: ProductSecureStorage, roomId: string, text: string, fingerprint?: string): Promise<SecureRecordUpdate[]> => {
  const profile = decodeProfileMessage(text);
  if (!profile || !fingerprint || profile.identityFingerprint !== fingerprint) return [];
  const expected = await storage.read(TYPE, roomId);
  const current = await readRemoteProfile(storage, roomId, fingerprint);
  if (current && current.revision >= profile.revision) return [];
  return [{ recordType: TYPE, recordId: roomId, expected, next: encoder.encode(JSON.stringify(profile)).buffer as ArrayBuffer }];
};
