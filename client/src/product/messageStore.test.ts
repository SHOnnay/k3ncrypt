import { mergeAndPersistMessages, prepareMessageRecordUpdate, readMessages, writeMessages } from './messageStore';
import type { ProductSecureStorage } from './sessionStore';

class MemoryStore implements ProductSecureStorage {
  value?: ArrayBuffer;
  read = async () => this.value?.slice(0);
  write = async (_type: string, _id: string, value: ArrayBuffer) => { this.value = value.slice(0); };
  compareAndSwapRecords = async (updates: readonly { expected: ArrayBuffer | undefined; next: ArrayBuffer }[]) => {
    if (updates.some(({ expected }) => (this.value === undefined) !== (expected === undefined) ||
      (this.value && expected && !Buffer.from(this.value).equals(Buffer.from(expected))))) return false;
    this.value = updates[0].next.slice(0);
    return true;
  };
}

it('restores message history from the encrypted product record', async () => {
  const store = new MemoryStore();
  await writeMessages(store, 'room', [{ id: 'message-1', sender: 'alice', text: 'hello', type: 'sent', timestamp: new Date('2026-01-01T00:00:00Z'), delivery: 'accepted' }]);
  const restored = await readMessages(store, 'room');
  expect(restored[0]).toMatchObject({ id: 'message-1', text: 'hello', delivery: 'accepted' });
  expect(restored[0].timestamp).toEqual(new Date('2026-01-01T00:00:00Z'));
});

it('prepares inbound persistence atomically and merges stale React snapshots without deleting it', async () => {
  const store = new MemoryStore();
  const incoming = { id: 'envelope-digest', sender: 'contact', text: 'hello', type: 'received' as const, timestamp: new Date('2026-01-01T00:00:00Z') };
  const update = await prepareMessageRecordUpdate(store, 'room', incoming);
  await expect(store.compareAndSwapRecords!([update])).resolves.toBe(true);
  await mergeAndPersistMessages(store, 'room', []);
  await expect(readMessages(store, 'room')).resolves.toMatchObject([{ id: 'envelope-digest', text: 'hello' }]);
});
