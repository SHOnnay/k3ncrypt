import { ContactIdentityRegistry, ConversationModeStore } from '@chat-e2ee/service';
import type { SecureStorage } from '../../../service/src/core/contracts';
import { CONVERSATION_WINDOW, validateConversationDescriptor, type ConversationDescriptor, type ProductSecureStorage } from './sessionStore';
import { classifySafeDiagnostic, type SafeDiagnosticCode } from './safeDiagnostics';
const decoder = new TextDecoder();
export const conversationFailure = (code: SafeDiagnosticCode): Error => Object.assign(new Error('Saved conversation unavailable.'), { safeDiagnosticCode: code });
/** Read-only classification. No identity/trust migration or record deletion. */
export type RoomProbe = (descriptor: ConversationDescriptor) => Promise<SafeDiagnosticCode | undefined>;
export async function conversationEligibility(storage: ProductSecureStorage, value: unknown, roomProbe?: RoomProbe): Promise<SafeDiagnosticCode | undefined> {
  let descriptor: ConversationDescriptor;
  try { descriptor = validateConversationDescriptor(value); } catch { return 'CONVERSATION_RECORD_INVALID'; }
  const deny = async (): Promise<never> => { throw new Error('Read-only classification.'); };
  const view: SecureStorage = { initializeWithPassphrase: deny, unlock: deny, lock: () => { throw new Error('Read-only classification.'); }, changeUnlockSecret: deny, isLocked: () => false, withVodozemacPickleKey: deny, read: storage.read.bind(storage), write: async () => { throw new Error('Read-only classification.'); }, delete: async () => { throw new Error('Read-only classification.'); } };
  try {
    const unavailable = await roomProbe?.(descriptor);
    if (unavailable) return unavailable;
    const mode = await new ConversationModeStore(view).read(descriptor.roomId);
    if (!mode) return 'CONVERSATION_STATE_INCOMPLETE';
    if (descriptor.remoteAddress && descriptor.bootstrapState && descriptor.bootstrapState !== 'ESTABLISHED' && mode.localAddress && mode.routingProof) return undefined;
    // A locally created invitation can be reopened to listen for its first
    // authenticated introduction. Opening an unanswered room carries no
    // contact, trust, or established-session claim.
    if (descriptor.relationship === 'invitation' && !descriptor.remoteAddress && mode.localAddress && mode.routingProof) return undefined;
    if (!mode.remoteAddress && !descriptor.remoteAddress) return 'CONVERSATION_INVITATION_UNACCEPTED';
    if (!mode.localAddress || !mode.routingProof) return 'CONVERSATION_STATE_INCOMPLETE';
    if (!mode.remoteAddress || !descriptor.remoteAddress || mode.remoteAddress !== descriptor.remoteAddress || mode.localAddress === mode.remoteAddress) return 'ROOM_MEMBERSHIP_MISMATCH';
    const contact = await new ContactIdentityRegistry(view).get(mode.remoteAddress, false);
    if (!contact) return 'CONTACT_REGISTRY_MISSING';
    if (contact.contactId !== mode.remoteAddress || !descriptor.remoteIdentityCommitment || contact.identityId !== descriptor.remoteIdentityCommitment) return 'ROOM_MEMBERSHIP_MISMATCH';
    if (!mode.sessionId || !(await storage.read('vodozemac-session', descriptor.roomId))?.byteLength) return 'CONVERSATION_SESSION_MISSING';
    return undefined;
  } catch (error) {
    const code = classifySafeDiagnostic('conversation-open', error);
    return code === 'UNKNOWN_SAFE_FAILURE' ? 'CONVERSATION_STORAGE_UNAVAILABLE' : code;
  }
}
export type ConversationAvailabilityState = 'saved' | 'pending' | 'retryable' | 'terminal' | 'local-incomplete' | 'review-required' | 'deferred';
export interface ConversationDiagnostic { roomId?: string; label: string; state: ConversationAvailabilityState; code?: SafeDiagnosticCode; }
export const authoritativeTerminal = (code: SafeDiagnosticCode): boolean => code === 'CONVERSATION_INVITATION_EXPIRED' || code === 'CONVERSATION_ROOM_MISSING' || code === 'CONVERSATION_REMOVED';
export function conversationDiagnostic(descriptor: Pick<ConversationDescriptor, 'roomId' | 'label' | 'localNickname' | 'remoteDisplayName'>, code: SafeDiagnosticCode): ConversationDiagnostic {
  const state: ConversationAvailabilityState = authoritativeTerminal(code) ? 'terminal'
    : code === 'CONVERSATION_INVITATION_UNACCEPTED' ? 'pending'
    : ['ROOM_MEMBERSHIP_MISMATCH', 'PINNED_IDENTITY_CHANGED', 'VERIFICATION_REQUIRED', 'CONVERSATION_MUX_AUTHENTICATION_REJECTED'].includes(code) ? 'review-required'
    : ['CONVERSATION_STATE_INCOMPLETE', 'CONVERSATION_SESSION_MISSING', 'CONTACT_REGISTRY_MISSING', 'CONVERSATION_LOCAL_RECORD_INVALID', 'CONVERSATION_RECORD_INVALID'].includes(code) ? 'local-incomplete' : 'retryable';
  const label = descriptor.localNickname ?? descriptor.remoteDisplayName ?? descriptor.label;
  return { roomId: descriptor.roomId, label: label === 'Private contact' ? `${label} · ${descriptor.roomId.slice(-8)}` : label, state, code };
}
export const conversationStateCopy = (diagnostic: ConversationDiagnostic): string => diagnostic.code === 'CONVERSATION_INVITATION_EXPIRED' ? 'Invitation expired — local identities and history are retained.' : diagnostic.code === 'CONTACT_REGISTRY_MISSING' ? 'Saved conversation — matching local contact identity is unavailable. Access is paused; history has not been deleted.' : diagnostic.code === 'CONVERSATION_SESSION_MISSING' ? 'Saved conversation — encrypted session needs recovery. History is retained.' : diagnostic.code === 'CONVERSATION_RECORD_INVALID' || diagnostic.code === 'CONVERSATION_LOCAL_RECORD_INVALID' ? 'Saved entry could not be read safely. It has been retained for review.' : diagnostic.code === 'CONVERSATION_ROUTING_AUTHORIZATION_UNAVAILABLE' ? 'Contact saved · authorization recovery required' : diagnostic.code === 'CONVERSATION_PREKEY_UNAVAILABLE' ? 'Contact saved · reconnection paused' : diagnostic.code === 'CONVERSATION_IN_USE' ? 'Open in another tab — close it and retry' : ({
  saved: 'Saved on this device', pending: 'Waiting for contact to accept', retryable: 'Disconnected — retry opening',
  terminal: 'Room expired or removed', 'local-incomplete': 'Local records incomplete — access paused',
  'review-required': 'Identity or room binding needs review', deferred: 'More saved entries retained on this device',
})[diagnostic.state];
export interface ConversationIndex { conversations: ConversationDescriptor[]; unavailable: ConversationDiagnostic[]; }
export interface SidebarConversationGroups { chats: ConversationDescriptor[]; pendingInvitations: ConversationDescriptor[]; unavailable: ConversationDiagnostic[]; archived: ConversationDescriptor[]; }

const remoteAvailabilityFailures = new Set<SafeDiagnosticCode>(['CONVERSATION_PREKEY_UNAVAILABLE', 'CONVERSATION_ROUTING_AUTHORIZATION_UNAVAILABLE', 'NETWORK_FAILURE', 'SERVICE_NOT_READY']);
const showSavedChatWithAvailabilityFailure = (descriptor: ConversationDescriptor, code?: SafeDiagnosticCode): boolean =>
  Boolean(code && remoteAvailabilityFailures.has(code) && descriptor.remoteAddress && descriptor.remoteIdentityCommitment &&
    (!descriptor.bootstrapState || descriptor.bootstrapState === 'ESTABLISHED'));

/** Presentation only: keeping a saved row visible never authorizes connection or grants trust. */
export function classifySidebarConversations(descriptors: readonly ConversationDescriptor[], diagnostics: readonly ConversationDiagnostic[]): SidebarConversationGroups {
  const chats: ConversationDescriptor[] = [];
  const pendingInvitations: ConversationDescriptor[] = [];
  const archived = descriptors.filter(item => item.locallyArchived);
  const terminalRooms = new Set(diagnostics.flatMap(item => item.roomId && item.code && authoritativeTerminal(item.code) ? [item.roomId] : []));
  const now = Date.now();
  const isInvitation = (item: ConversationDescriptor) => item.relationship === 'invitation' && !item.remoteAddress;
  const expired = (item: ConversationDescriptor) => {
    const expiresAt = item.signedInvitation?.expiresAt ?? item.pendingInvitationExpiresAt;
    return isInvitation(item) && Number.isSafeInteger(expiresAt) && expiresAt! <= now;
  };
  const pending = (item: ConversationDescriptor) => isInvitation(item) && !expired(item) && !terminalRooms.has(item.roomId);
  const unavailable = diagnostics.map(item => {
    const descriptor = descriptors.find(saved => saved.roomId === item.roomId);
    return descriptor && expired(descriptor) && (item.code === 'CONVERSATION_STATE_INCOMPLETE' || item.code === 'CONVERSATION_INVITATION_UNACCEPTED')
      ? conversationDiagnostic(descriptor, 'CONVERSATION_INVITATION_EXPIRED') : item;
  }).filter(item => !archived.some(descriptor => descriptor.roomId === item.roomId) && !descriptors.some(descriptor => descriptor.roomId === item.roomId &&
    (pending(descriptor) || showSavedChatWithAvailabilityFailure(descriptor, item.code))));
  const unavailableRooms = new Set(unavailable.flatMap(item => item.roomId ? [item.roomId] : []));
  for (const descriptor of descriptors) {
    if (descriptor.locallyArchived) continue;
    if (pending(descriptor)) {
      pendingInvitations.push(descriptor);
      continue;
    }
    if (expired(descriptor) && !unavailableRooms.has(descriptor.roomId)) {
      unavailable.push(conversationDiagnostic(descriptor, 'CONVERSATION_INVITATION_EXPIRED'));
      unavailableRooms.add(descriptor.roomId);
    }
    if (descriptor.bootstrapState === 'PENDING_LOCAL' || descriptor.bootstrapState === 'PENDING_REMOTE' || descriptor.bootstrapState === 'FAILED_OR_UNSUPPORTED') {
      if (!unavailableRooms.has(descriptor.roomId)) {
        const code: SafeDiagnosticCode = 'CONVERSATION_INVITATION_UNACCEPTED';
        unavailable.push(conversationDiagnostic(descriptor, code));
        unavailableRooms.add(descriptor.roomId);
      }
      continue;
    }
    if (!unavailableRooms.has(descriptor.roomId)) chats.push(descriptor);
  }
  return { chats, pendingInvitations, unavailable, archived };
}

export async function readConversationIndex(storage: ProductSecureStorage, descriptors: readonly ConversationDescriptor[], roomProbe?: RoomProbe): Promise<ConversationIndex> {
  let raw: unknown;
  try { const bytes = await storage.read('product-session', 'conversations'); raw = bytes ? JSON.parse(decoder.decode(bytes)) : []; }
  catch (error) { return { conversations: [...descriptors], unavailable: [{ label: 'Saved conversation index', state: 'local-incomplete', code: error instanceof SyntaxError ? 'CONVERSATION_RECORD_INVALID' : 'CONVERSATION_STORAGE_UNAVAILABLE' }] }; }
  if (!Array.isArray(raw)) return { conversations: [...descriptors], unavailable: [{ label: 'Saved conversation index', state: 'local-incomplete', code: 'CONVERSATION_RECORD_INVALID' }] };
  const result: ConversationIndex = { conversations: [], unavailable: [] }; const seen = new Set<string>();
  const candidates = new Map<string, ConversationDescriptor>();
  for (const value of raw) { try { const item = validateConversationDescriptor(value); if (!candidates.has(item.roomId)) candidates.set(item.roomId, item); } catch { /* Classified individually below. */ } }
  const visible = new Set([...candidates.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, CONVERSATION_WINDOW).map(item => item.roomId));
  let omitted = 0;
  for (const value of raw) {
    let descriptor: ConversationDescriptor;
    try { descriptor = validateConversationDescriptor(value); }
    catch { if (result.unavailable.length < CONVERSATION_WINDOW) result.unavailable.push({ label: 'Invalid saved entry', state: 'local-incomplete', code: 'CONVERSATION_RECORD_INVALID' }); continue; }
    if (seen.has(descriptor.roomId)) { if (result.unavailable.length < CONVERSATION_WINDOW) result.unavailable.push(conversationDiagnostic(descriptor, 'CONVERSATION_RECORD_INVALID')); continue; }
    seen.add(descriptor.roomId);
    if (!visible.has(descriptor.roomId)) { omitted++; continue; }
    const projected = descriptors.find(item => item.roomId === descriptor.roomId);
    const namedDescriptor = projected?.remoteIdentityCommitment === descriptor.remoteIdentityCommitment ? { ...descriptor, remoteDisplayName: projected?.remoteDisplayName } : descriptor;
    const failure = await conversationEligibility(storage, value, roomProbe);
    if (failure) { result.unavailable.push(conversationDiagnostic(namedDescriptor, failure)); if (authoritativeTerminal(failure)) continue; }
    result.conversations.push({ ...descriptor, remoteDisplayName: projected?.remoteIdentityCommitment === descriptor.remoteIdentityCommitment ? projected?.remoteDisplayName : undefined });
  }
  if (omitted) result.unavailable.push({ label: `${omitted} additional saved entries`, state: 'deferred', code: 'CONVERSATION_INDEX_LIMIT' });
  result.conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  return result;
}

/** Read-only: record addresses reveal orphan evidence, never keys, trust, ciphertext or plaintext. */
export async function diagnoseOrphanedConversationRecords(storage: ProductSecureStorage): Promise<{ roomIds: string[]; truncated: boolean; available: boolean }> {
  if (!storage.listRecordIds) return { roomIds: [], truncated: false, available: false };
  const bytes = await storage.read('product-session', 'conversations');
  const raw: unknown = bytes ? JSON.parse(decoder.decode(bytes)) : [];
  if (!Array.isArray(raw)) return { roomIds: [], truncated: false, available: false };
  const known = new Set(raw.flatMap(value => { try { return [validateConversationDescriptor(value).roomId]; } catch { return []; } }));
  const removalsBytes = await storage.read('product-session', 'conversation-removals');
  const removals: unknown = removalsBytes ? JSON.parse(decoder.decode(removalsBytes)) : [];
  if (!Array.isArray(removals)) return { roomIds: [], truncated: false, available: false };
  const records = await Promise.all(['conversation-protocol', 'vodozemac-session'].map(type => storage.listRecordIds!(type, CONVERSATION_WINDOW)));
  const candidates = [...new Set(records.flatMap(item => item.recordIds))].filter(roomId => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId) && !known.has(roomId) && !removals.includes(roomId));
  return { roomIds: candidates.slice(0, CONVERSATION_WINDOW), truncated: candidates.length > CONVERSATION_WINDOW || records.some(item => item.truncated), available: true };
}

/**
 * Opening a saved conversation must never wait on the network. Local eligibility (identity, pinned
 * contact, session records) decides whether it may open; the room-status probe only reports
 * authoritative expiry/deletion. It runs after a failed connection attempt and calls back solely for
 * terminal results. Offline, waking-server, 503 and 401/403 outcomes are not terminal here: the
 * authenticated connection step enforces its own admission and reports its own failure.
 */
export async function observeAuthoritativeRoomState(
  descriptor: ConversationDescriptor,
  probe: RoomProbe,
  onTerminal: (code: SafeDiagnosticCode) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  try {
    if (!isCurrent()) return;
    const code = await probe(descriptor);
    if (code && authoritativeTerminal(code) && isCurrent()) onTerminal(code);
  } catch { /* Best-effort observation only. */ }
}

/** A status probe has no authority over a new selection/session or an authenticated admission. */
export function roomObservationCurrent(
  started: { operation: number; scope?: object; descriptor: object },
  now: { operation: number; scope?: object; descriptor?: object; aborted: boolean; connected: boolean },
): boolean {
  return !!started.scope && !now.aborted && !now.connected && started.operation === now.operation &&
    started.scope === now.scope && started.descriptor === now.descriptor;
}
