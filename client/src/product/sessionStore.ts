import { readRemoteProfile } from './profileMetadata';

export interface ProductSecureStorage {
  read(recordType: string, recordId: string): Promise<ArrayBuffer | undefined>;
  write(recordType: string, recordId: string, value: ArrayBuffer): Promise<void>;
}

export interface ConversationDescriptor {
  version: 1;
  /** Lifecycle hint; protected relationship records remain the authority. */
  relationship?: 'invitation' | 'accepted';
  roomId: string;
  controlCapability: string;
  remoteAddress?: string;
  /** Fingerprint carried by the out-of-band modern invitation. */
  remoteIdentityCommitment?: string;
  label: string;
  /** Projection only: read from an encrypted, identity-bound profile record. */
  remoteDisplayName?: string;
  localNickname?: string;
  updatedAt: number;
}

const RECORD_TYPE = 'product-session';
const RECORD_ID = 'conversations';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roomPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateConversationDescriptor = (value: unknown): ConversationDescriptor => {
  if (!value || typeof value !== 'object') throw new Error('Saved conversation is invalid.');
  const item = value as Record<string, unknown>;
  if ((item.relationship !== undefined && !['invitation', 'accepted'].includes(String(item.relationship))) || item.version !== 1 || typeof item.roomId !== 'string' || !roomPattern.test(item.roomId)
    || typeof item.controlCapability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(item.controlCapability)
    || (item.remoteAddress !== undefined && (typeof item.remoteAddress !== 'string' || item.remoteAddress.length < 8))
    || (item.remoteIdentityCommitment !== undefined && (typeof item.remoteIdentityCommitment !== 'string' || !/^K3 [A-Z0-9_ -]{20,128}$/.test(item.remoteIdentityCommitment)))
    || (item.localNickname !== undefined && (typeof item.localNickname !== 'string' || !item.localNickname.trim() || item.localNickname.length > 80 || /[\u0000-\u001f\u007f]/.test(item.localNickname)))
    || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80
    || typeof item.updatedAt !== 'number' || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0) {
    throw new Error('Saved conversation is invalid.');
  }
  return Object.freeze({
    version: 1,
    ...(item.relationship === 'invitation' || item.relationship === 'accepted' ? { relationship: item.relationship } : {}),
    roomId: item.roomId,
    controlCapability: item.controlCapability,
    ...(item.remoteAddress ? { remoteAddress: item.remoteAddress as string } : {}),
    ...(item.remoteIdentityCommitment ? { remoteIdentityCommitment: item.remoteIdentityCommitment as string } : {}),
    label: item.label.trim(),
    ...(typeof item.localNickname === 'string' && item.localNickname.trim() && item.localNickname.length <= 80 && !/[\u0000-\u001f\u007f]/.test(item.localNickname) ? { localNickname: item.localNickname.trim() } : {}),
    updatedAt: item.updatedAt,
  });
};

export const readConversationDescriptors = async (storage: ProductSecureStorage): Promise<ConversationDescriptor[]> => {
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  if (!bytes) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(new Uint8Array(bytes))); } catch { return []; }
  if (!Array.isArray(parsed) || parsed.length > 100) return [];
  const descriptors: ConversationDescriptor[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    try { const item = validateConversationDescriptor(value); if (!seen.has(item.roomId)) { descriptors.push(item); seen.add(item.roomId); } } catch { /* Preserve unavailable entry in the encrypted source index. */ }
  }
  return Promise.all(descriptors.sort((left, right) => right.updatedAt - left.updatedAt).map(async (item) => {
    let pinned = item.remoteIdentityCommitment;
    if (item.remoteAddress) {
      const bytes = await storage.read('contact-identity', item.remoteAddress);
      try {
        const contact: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : undefined;
        if (!contact || typeof contact !== 'object' || !('identityId' in contact) || contact.identityId !== pinned || !('changeStatus' in contact) || contact.changeStatus !== 'unchanged') pinned = undefined;
      } catch { pinned = undefined; }
    }
    return { ...item, remoteDisplayName: (await readRemoteProfile(storage, item.roomId, pinned))?.displayName };
  }));
};

export const saveConversationDescriptor = async (storage: ProductSecureStorage, descriptor: ConversationDescriptor): Promise<ConversationDescriptor[]> => {
  const valid = validateConversationDescriptor(descriptor);
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  const raw: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : [];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Saved conversation list is invalid.');
  const retained = raw.filter(value => { try { return validateConversationDescriptor(value).roomId !== valid.roomId; } catch { return true; } });
  const next = [valid, ...retained];
  if (next.length > 100) throw new Error('Saved conversation list is full.');
  await storage.write(RECORD_TYPE, RECORD_ID, encoder.encode(JSON.stringify(next)).buffer as ArrayBuffer);
  return readConversationDescriptors(storage);
};

export const removeConversationDescriptor = async (storage: ProductSecureStorage, roomId: string): Promise<ConversationDescriptor[]> => {
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  const raw: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : [];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Saved conversation list is invalid.');
  const next = raw.filter(value => { try { return validateConversationDescriptor(value).roomId !== roomId; } catch { return true; } });
  await storage.write(RECORD_TYPE, RECORD_ID, encoder.encode(JSON.stringify(next)).buffer as ArrayBuffer);
  return readConversationDescriptors(storage);
};
