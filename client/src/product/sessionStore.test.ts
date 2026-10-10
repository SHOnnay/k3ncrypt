import { readConversationDescriptors, removeConversationDescriptor, saveConversationDescriptor, updateConversationDescriptor } from './sessionStore';
import { TestProductStorage } from './testStorage';

class MemoryStore extends TestProductStorage {
  corrupt(value: string): void { this.records.set('product-session:conversations', new TextEncoder().encode(value).buffer as ArrayBuffer); }
}

const descriptor = (roomId: string, updatedAt: number) => ({
  version: 1 as const,
  roomId,
  controlCapability: 'a'.repeat(43),
  remoteAddress: 'remote-address-value',
  label: 'Private contact',
  updatedAt,
});

it('preserves independent field updates, bindings, established state and unknown stored fields', async () => {
  const store = new MemoryStore(); const initial = { ...descriptor('00000000-0000-4000-8000-000000000001', 1), bootstrapState: 'ESTABLISHED' as const, relationship: 'accepted' as const };
  const signedInvitation = { version: 2, retainedSignature: 'fixture-only' };
  await store.put('product-session', 'conversations', [{ ...initial, signedInvitation, verificationContext: { retained: true } }]);
  await Promise.all([updateConversationDescriptor(store, initial.roomId, { label: 'Alice', localNickname: 'Family' }), updateConversationDescriptor(store, initial.roomId, { bootstrapState: 'PENDING_LOCAL' })]);
  const [saved] = await readConversationDescriptors(store);
  expect(saved).toMatchObject({ label: 'Alice', localNickname: 'Family', controlCapability: initial.controlCapability, bootstrapState: 'ESTABLISHED', relationship: 'accepted' });
  expect(JSON.parse(new TextDecoder().decode(await store.read('product-session', 'conversations')))[0].verificationContext).toEqual({ retained: true });
  expect(saved.signedInvitation).toEqual(signedInvitation);
  await expect(saveConversationDescriptor(store, { ...saved, controlCapability: 'b'.repeat(43) })).rejects.toMatchObject({ safeDiagnosticCode: 'ROOM_MEMBERSHIP_MISMATCH' });
  await expect(updateConversationDescriptor(store, initial.roomId, { remoteIdentityCommitment: 'K3 ' + 'B'.repeat(43) })).rejects.toMatchObject({ safeDiagnosticCode: 'ROOM_MEMBERSHIP_MISMATCH' });
  await expect(updateConversationDescriptor(store, initial.roomId, { remoteAddress: undefined })).rejects.toMatchObject({ safeDiagnosticCode: 'ROOM_MEMBERSHIP_MISMATCH' });
});

it('never resurrects a removed room, including a stale writer and a newly unlocked adapter', async () => {
  const store = new MemoryStore(); const initial = descriptor('00000000-0000-4000-8000-000000000001', 1);
  await saveConversationDescriptor(store, initial);
  await Promise.allSettled([removeConversationDescriptor(store, initial.roomId), updateConversationDescriptor(store, initial.roomId, { label: 'Stale update' })]);
  await expect(saveConversationDescriptor(store, initial)).rejects.toMatchObject({ safeDiagnosticCode: 'CONVERSATION_REMOVED' });
  expect(await readConversationDescriptors(store)).toEqual([]);
});

it('fails explicitly on missing atomic support, exhaustion, and preserves malformed source bytes', async () => {
  const store = new MemoryStore(); const initial = descriptor('00000000-0000-4000-8000-000000000001', 1);
  await expect(saveConversationDescriptor({ read: store.read, write: store.write }, initial)).rejects.toMatchObject({ safeDiagnosticCode: 'CONVERSATION_STORAGE_UNAVAILABLE' });
  store.compareAndSwapRecords = async () => false;
  await expect(saveConversationDescriptor(store, initial)).rejects.toMatchObject({ safeDiagnosticCode: 'CONVERSATION_STORAGE_CONFLICT' });
  store.corrupt('{malformed'); const before = await store.read('product-session', 'conversations');
  await expect(saveConversationDescriptor(store, initial)).rejects.toThrow();
  expect(await store.read('product-session', 'conversations')).toEqual(before);
});

it('executes 1200 seeded competing saves, field updates and removals without unexplained loss', async () => {
  const store = new MemoryStore(); let seed = 104729; let operations = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const expected = new Map<string, { label: string; localNickname: string }>();
  for (let round = 0; round < 100; round++) {
    const rooms = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-${String(round * 4 + i + 1).padStart(12, '0')}`);
    await Promise.all(rooms.map(roomId => saveConversationDescriptor(store, descriptor(roomId, round)))); operations += 4;
    const labels = rooms.map(() => `Label ${Math.floor(random() * 100000)}`);
    const nicknames = rooms.map(() => `Nickname ${Math.floor(random() * 100000)}`);
    const removed = Math.floor(random() * rooms.length);
    const jobs = rooms.flatMap((roomId, i) => i === removed
      ? [removeConversationDescriptor(store, roomId), updateConversationDescriptor(store, roomId, { label: labels[i] }).catch(error => { expect(error.safeDiagnosticCode).toBe('CONVERSATION_REMOVED'); })]
      : [updateConversationDescriptor(store, roomId, { label: labels[i] }), updateConversationDescriptor(store, roomId, { localNickname: nicknames[i] })]);
    jobs.sort(() => random() - 0.5); await Promise.all(jobs); operations += 8;
    rooms.forEach((roomId, i) => { if (i !== removed) expected.set(roomId, { label: labels[i], localNickname: nicknames[i] }); });
    const saved = await readConversationDescriptors(store);
    expect(saved).toHaveLength(expected.size);
    for (const item of saved) expect(item).toMatchObject({ ...expected.get(item.roomId), controlCapability: 'a'.repeat(43), remoteAddress: 'remote-address-value' });
    expect(saved.some(item => item.roomId === rooms[removed])).toBe(false);
  }
  expect(operations).toBe(1200);
}, 30000);

describe('encrypted product session records', () => {
  it('restores ordered conversations and replaces an existing room without duplication', async () => {
    const store = new MemoryStore();
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000001', 1));
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000002', 2));
    await saveConversationDescriptor(store, { ...descriptor('00000000-0000-4000-8000-000000000001', 3), label: 'Updated' });
    const restored = await readConversationDescriptors(store);
    expect(restored.map((item) => item.label)).toEqual(['Updated', 'Private contact']);
  });

  it('rejects corrupted or security-incomplete saved state', async () => {
    const store = new MemoryStore();
    store.corrupt(JSON.stringify([{ version: 1, roomId: 'fake', controlCapability: '', label: '', updatedAt: -1 }]));
    await expect(readConversationDescriptors(store)).resolves.toEqual([]);
  });

  it('removes only the selected conversation', async () => {
    const store = new MemoryStore();
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000001', 1));
    await saveConversationDescriptor(store, descriptor('00000000-0000-4000-8000-000000000002', 2));
    const remaining = await removeConversationDescriptor(store, '00000000-0000-4000-8000-000000000002');
    expect(remaining.map((item) => item.roomId)).toEqual(['00000000-0000-4000-8000-000000000001']);
  });
});
