export interface ProductSecureStorage {
  read(recordType: string, recordId: string): Promise<ArrayBuffer | undefined>;
  write(recordType: string, recordId: string, value: ArrayBuffer): Promise<void>;
}

export interface ConversationDescriptor {
  version: 1;
  roomId: string;
  controlCapability: string;
  remoteAddress?: string;
  /** Fingerprint carried by the out-of-band modern invitation. */
  remoteIdentityCommitment?: string;
  label: string;
  updatedAt: number;
}

const RECORD_TYPE = 'product-session';
const RECORD_ID = 'conversations';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roomPattern = /^[0-9a-f-]{36}$/i;

const validate = (value: unknown): ConversationDescriptor => {
  if (!value || typeof value !== 'object') throw new Error('Saved conversation is invalid.');
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.roomId !== 'string' || !roomPattern.test(item.roomId)
    || typeof item.controlCapability !== 'string' || item.controlCapability.length < 16
    || (item.remoteAddress !== undefined && (typeof item.remoteAddress !== 'string' || item.remoteAddress.length < 8))
    || (item.remoteIdentityCommitment !== undefined && (typeof item.remoteIdentityCommitment !== 'string' || !/^K3 [A-Z0-9_ -]{20,128}$/.test(item.remoteIdentityCommitment)))
    || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80
    || typeof item.updatedAt !== 'number' || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0) {
    throw new Error('Saved conversation is invalid.');
  }
  return Object.freeze({
    version: 1,
    roomId: item.roomId,
    controlCapability: item.controlCapability,
    ...(item.remoteAddress ? { remoteAddress: item.remoteAddress as string } : {}),
    ...(item.remoteIdentityCommitment ? { remoteIdentityCommitment: item.remoteIdentityCommitment as string } : {}),
    label: item.label.trim(),
    updatedAt: item.updatedAt,
  });
};

export const readConversationDescriptors = async (storage: ProductSecureStorage): Promise<ConversationDescriptor[]> => {
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  if (!bytes) return [];
  const parsed = JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown;
  if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Saved conversation list is invalid.');
  const descriptors = parsed.map(validate);
  if (new Set(descriptors.map((item) => item.roomId)).size !== descriptors.length) throw new Error('Saved conversation list contains duplicates.');
  return descriptors.sort((left, right) => right.updatedAt - left.updatedAt);
};

export const saveConversationDescriptor = async (storage: ProductSecureStorage, descriptor: ConversationDescriptor): Promise<ConversationDescriptor[]> => {
  const valid = validate(descriptor);
  const existing = await readConversationDescriptors(storage);
  const next = [valid, ...existing.filter((item) => item.roomId !== valid.roomId)].sort((left, right) => right.updatedAt - left.updatedAt);
  await storage.write(RECORD_TYPE, RECORD_ID, encoder.encode(JSON.stringify(next)).buffer as ArrayBuffer);
  return next;
};

export const removeConversationDescriptor = async (storage: ProductSecureStorage, roomId: string): Promise<ConversationDescriptor[]> => {
  const next = (await readConversationDescriptors(storage)).filter((item) => item.roomId !== roomId);
  await storage.write(RECORD_TYPE, RECORD_ID, encoder.encode(JSON.stringify(next)).buffer as ArrayBuffer);
  return next;
};
