import { conversationEligibility, readConversationIndex } from './conversationEligibility';
import { readConversationDescriptors, saveConversationDescriptor } from './sessionStore';
class Store {
  records = new Map<string, ArrayBuffer>();
  read = async (type: string, id: string) => this.records.get(type + ':' + id)?.slice(0);
  write = async (type: string, id: string, value: ArrayBuffer) => { this.records.set(type + ':' + id, value.slice(0)); };
  put = (type: string, id: string, value: unknown) => this.write(type, id, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer);
}
const room = '11111111-1111-4111-8111-111111111111';
const descriptor = { version: 1 as const, roomId: room, controlCapability: 'a'.repeat(43), label: 'Private contact', updatedAt: 1, remoteAddress: 'peer-address', remoteIdentityCommitment: 'K3 ' + 'A'.repeat(43) };
async function valid() {
  const store = new Store(); await saveConversationDescriptor(store, descriptor);
  await store.put('conversation-protocol', room, { version: 1, mode: 'modern', localAddress: 'self-address', remoteAddress: descriptor.remoteAddress, routingProof: 'b'.repeat(43), sessionId: 'session' });
  await store.put('contact-identity', descriptor.remoteAddress, { contactId: descriptor.remoteAddress, identityId: descriptor.remoteIdentityCommitment, algorithm: 'Olm-Curve25519+Ed25519', publicKey: 'AAAA', verification: 'verified', changeStatus: 'unchanged' });
  await store.write('vodozemac-session', room, new Uint8Array([1]).buffer); return store;
}
it('fresh index is empty and a valid old relationship remains eligible without changing trust', async () => {
  const store = await valid(); const before = [...store.records];
  expect(await conversationEligibility(store, descriptor)).toBeUndefined();
  expect((await readConversationIndex(store, await readConversationDescriptors(store))).conversations).toHaveLength(1);
  expect([...store.records]).toEqual(before);
  expect(await readConversationIndex(new Store(), [])).toEqual({ conversations: [], unavailable: [] });
});
it('quarantines old unaccepted, expired, missing session, malformed and mismatched states read-only', async () => {
  const store = await valid();
  expect(await conversationEligibility(store, descriptor, async () => 'CONVERSATION_INVITATION_EXPIRED')).toBe('CONVERSATION_INVITATION_EXPIRED');
  store.records.delete('vodozemac-session:' + room);
  expect(await conversationEligibility(store, descriptor)).toBe('CONVERSATION_SESSION_MISSING');
  const pending = { ...descriptor, remoteAddress: undefined, remoteIdentityCommitment: undefined };
  await store.put('conversation-protocol', room, { version: 1, mode: 'modern', localAddress: 'self-address', routingProof: 'b'.repeat(43) });
  expect(await conversationEligibility(store, pending)).toBe('CONVERSATION_INVITATION_UNACCEPTED');
  expect(await conversationEligibility(store, { ...pending, relationship: 'invitation' })).toBeUndefined();
  expect(await conversationEligibility(store, { bad: true })).toBe('CONVERSATION_RECORD_INVALID');
  expect(await conversationEligibility(store, descriptor)).toBe('ROOM_MEMBERSHIP_MISMATCH');
});
it('one malformed entry cannot hide a valid contact; classification and subsequent saves preserve it', async () => {
  const store = await valid(); const malformed = { incomplete: true };
  await store.put('product-session', 'conversations', [malformed, descriptor]); const before = await store.read('product-session', 'conversations');
  const index = await readConversationIndex(store, await readConversationDescriptors(store));
  expect(index.conversations).toHaveLength(1); expect(index.unavailable).toEqual(['CONVERSATION_RECORD_INVALID']);
  expect(await store.read('product-session', 'conversations')).toEqual(before);
  await saveConversationDescriptor(store, { ...descriptor, label: 'Friend' });
  expect(JSON.parse(new TextDecoder().decode(await store.read('product-session', 'conversations')))).toContainEqual(malformed);
});
it('missing canonical contact is quarantined; changed identity remains available for review without verification', async () => {
  const store = await valid(); store.records.delete('contact-identity:' + descriptor.remoteAddress);
  expect(await conversationEligibility(store, descriptor)).toBe('CONTACT_REGISTRY_MISSING');
  await store.put('contact-identity', descriptor.remoteAddress, { contactId: descriptor.remoteAddress, identityId: descriptor.remoteIdentityCommitment, algorithm: 'Olm-Curve25519+Ed25519', publicKey: 'AAAA', verification: 'unverified', changeStatus: 'changed-pending-review' });
  expect(await conversationEligibility(store, descriptor)).toBeUndefined();
});
