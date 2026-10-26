import { readRemoteProfile } from './profileMetadata';
import type { SignedModernInvitation } from '@chat-e2ee/service';
import type { SecureRecordUpdate } from '../../../service/src/core/contracts';

export interface ProductSecureStorage {
  read(recordType: string, recordId: string): Promise<ArrayBuffer | undefined>;
  write(recordType: string, recordId: string, value: ArrayBuffer): Promise<void>;
  compareAndSwapRecords?(updates: readonly SecureRecordUpdate[]): Promise<boolean>;
  listRecordIds?(recordType: string, limit: number): Promise<{ recordIds: string[]; truncated: boolean }>;
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
  signedInvitation?: SignedModernInvitation;
  /** Local display cache; populated from the signed invitation or authorized room-status response. */
  pendingInvitationExpiresAt?: number;
  bootstrapState?: 'PENDING_LOCAL' | 'PENDING_REMOTE' | 'ESTABLISHED' | 'FAILED_OR_UNSUPPORTED';
  label: string;
  /** Projection only: read from an encrypted, identity-bound profile record. */
  remoteDisplayName?: string;
  localNickname?: string;
  /** Device-local presentation state only; does not revoke or alter an invitation. */
  locallyDismissed?: boolean;
  /** Local list presentation only. Retains access, trust and encrypted history. */
  locallyArchived?: boolean;
  updatedAt: number;
}

const RECORD_TYPE = 'product-session';
const RECORD_ID = 'conversations';
const REMOVALS_ID = 'conversation-removals';
/** A bounded visible window; excess records are retained and reported, never deleted. */
export const CONVERSATION_WINDOW = 1000;
const MAX_CONFLICT_RETRIES = 64;
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
    || (item.bootstrapState !== undefined && !['PENDING_LOCAL', 'PENDING_REMOTE', 'ESTABLISHED', 'FAILED_OR_UNSUPPORTED'].includes(String(item.bootstrapState)))
    || (item.signedInvitation !== undefined && (!item.signedInvitation || typeof item.signedInvitation !== 'object' || (item.signedInvitation as Record<string, unknown>).version !== 2))
    || (item.pendingInvitationExpiresAt !== undefined && (!Number.isSafeInteger(item.pendingInvitationExpiresAt) || (item.pendingInvitationExpiresAt as number) < 0))
    || (item.localNickname !== undefined && (typeof item.localNickname !== 'string' || !item.localNickname.trim() || item.localNickname.length > 80 || /[\u0000-\u001f\u007f]/.test(item.localNickname)))
    || (item.locallyDismissed !== undefined && typeof item.locallyDismissed !== 'boolean')
    || (item.locallyArchived !== undefined && typeof item.locallyArchived !== 'boolean')
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
    ...(item.signedInvitation ? { signedInvitation: item.signedInvitation as SignedModernInvitation } : {}),
    ...(Number.isSafeInteger(item.pendingInvitationExpiresAt) && (item.pendingInvitationExpiresAt as number) >= 0 ? { pendingInvitationExpiresAt: item.pendingInvitationExpiresAt as number } : {}),
    ...(item.bootstrapState ? { bootstrapState: item.bootstrapState as ConversationDescriptor['bootstrapState'] } : {}),
    label: item.label.trim(),
    ...(typeof item.localNickname === 'string' && item.localNickname.trim() && item.localNickname.length <= 80 && !/[\u0000-\u001f\u007f]/.test(item.localNickname) ? { localNickname: item.localNickname.trim() } : {}),
    ...(typeof item.locallyDismissed === 'boolean' ? { locallyDismissed: item.locallyDismissed } : {}),
    ...(typeof item.locallyArchived === 'boolean' ? { locallyArchived: item.locallyArchived } : {}),
    updatedAt: item.updatedAt,
  });
};

export const readConversationDescriptors = async (storage: ProductSecureStorage, projectProfiles = true): Promise<ConversationDescriptor[]> => {
  const bytes = await storage.read(RECORD_TYPE, RECORD_ID);
  if (!bytes) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(new Uint8Array(bytes))); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const descriptors: ConversationDescriptor[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    try { const item = validateConversationDescriptor(value); if (!seen.has(item.roomId)) { descriptors.push(item); seen.add(item.roomId); } } catch { /* Preserve unavailable entry in the encrypted source index. */ }
  }
  return Promise.all(descriptors.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, CONVERSATION_WINDOW).map(async (item) => {
    if (!projectProfiles) return item;
    try {
      let pinned = item.remoteIdentityCommitment;
      if (item.remoteAddress) {
        const bytes = await storage.read('contact-identity', item.remoteAddress);
        try {
          const contact: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : undefined;
          if (!contact || typeof contact !== 'object' || !('identityId' in contact) || contact.identityId !== pinned || !('changeStatus' in contact) || contact.changeStatus !== 'unchanged') pinned = undefined;
        } catch { pinned = undefined; }
      }
      return { ...item, remoteDisplayName: (await readRemoteProfile(storage, item.roomId, pinned))?.displayName };
    } catch { return item; /* Profile projection failure cannot erase the access descriptor. */ }
  }));
};

const storageFailure = (code: 'CONVERSATION_STORAGE_CONFLICT' | 'CONVERSATION_STORAGE_UNAVAILABLE' | 'CONVERSATION_REMOVED' | 'ROOM_MEMBERSHIP_MISMATCH' | 'CONVERSATION_INDEX_LIMIT'): Error =>
  Object.assign(new Error('Conversation metadata could not be saved safely.'), { safeDiagnosticCode: code });
const decodeArray = (bytes: ArrayBuffer | undefined): unknown[] => {
  const value: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : [];
  if (!Array.isArray(value)) throw new Error('Saved conversation list is invalid.');
  return value;
};
const encode = (value: unknown): ArrayBuffer => encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer;
const roomOf = (value: unknown): string | undefined => {
  try { return validateConversationDescriptor(value).roomId; } catch { return undefined; }
};

/** All writes contend on the encrypted index AND removal markers in one vault transaction. */
async function mutate(storage: ProductSecureStorage, roomId: string, change?: (current: ConversationDescriptor | undefined) => Promise<ConversationDescriptor>): Promise<ConversationDescriptor[]> {
  if (!roomPattern.test(roomId)) throw new Error('Saved conversation is invalid.');
  if (!storage.compareAndSwapRecords) throw storageFailure('CONVERSATION_STORAGE_UNAVAILABLE');
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const [bytes, removalsBytes] = await Promise.all([storage.read(RECORD_TYPE, RECORD_ID), storage.read(RECORD_TYPE, REMOVALS_ID)]);
    const raw = decodeArray(bytes);
    const removals = decodeArray(removalsBytes);
    if (removals.some(value => typeof value !== 'string' || !roomPattern.test(value))) throw new Error('Saved removal markers are invalid.');
    if (change && removals.includes(roomId)) throw storageFailure('CONVERSATION_REMOVED');
    const matches = raw.filter(value => roomOf(value) === roomId);
    // Ambiguous duplicate access records require explicit recovery, never destructive deduplication.
    if (matches.length > 1) throw new Error('Saved conversation is invalid.');
    const matching = matches[0];
    const current = matching === undefined ? undefined : validateConversationDescriptor(matching);
    const retained = raw.filter(value => roomOf(value) !== roomId);
    const next = change ? await change(current) : undefined;
    if (next && !current && raw.filter(value => roomOf(value)).length >= CONVERSATION_WINDOW) throw storageFailure('CONVERSATION_INDEX_LIMIT');
    const nextRaw = next ? [{ ...(matching as object | undefined), ...next }, ...retained] : retained;
    const nextRemovals = change || removals.includes(roomId) ? removals : [...removals, roomId];
    if (await storage.compareAndSwapRecords([
      { recordType: RECORD_TYPE, recordId: RECORD_ID, expected: bytes, next: encode(nextRaw) },
      { recordType: RECORD_TYPE, recordId: REMOVALS_ID, expected: removalsBytes, next: encode(nextRemovals) },
    ])) return readConversationDescriptors(storage, false);
    // Bounded yielding/backoff prevents a busy tab from monopolizing the CAS loop.
    await new Promise(resolve => setTimeout(resolve, Math.min(attempt + 1, 16)));
  }
  throw storageFailure('CONVERSATION_STORAGE_CONFLICT');
}

/** Create or conservatively merge. Runtime updates use field patches, never stale full snapshots. */
export const saveConversationDescriptor = async (storage: ProductSecureStorage, descriptor: ConversationDescriptor): Promise<ConversationDescriptor[]> => {
  const valid = validateConversationDescriptor(descriptor);
  return mutate(storage, valid.roomId, async current => {
    if (!current) return valid;
    if (current.controlCapability !== valid.controlCapability || current.remoteAddress && current.remoteAddress !== valid.remoteAddress || current.remoteIdentityCommitment && current.remoteIdentityCommitment !== valid.remoteIdentityCommitment) throw storageFailure('ROOM_MEMBERSHIP_MISMATCH');
    // Existing signed/established state cannot be erased by a stale invitation or join retry.
    return validateConversationDescriptor({ ...current, ...valid, signedInvitation: current.signedInvitation ?? valid.signedInvitation,
      bootstrapState: current.bootstrapState === 'ESTABLISHED' ? current.bootstrapState : valid.bootstrapState ?? current.bootstrapState,
      relationship: current.relationship === 'accepted' ? current.relationship : valid.relationship ?? current.relationship,
      localNickname: valid.localNickname ?? current.localNickname, locallyArchived: current.locallyArchived });
  });
};

export type ConversationPatch = Partial<Pick<ConversationDescriptor, 'label' | 'localNickname' | 'bootstrapState' | 'relationship' | 'remoteAddress' | 'remoteIdentityCommitment' | 'locallyDismissed' | 'locallyArchived' | 'pendingInvitationExpiresAt'>>;
export const updateConversationDescriptor = async (storage: ProductSecureStorage, roomId: string, patch: ConversationPatch): Promise<ConversationDescriptor[]> =>
  mutate(storage, roomId, async current => {
    if (!current) throw storageFailure('CONVERSATION_REMOVED');
    if ('remoteAddress' in patch && !patch.remoteAddress || 'remoteIdentityCommitment' in patch && !patch.remoteIdentityCommitment) throw storageFailure('ROOM_MEMBERSHIP_MISMATCH');
    if (patch.remoteAddress && current.remoteAddress && patch.remoteAddress !== current.remoteAddress) throw storageFailure('ROOM_MEMBERSHIP_MISMATCH');
    if (patch.remoteIdentityCommitment && patch.remoteIdentityCommitment !== current.remoteIdentityCommitment) {
      // Only project an identity already accepted by the canonical registry; this grants no trust.
      const address = patch.remoteAddress ?? current.remoteAddress;
      const bytes = address ? await storage.read('contact-identity', address) : undefined;
      const contact: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : undefined;
      if (!contact || typeof contact !== 'object' || !('identityId' in contact) || contact.identityId !== patch.remoteIdentityCommitment || !('contactId' in contact) || contact.contactId !== address) throw storageFailure('ROOM_MEMBERSHIP_MISMATCH');
    }
    return validateConversationDescriptor({ ...current, ...patch, updatedAt: Date.now(),
      bootstrapState: current.bootstrapState === 'ESTABLISHED' ? 'ESTABLISHED' : patch.bootstrapState ?? current.bootstrapState,
      relationship: current.relationship === 'accepted' ? 'accepted' : patch.relationship ?? current.relationship });
  });

export const removeConversationDescriptor = async (storage: ProductSecureStorage, roomId: string): Promise<ConversationDescriptor[]> => {
  return mutate(storage, roomId);
};
