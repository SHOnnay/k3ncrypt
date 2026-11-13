import { keepKnownRooms, readUnread, sanitizeUnread, writeUnread } from './unreadStore';
import type { ProductSecureStorage } from './sessionStore';

const room = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const vault = () => {
  const records = new Map<string, ArrayBuffer>();
  const storage: ProductSecureStorage = {
    read: async (type, id) => records.get(`${type}\0${id}`)?.slice(0),
    write: async (type, id, value) => { records.set(`${type}\0${id}`, value.slice(0)); },
  };
  return { storage, records };
};

describe('unread counts in the vault', () => {
  it('survives a reload: what was written is what a fresh read returns', async () => {
    const { storage, records } = vault();
    expect(await readUnread(storage)).toEqual({});
    await writeUnread(storage, { [room(1)]: 3, [room(2)]: 1 });
    expect(await readUnread(storage)).toEqual({ [room(1)]: 3, [room(2)]: 1 });
    expect([...records.keys()]).toEqual(['product-unread\0all']);
    await writeUnread(storage, {});
    expect(await readUnread(storage)).toEqual({});
  });

  it('ignores anything that is not a positive count for a real chat id, and caps values', () => {
    expect(sanitizeUnread({ [room(1)]: 5000, [room(2)]: 0, [room(3)]: -1, [room(4)]: 1.5, [room(5)]: '2', nope: 2 })).toEqual({ [room(1)]: 999 });
    for (const value of [null, 'x', 3, [1]]) expect(sanitizeUnread(value)).toEqual({});
  });

  it('reads a damaged record as empty instead of failing', async () => {
    const { storage } = vault();
    await storage.write('product-unread', 'all', new TextEncoder().encode('{not json').buffer as ArrayBuffer);
    expect(await readUnread(storage)).toEqual({});
  });

  it('drops counts for chats that no longer exist and keeps the same object when nothing changes', () => {
    const counts = { [room(1)]: 2, [room(2)]: 4 };
    expect(keepKnownRooms(counts, [room(1)])).toEqual({ [room(1)]: 2 });
    expect(keepKnownRooms(counts, [room(1), room(2), room(3)])).toBe(counts);
  });
});
