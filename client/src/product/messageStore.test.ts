import { readMessages, writeMessages } from './messageStore';
import type { ProductSecureStorage } from './sessionStore';

class MemoryStore implements ProductSecureStorage {
  value?: ArrayBuffer;
  read = async () => this.value?.slice(0);
  write = async (_type: string, _id: string, value: ArrayBuffer) => { this.value = value.slice(0); };
}

it('restores message history from the encrypted product record', async () => {
  const store = new MemoryStore();
  await writeMessages(store, 'room', [{ id: 'message-1', sender: 'alice', text: 'hello', type: 'sent', timestamp: new Date('2026-01-01T00:00:00Z'), delivery: 'accepted' }]);
  const restored = await readMessages(store, 'room');
  expect(restored[0]).toMatchObject({ id: 'message-1', text: 'hello', delivery: 'accepted' });
  expect(restored[0].timestamp).toEqual(new Date('2026-01-01T00:00:00Z'));
});
