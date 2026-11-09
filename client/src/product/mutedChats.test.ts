import { readMutedChats, setChatMuted } from './mutedChats';
import type { ProductSecureStorage } from './sessionStore';

const memoryStorage = () => {
  const records = new Map<string, ArrayBuffer>();
  const storage: ProductSecureStorage = { read: async (t, id) => records.get(`${t}/${id}`), write: async (t, id, value) => { records.set(`${t}/${id}`, value); } };
  return { storage, records };
};

describe('N1 per-chat mute store [unit test]', () => {
  it('starts empty, mutes and unmutes through the encrypted storage boundary', async () => {
    const { storage, records } = memoryStorage();
    expect(await readMutedChats(storage)).toEqual([]);
    expect(await setChatMuted(storage, 'room-a', true)).toEqual(['room-a']);
    expect(await setChatMuted(storage, 'room-a', true)).toEqual(['room-a']);
    expect(await setChatMuted(storage, 'room-b', true)).toEqual(['room-a', 'room-b']);
    expect(await readMutedChats(storage)).toEqual(['room-a', 'room-b']);
    expect(await setChatMuted(storage, 'room-a', false)).toEqual(['room-b']);
    expect([...records.keys()]).toEqual(['product-muted-chats/all']);
  });
  it('seeds from the old plain preference list once, then the encrypted record wins', async () => {
    const { storage } = memoryStorage();
    expect(await readMutedChats(storage, ['old'])).toEqual(['old']);
    await setChatMuted(storage, 'new', true, ['old']);
    expect(await readMutedChats(storage, ['stale'])).toEqual(['old', 'new']);
  });
  it('reads a damaged record as empty instead of failing', async () => {
    const { storage } = memoryStorage();
    await storage.write('product-muted-chats', 'all', new TextEncoder().encode('{not json').buffer as ArrayBuffer);
    expect(await readMutedChats(storage, ['old'])).toEqual([]);
  });
});
