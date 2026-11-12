import { drainRemovalOutbox, purgeProductRecords, REMOVAL_ABANDON_MS } from './contactRemoval';
import { readConversationDescriptors, readRemovalOutbox, readRemovedRooms, removeConversationDescriptor, saveConversationDescriptor, type ConversationDescriptor, type ProductSecureStorage } from './sessionStore';

/** Minimal vault double with the same compare-and-swap contract as the real one. */
const vault = () => {
  const records = new Map<string, ArrayBuffer>();
  const key = (type: string, id: string) => `${type}\0${id}`;
  const same = (left: ArrayBuffer | undefined, right: ArrayBuffer | undefined) => left === undefined || right === undefined ? left === right
    : Buffer.from(left).equals(Buffer.from(right));
  const storage: ProductSecureStorage & { delete(type: string, id: string): Promise<void>; records: Map<string, ArrayBuffer> } = {
    records,
    read: async (type, id) => records.get(key(type, id))?.slice(0),
    write: async (type, id, value) => { records.set(key(type, id), value.slice(0)); },
    delete: async (type, id) => { records.delete(key(type, id)); },
    compareAndSwapRecords: async (updates) => {
      if (!updates.every(update => same(records.get(key(update.recordType, update.recordId)), update.expected))) return false;
      for (const update of updates) records.set(key(update.recordType, update.recordId), update.next.slice(0));
      return true;
    },
  };
  return storage;
};
const room = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const descriptor = (n: number): ConversationDescriptor => ({ version: 1, relationship: 'accepted', roomId: room(n), controlCapability: 'c'.repeat(43), label: `Contact ${n}`, updatedAt: n });
const pending = (n: number) => ({ controlCapability: 'c'.repeat(43), address: `10000000-0000-4000-8000-00000000000${n}`, routingProof: 'p'.repeat(43) });

describe('remove contact: tombstone and relay notice', () => {
  it('writes the tombstone and the queued relay notice together, and the chat can never be saved again', async () => {
    const storage = vault();
    await saveConversationDescriptor(storage, descriptor(1)); await saveConversationDescriptor(storage, descriptor(2));
    await removeConversationDescriptor(storage, room(1), pending(1));
    expect((await readConversationDescriptors(storage, false)).map(item => item.roomId)).toEqual([room(2)]);
    expect(await readRemovedRooms(storage)).toEqual([room(1)]);
    expect(await readRemovalOutbox(storage)).toEqual([expect.objectContaining({ version: 1, roomId: room(1), ...pending(1) })]);
    await expect(saveConversationDescriptor(storage, descriptor(1))).rejects.toMatchObject({ safeDiagnosticCode: 'CONVERSATION_REMOVED' });
  });

  it('a failed transaction leaves neither a tombstone nor a queued notice', async () => {
    const storage = vault();
    await saveConversationDescriptor(storage, descriptor(1));
    storage.compareAndSwapRecords = async () => false;
    await expect(removeConversationDescriptor(storage, room(1), pending(1))).rejects.toBeDefined();
    expect(await readRemovedRooms(storage)).toEqual([]); expect(await readRemovalOutbox(storage)).toEqual([]);
    expect(await readConversationDescriptors(storage, false)).toHaveLength(1);
  });

  it('keeps a notice until the relay confirms it, across failures and restarts', async () => {
    const storage = vault();
    for (const n of [1, 2, 3]) { await saveConversationDescriptor(storage, descriptor(n)); await removeConversationDescriptor(storage, room(n), pending(n)); }
    const offline = jest.fn(async () => { throw new Error('network'); });
    expect(await drainRemovalOutbox(storage, offline)).toBe(3);
    expect(offline).toHaveBeenCalledTimes(3);
    const mixed = jest.fn(async (entry: { roomId: string }) => {
      if (entry.roomId === room(1)) return 'revoked' as const;
      if (entry.roomId === room(2)) return 'gone' as const;
      throw Object.assign(new Error('denied'), { status: 403 });
    });
    expect(await drainRemovalOutbox(storage, mixed)).toBe(1);
    expect((await readRemovalOutbox(storage)).map(item => item.roomId)).toEqual([room(3)]);
    expect(await readRemovedRooms(storage)).toEqual([room(1), room(2), room(3)]);
    expect(await drainRemovalOutbox(storage, async () => 'revoked')).toBe(0);
  });

  it('runs one drain at a time and abandons a notice only after 30 days', async () => {
    const storage = vault();
    await saveConversationDescriptor(storage, descriptor(1)); await removeConversationDescriptor(storage, room(1), pending(1));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = jest.fn(async () => { await gate; throw new Error('network'); });
    const first = drainRemovalOutbox(storage, slow), second = drainRemovalOutbox(storage, slow);
    expect(second).toBe(first); release(); expect(await first).toBe(1); expect(slow).toHaveBeenCalledTimes(1);
    const never = jest.fn(async () => { throw new Error('network'); });
    expect(await drainRemovalOutbox(storage, never, () => Date.now() + REMOVAL_ABANDON_MS - 60_000)).toBe(1);
    expect(await drainRemovalOutbox(storage, never, () => Date.now() + REMOVAL_ABANDON_MS + 60_000)).toBe(0);
    expect(never).toHaveBeenCalledTimes(1);
    expect(await readRemovedRooms(storage)).toEqual([room(1)]);
  });

  it('ignores a malformed outbox record and purges only the removed chat\'s saved records', async () => {
    const storage = vault();
    await storage.write('product-session', 'removal-outbox', new TextEncoder().encode(JSON.stringify([{ roomId: room(1) }, 'x'])).buffer as ArrayBuffer);
    expect(await readRemovalOutbox(storage)).toEqual([]);
    const bytes = new Uint8Array([1]).buffer as ArrayBuffer;
    for (const type of ['product-messages', 'product-message-quarantine', 'product-file-details', 'product-remote-profile']) { await storage.write(type, room(1), bytes); await storage.write(type, room(2), bytes); }
    await purgeProductRecords(storage, room(1));
    expect([...storage.records.keys()].filter(item => item.endsWith(room(1)))).toEqual([]);
    expect([...storage.records.keys()].filter(item => item.endsWith(room(2)))).toHaveLength(4);
  });
});
