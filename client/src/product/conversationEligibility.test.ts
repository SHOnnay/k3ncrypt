import { authoritativeTerminal, classifySidebarConversations, conversationStateCopy, conversationDiagnostic, conversationEligibility, diagnoseOrphanedConversationRecords, observeAuthoritativeRoomState, readConversationIndex, roomObservationCurrent } from './conversationEligibility';
import { readConversationDescriptors, saveConversationDescriptor } from './sessionStore';
import { TestProductStorage as Store } from './testStorage';
import { classifySafeDiagnostic } from './safeDiagnostics';
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

it('classifies established chats, pending invitations and unavailable historical records separately', () => {
  const established = { ...descriptor, relationship: 'accepted' as const, bootstrapState: 'ESTABLISHED' as const };
  const pending = { ...descriptor, roomId: '00000000-0000-4000-8000-000000000042', relationship: 'invitation' as const, remoteAddress: undefined, remoteIdentityCommitment: undefined, signedInvitation: undefined };
  const acceptedButUnfinished = { ...descriptor, roomId: '00000000-0000-4000-8000-000000000043', relationship: 'accepted' as const, bootstrapState: 'PENDING_REMOTE' as const };
  const historic = conversationDiagnostic({ roomId: '00000000-0000-4000-8000-000000000044', label: 'Old friend' }, 'CONVERSATION_ROOM_MISSING');
  const groups = classifySidebarConversations([established, pending, acceptedButUnfinished], [historic]);
  expect(groups.chats.map(item => item.roomId)).toEqual([established.roomId]);
  expect(groups.pendingInvitations.map(item => item.roomId)).toEqual([pending.roomId]);
  expect(groups.unavailable.map(item => item.roomId)).toEqual([historic.roomId, acceptedButUnfinished.roomId]);
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
  expect(index.conversations).toHaveLength(1); expect(index.unavailable).toEqual([expect.objectContaining({ code: 'CONVERSATION_RECORD_INVALID', state: 'local-incomplete' })]);
  expect(await store.read('product-session', 'conversations')).toEqual(before);
  await saveConversationDescriptor(store, { ...descriptor, label: 'Friend' });
  expect(JSON.parse(new TextDecoder().decode(await store.read('product-session', 'conversations')))).toContainEqual(malformed);
});

it('retains 150 healthy contacts and pending invitations above the old threshold, preserving malformed entries', async () => {
  const store = await valid();
  const entries = Array.from({ length: 150 }, (_, i) => ({ ...descriptor, roomId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, label: `Contact ${i}` }));
  for (const item of entries) {
    await store.write('conversation-protocol', item.roomId, (await store.read('conversation-protocol', room))!);
    await store.write('vodozemac-session', item.roomId, new Uint8Array([1]).buffer);
  }
  await store.put('product-session', 'conversations', [null, { broken: true }, ...entries]);
  const index = await readConversationIndex(store, await readConversationDescriptors(store));
  expect(index.conversations).toHaveLength(150);
  expect(index.unavailable).toHaveLength(2);
  await saveConversationDescriptor(store, { ...entries[0], label: 'Updated contact' });
  expect(await readConversationDescriptors(store)).toHaveLength(150);
  expect(JSON.parse(new TextDecoder().decode(await store.read('product-session', 'conversations')))).toContainEqual({ broken: true });
});

it('bounds visible work without deleting oversized indexes or refusing updates/removals', async () => {
  const store = await valid();
  const entries = Array.from({ length: 1002 }, (_, i) => ({ ...descriptor, roomId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, updatedAt: i }));
  await store.put('product-session', 'conversations', entries);
  const before = await store.read('product-session', 'conversations');
  const visible = await readConversationDescriptors(store);
  expect(visible).toHaveLength(1000);
  const index = await readConversationIndex(store, visible);
  expect(index.conversations).toHaveLength(1000);
  expect(index.unavailable).toContainEqual({ label: '2 additional saved entries', state: 'deferred', code: 'CONVERSATION_INDEX_LIMIT' });
  expect(await store.read('product-session', 'conversations')).toEqual(before);
  await saveConversationDescriptor(store, { ...entries[0], label: 'Preserved beyond the window' });
  expect(JSON.parse(new TextDecoder().decode(await store.read('product-session', 'conversations')))).toHaveLength(1002);
  await expect(saveConversationDescriptor(store, descriptor)).rejects.toMatchObject({ safeDiagnosticCode: 'CONVERSATION_INDEX_LIMIT' });
});

it('one incomplete room and a failed profile read cannot hide a healthy room', async () => {
  const store = await valid(); const broken = { ...descriptor, roomId: '00000000-0000-4000-8000-000000000001', label: 'Bob' };
  await saveConversationDescriptor(store, broken);
  const original = store.read;
  store.read = async (type, id) => { if (type === 'product-remote-profile' && id === broken.roomId) throw new Error('storage temporarily unavailable'); return original(type, id); };
  const descriptors = await readConversationDescriptors(store);
  const index = await readConversationIndex(store, descriptors);
  expect(index.conversations).toHaveLength(2);
  expect(index.unavailable).toContainEqual({ roomId: broken.roomId, label: 'Bob', code: 'CONVERSATION_STATE_INCOMPLETE', state: 'local-incomplete' });
});

it.each(['NETWORK_FAILURE', 'CONVERSATION_RESTORE_FAILED', 'SERVICE_NOT_READY', 'CONVERSATION_STORAGE_UNAVAILABLE', 'CONVERSATION_MUX_SUBSCRIPTION_REJECTED'] as const)('keeps a failed %s room visible for retry, unlike authoritative deletion', async code => {
  const store = await valid();
  const index = await readConversationIndex(store, await readConversationDescriptors(store), async () => code);
  expect(index.conversations).toHaveLength(1);
  expect(index.unavailable).toEqual([conversationDiagnostic(descriptor, code)]);
  expect(authoritativeTerminal(code)).toBe(false);
  expect((await readConversationIndex(store, await readConversationDescriptors(store), async () => 'CONVERSATION_ROOM_MISSING')).conversations).toEqual([]);
});

it('distinguishes invalid local records and storage failures without altering verification', async () => {
  const store = await valid(); const before = await store.read('contact-identity', descriptor.remoteAddress);
  await store.put('conversation-protocol', room, { unexpected: true });
  expect(await conversationEligibility(store, descriptor)).toBe('CONVERSATION_LOCAL_RECORD_INVALID');
  const original = store.read; store.read = async (type, id) => { if (type === 'conversation-protocol') throw new Error('temporary storage failure'); return original(type, id); };
  expect(await conversationEligibility(store, descriptor)).toBe('CONVERSATION_STORAGE_UNAVAILABLE');
  expect(await store.read('contact-identity', descriptor.remoteAddress)).toEqual(before);
});

it('diagnoses orphans without reading message/session contents, excludes intentional removals and does no writes', async () => {
  const store = await valid(); const orphan = '00000000-0000-4000-8000-000000000001'; const removed = '00000000-0000-4000-8000-000000000002';
  await store.put('product-session', 'conversation-removals', [removed]);
  const before = [...store.records];
  const adapter = { read: store.read, write: jest.fn(store.write), listRecordIds: jest.fn(async () => ({ recordIds: [room, orphan, removed, 'invalid'], truncated: false })) };
  const read = jest.spyOn(adapter, 'read');
  expect(await diagnoseOrphanedConversationRecords(adapter)).toEqual({ roomIds: [orphan], truncated: false, available: true });
  expect(read.mock.calls.every(([type]) => type === 'product-session')).toBe(true);
  expect(adapter.write).not.toHaveBeenCalled(); expect([...store.records]).toEqual(before);
});
it('reports truncation when the union of orphan namespaces exceeds the display bound', async () => {
  const store = await valid();
  const listRecordIds = async (type: string) => ({ recordIds: Array.from({ length: 600 }, (_, index) => `00000000-0000-4000-8000-${String(index + (type === 'conversation-protocol' ? 1 : 601)).padStart(12, '0')}`), truncated: false });
  const result = await diagnoseOrphanedConversationRecords({ read: store.read, write: store.write, listRecordIds });
  expect(result.roomIds).toHaveLength(1000); expect(result.truncated).toBe(true);
});
it('missing canonical contact is quarantined; changed identity remains available for review without verification', async () => {
  const store = await valid(); store.records.delete('contact-identity:' + descriptor.remoteAddress);
  expect(await conversationEligibility(store, descriptor)).toBe('CONTACT_REGISTRY_MISSING');
  await store.put('contact-identity', descriptor.remoteAddress, { contactId: descriptor.remoteAddress, identityId: descriptor.remoteIdentityCommitment, algorithm: 'Olm-Curve25519+Ed25519', publicKey: 'AAAA', verification: 'unverified', changeStatus: 'changed-pending-review' });
  expect(await conversationEligibility(store, descriptor)).toBeUndefined();
});


it('local missing-contact diagnosis follows the room probe and never reaches the session read', async () => {
  const store = await valid();
  store.records.delete('contact-identity:' + descriptor.remoteAddress);
  const before = [...store.records];
  const read = jest.spyOn(store, 'read');
  let readsAtProbe = -1;
  const failure = await conversationEligibility(store, descriptor, async () => {
    readsAtProbe = read.mock.calls.length;
    return undefined;
  });
  expect(readsAtProbe).toBe(0);
  expect(failure).toBe('CONTACT_REGISTRY_MISSING');
  expect(read.mock.calls).toContainEqual(['contact-identity', descriptor.remoteAddress]);
  expect(read.mock.calls.some(([type]) => type === 'vodozemac-session')).toBe(false);
  expect([...store.records]).toEqual(before);
});

it('separates a post-eligibility prekey 404 from a missing canonical contact without changing records', async () => {
  const store = await valid();
  const before = [...store.records];
  const descriptors = await readConversationDescriptors(store);
  expect(await conversationEligibility(store, descriptor, async () => undefined)).toBeUndefined();
  // Models the real connect path: eligibility succeeded before the HTTP lookup failed.
  const code = classifySafeDiagnostic('conversation-open', Object.assign(new Error('Pre-key bundle unavailable'), { status: 404 }));
  expect(code).toBe('CONVERSATION_PREKEY_UNAVAILABLE');
  const diagnostic = conversationDiagnostic(descriptor, code);
  expect(diagnostic.state).toBe('retryable');
  expect(authoritativeTerminal(code)).toBe(false);
  const groups = classifySidebarConversations(descriptors, [diagnostic]);
  expect(groups.chats).toHaveLength(1);
  expect(groups.unavailable).toHaveLength(0);
  // Saved presentation does not grant connection authorization or mutate pinned trust.
  expect(await readConversationDescriptors(store)).toHaveLength(1);
  expect([...store.records]).toEqual(before);
});

it('maintenance and authorization failures occur before local lookup and do not delete or grant trust', async () => {
  const store = await valid(); const before = [...store.records];
  const read = jest.spyOn(store, 'read');
  for (const code of ['SERVICE_NOT_READY', 'VERIFICATION_REQUIRED', 'CONVERSATION_ROOM_MISSING'] as const) {
    expect(await conversationEligibility(store, descriptor, async () => code)).toBe(code);
  }
  expect(read).not.toHaveBeenCalled();
  expect([...store.records]).toEqual(before);
});


it.each(['CONVERSATION_PREKEY_UNAVAILABLE', 'NETWORK_FAILURE', 'SERVICE_NOT_READY'] as const)('retains established saved chats under %s without claiming a live session', async code => {
  const store = await valid(); const before = [...store.records];
  const restoredDescriptors = await readConversationDescriptors(store);
  const diagnostic = conversationDiagnostic(descriptor, code);
  const groups = classifySidebarConversations(restoredDescriptors, [diagnostic]);
  expect(groups.chats).toEqual(restoredDescriptors);
  expect(groups.unavailable).toHaveLength(0);
  expect(diagnostic.state).toBe('retryable');
  if (code === 'CONVERSATION_PREKEY_UNAVAILABLE') expect(conversationStateCopy(diagnostic)).toBe('Contact saved · reconnection paused');
  expect([...store.records]).toEqual(before);
});

it.each(['CONTACT_REGISTRY_MISSING', 'CONVERSATION_LOCAL_RECORD_INVALID', 'PINNED_IDENTITY_CHANGED', 'ROOM_MEMBERSHIP_MISMATCH', 'VERIFICATION_REQUIRED', 'CONVERSATION_ROOM_MISSING'] as const)('does not turn %s into an availability-only saved chat', async code => {
  const store = await valid(); const before = [...store.records];
  const groups = classifySidebarConversations(await readConversationDescriptors(store), [conversationDiagnostic(descriptor, code)]);
  expect(groups.chats).toHaveLength(0);
  expect(groups.unavailable).toHaveLength(1);
  expect([...store.records]).toEqual(before);
});

it('does not promote pending introductions or unbound descriptors after a remote error', () => {
  for (const entry of [{ ...descriptor, bootstrapState: 'PENDING_REMOTE' as const }, { ...descriptor, remoteIdentityCommitment: undefined }]) {
    const groups = classifySidebarConversations([entry], [conversationDiagnostic(entry, 'CONVERSATION_PREKEY_UNAVAILABLE')]);
    expect(groups.chats).toHaveLength(0); expect(groups.unavailable).toHaveLength(1);
  }
});

 it('three intact saved contacts can have zero orphan rooms while remote lookups fail', async () => {
  const store = await valid();
  const descriptors = [descriptor, {...descriptor, roomId:'22222222-2222-4222-8222-222222222222', label:'Fixture two'}, {...descriptor, roomId:'33333333-3333-4333-8333-333333333333', label:'Fixture three'}];
  for (const item of descriptors.slice(1)) {
    await saveConversationDescriptor(store, item);
    await store.put('conversation-protocol', item.roomId, {version:1,mode:'modern',localAddress:'self',remoteAddress:item.remoteAddress,routingProof:'b'.repeat(43),sessionId:'session'});
    await store.write('vodozemac-session',item.roomId,new Uint8Array([1]).buffer);
  }
  const listRecordIds = async () => ({recordIds:descriptors.map(item=>item.roomId),truncated:false});
  expect(await diagnoseOrphanedConversationRecords({read:store.read,write:store.write,listRecordIds})).toEqual({roomIds:[],truncated:false,available:true});
  for (const item of descriptors) expect(await conversationEligibility(store,item)).toBeUndefined();
  const failures = descriptors.map(item=>conversationDiagnostic(item,classifySafeDiagnostic('conversation-open',Object.assign(new Error('Pre-key bundle unavailable'),{status:404}))));
  const groups=classifySidebarConversations(descriptors,failures);
  expect(groups.chats).toHaveLength(3); expect(groups.unavailable).toHaveLength(0);
  store.records.delete('contact-identity:'+descriptor.remoteAddress);
  expect(await conversationEligibility(store,descriptor)).toBe('CONTACT_REGISTRY_MISSING');
  expect((await diagnoseOrphanedConversationRecords({read:store.read,write:store.write,listRecordIds})).roomIds).toHaveLength(0);
});
describe('opening a saved conversation does not depend on the network', () => {
  it('local eligibility passes while the server is unreachable; only a probe would have failed the open', async () => {
    const store = await valid();
    const offlineProbe = jest.fn(async () => 'NETWORK_FAILURE' as const);
    // The old open path passed the probe into eligibility and was rejected when the server was cold/offline.
    expect(await conversationEligibility(store, descriptor, offlineProbe)).toBe('NETWORK_FAILURE');
    // The open path now decides on local records alone.
    expect(await conversationEligibility(store, descriptor)).toBeUndefined();
  });

  it('reports only authoritative expiry or deletion from the background probe', async () => {
    const seen: string[] = [];
    for (const code of ['CONVERSATION_ROOM_MISSING', 'CONVERSATION_INVITATION_EXPIRED'] as const) {
      await observeAuthoritativeRoomState(descriptor, async () => code, value => seen.push(value));
    }
    for (const code of ['NETWORK_FAILURE', 'SERVICE_NOT_READY', 'VERIFICATION_REQUIRED', undefined] as const) {
      await observeAuthoritativeRoomState(descriptor, async () => code, value => seen.push(value));
    }
    expect(seen).toEqual(['CONVERSATION_ROOM_MISSING', 'CONVERSATION_INVITATION_EXPIRED']);
  });

  it('swallows probe exceptions without disturbing the open and does not mutate stored records', async () => {
    const store = await valid(); const before = [...store.records];
    await expect(observeAuthoritativeRoomState(descriptor, async () => { throw new Error('boom'); }, () => { throw new Error('unexpected'); })).resolves.toBeUndefined();
    expect([...store.records]).toEqual(before);
  });
});

it('does not apply delayed terminal observations after selection, identity, descriptor, admission or teardown changes', async () => {
  const scope = {}; const started = {operation:1, scope, descriptor};
  const current = {...started, aborted:false, connected:false};
  expect(roomObservationCurrent(started,current)).toBe(true);
  for (const change of [{operation:2},{scope:{}},{descriptor:{}},{connected:true},{aborted:true}]) {
    let finish!: (code: 'CONVERSATION_ROOM_MISSING') => void;
    let now: Parameters<typeof roomObservationCurrent>[1] = current; const terminal = jest.fn();
    const pending = observeAuthoritativeRoomState(descriptor, () => new Promise(resolve => { finish=resolve; }), terminal, () => roomObservationCurrent(started,now));
    now = {...current,...change}; finish('CONVERSATION_ROOM_MISSING'); await pending;
    expect(terminal).not.toHaveBeenCalled();
  }
});
