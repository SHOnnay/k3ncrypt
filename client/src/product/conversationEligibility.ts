import { ContactIdentityRegistry, ConversationModeStore } from '@chat-e2ee/service';
import type { SecureStorage } from '../../../service/src/core/contracts';
import { validateConversationDescriptor, type ConversationDescriptor, type ProductSecureStorage } from './sessionStore';
import type { SafeDiagnosticCode } from './safeDiagnostics';
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
    if (!mode.remoteAddress && !descriptor.remoteAddress) return 'CONVERSATION_INVITATION_UNACCEPTED';
    if (!mode.localAddress || !mode.routingProof) return 'CONVERSATION_STATE_INCOMPLETE';
    if (!mode.remoteAddress || !descriptor.remoteAddress || mode.remoteAddress !== descriptor.remoteAddress || mode.localAddress === mode.remoteAddress) return 'ROOM_MEMBERSHIP_MISMATCH';
    const contact = await new ContactIdentityRegistry(view).get(mode.remoteAddress, false);
    if (!contact) return 'CONTACT_REGISTRY_MISSING';
    if (contact.contactId !== mode.remoteAddress || !descriptor.remoteIdentityCommitment || contact.identityId !== descriptor.remoteIdentityCommitment) return 'ROOM_MEMBERSHIP_MISMATCH';
    if (!mode.sessionId || !(await storage.read('vodozemac-session', descriptor.roomId))?.byteLength) return 'CONVERSATION_SESSION_MISSING';
    return undefined;
  } catch { return 'CONVERSATION_STATE_INCOMPLETE'; }
}
export interface ConversationIndex { conversations: ConversationDescriptor[]; unavailable: SafeDiagnosticCode[]; }
export async function readConversationIndex(storage: ProductSecureStorage, descriptors: readonly ConversationDescriptor[], roomProbe?: RoomProbe): Promise<ConversationIndex> {
  const bytes = await storage.read('product-session', 'conversations');
  let raw: unknown;
  try { raw = bytes ? JSON.parse(decoder.decode(bytes)) : []; } catch { return { conversations: [], unavailable: ['CONVERSATION_RECORD_INVALID'] }; }
  if (!Array.isArray(raw) || raw.length > 100) return { conversations: [], unavailable: ['CONVERSATION_RECORD_INVALID'] };
  const result: ConversationIndex = { conversations: [], unavailable: [] }; const seen = new Set<string>();
  for (const value of raw) {
    const failure = await conversationEligibility(storage, value, roomProbe);
    if (failure) { result.unavailable.push(failure); continue; }
    const descriptor = validateConversationDescriptor(value);
    if (seen.has(descriptor.roomId)) { result.unavailable.push('CONVERSATION_RECORD_INVALID'); continue; }
    seen.add(descriptor.roomId); result.conversations.push(descriptors.find(item => item.roomId === descriptor.roomId) ?? descriptor);
  }
  return result;
}
