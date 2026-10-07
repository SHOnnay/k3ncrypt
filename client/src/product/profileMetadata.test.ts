import { encodeProfileMessage, decodeProfileMessage, normalizeDisplayName, prepareProfileAcceptance, readRemoteProfile, PROFILE_PREFIX } from './profileMetadata';
import { readConversationDescriptors, saveConversationDescriptor, type ProductSecureStorage } from './sessionStore';
import { contactDisplayName } from '../content/copy';

class Store implements ProductSecureStorage {
  readonly records = new Map<string, ArrayBuffer>();
  async read(type: string, id: string) { return this.records.get(type + id)?.slice(0); }
  async write(type: string, id: string, value: ArrayBuffer) { this.records.set(type + id, value.slice(0)); }
}
const peer = 'K3 ' + 'A'.repeat(43);
const other = 'K3 ' + 'B'.repeat(43);
const room = '11111111-1111-4111-8111-111111111111';
const message = (displayName: string, revision = 1, identityFingerprint = peer) => encodeProfileMessage({ version: 1, displayName, revision, identityFingerprint });
const accept = async (store: Store, value: string, pinned = peer) => {
  for (const update of await prepareProfileAcceptance(store, room, value, pinned)) await store.write(update.recordType, update.recordId, update.next!);
};

describe('encrypted relationship profile metadata', () => {
  it('bounds UTF-8, rejects controls, and treats names as text', () => {
    expect(normalizeDisplayName('  Onnay   Khan ')).toBe('Onnay Khan');
    expect(normalizeDisplayName('<b>Onnay</b>')).toBe('<b>Onnay</b>');
    expect(() => normalizeDisplayName('😀'.repeat(41))).toThrow();
    expect(() => normalizeDisplayName('A\u202eB')).toThrow();
    expect(() => normalizeDisplayName('A\nB')).toThrow();
  });
  it('accepts a current pinned profile, updates it, and ignores older/foreign/unknown controls', async () => {
    const store = new Store();
    await accept(store, message('Onnay', 2));
    await accept(store, message('New Onnay', 3));
    await accept(store, message('Stale', 1));
    await accept(store, message('Foreign', 4, other));
    await accept(store, PROFILE_PREFIX + '{"version":2,"displayName":"Future"}');
    expect((await readRemoteProfile(store, room, peer))?.displayName).toBe('New Onnay');
    expect(await readRemoteProfile(store, room, other)).toBeUndefined();
    expect(decodeProfileMessage('ordinary message')).toBeUndefined();
    expect(await prepareProfileAcceptance(store, room, message('X'), undefined)).toEqual([]);
  });
  it('keeps nicknames above remote claims, drops stale identity claims, and never edits trust records', async () => {
    const store = new Store();
    const trust = new TextEncoder().encode('verified authority').buffer as ArrayBuffer;
    await store.write('contact-identity', 'peer', trust);
    await saveConversationDescriptor(store, { version: 1, roomId: room, controlCapability: 'a'.repeat(43), remoteIdentityCommitment: peer, label: 'Private contact', updatedAt: 1 });
    await accept(store, message('Onnay'));
    let [contact] = await readConversationDescriptors(store);
    expect(contactDisplayName(contact.label, room, contact.remoteDisplayName)).toBe('Onnay');
    await saveConversationDescriptor(store, { ...contact, label: 'My brother' });
    await accept(store, message('Changed name', 2));
    [contact] = await readConversationDescriptors(store);
    expect(contactDisplayName(contact.label, room, contact.remoteDisplayName)).toBe('My brother');
    expect(await store.read('contact-identity', 'peer')).toEqual(trust);
    expect(contactDisplayName('Private contact', room, 'Same name')).toBe(contactDisplayName('Private contact', 'other-room', 'Same name'));
    await saveConversationDescriptor(store, { ...contact, label: 'Private contact', remoteIdentityCommitment: other });
    expect((await readConversationDescriptors(store))[0].remoteDisplayName).toBeUndefined();
  });
});

it('hides a claimed name when canonical authority reports identity change', async () => {
  const store = new Store(); const address = 'peer-address';
  await store.write('contact-identity', address, new TextEncoder().encode(JSON.stringify({ identityId: peer, changeStatus: 'unchanged' })).buffer as ArrayBuffer);
  await saveConversationDescriptor(store, { version: 1, roomId: room, controlCapability: 'a'.repeat(43), remoteAddress: address, remoteIdentityCommitment: peer, label: 'Private contact', localNickname: 'Family', updatedAt: 1 });
  await accept(store, message('Onnay'));
  expect((await readConversationDescriptors(store))[0].remoteDisplayName).toBe('Onnay');
  await store.write('contact-identity', address, new TextEncoder().encode(JSON.stringify({ identityId: peer, changeStatus: 'changed-pending-review' })).buffer as ArrayBuffer);
  const [contact] = await readConversationDescriptors(store);
  expect(contact.remoteDisplayName).toBeUndefined();
  expect(contactDisplayName(contact.label, room, contact.remoteDisplayName, contact.localNickname)).toBe('Family');
});
