import { prepareMessageAcceptance, readMessages, writeMessages } from './messageStore';
import type { ProductSecureStorage } from './sessionStore';

class MemoryStore implements ProductSecureStorage {
  private readonly values = new Map<string, ArrayBuffer>();
  read = async (type: string, id: string) => this.values.get(`${type}:${id}`)?.slice(0);
  write = async (type: string, id: string, value: ArrayBuffer) => { this.values.set(`${type}:${id}`, value.slice(0)); };
  compareAndSwapRecords = async (updates: readonly { recordType: string; recordId: string; expected: ArrayBuffer | undefined; next: ArrayBuffer }[]) => {
    if (updates.some((item) => {
      const old = this.values.get(`${item.recordType}:${item.recordId}`);
      return old === undefined ? item.expected !== undefined : item.expected === undefined || Buffer.compare(Buffer.from(old), Buffer.from(item.expected)) !== 0;
    })) return false;
    for (const item of updates) this.values.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
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

it('does not let stale UI history erase an atomically accepted inbound M1 message', async () => {
  const store = new MemoryStore();
  const staleProjection = [{ id: 'outbound', sender: 'me', text: 'sent', type: 'sent' as const, timestamp: new Date('2026-01-01T00:00:00Z'), delivery: 'pending' as const }];
  const accepted = { id: 'v1:accepted', sender: 'contact', text: 'received', type: 'received' as const, timestamp: new Date('2026-01-02T00:00:00Z') };
  const update = await prepareMessageAcceptance(store, 'room', accepted);
  expect(await store.compareAndSwapRecords!([update])).toBe(true);

  await writeMessages(store, 'room', staleProjection);
  await expect(readMessages(store, 'room')).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'outbound', text: 'sent' }),
    expect.objectContaining({ id: 'v1:accepted', text: 'received' }),
  ]));
});

it('quarantines one invalid history entry atomically and restores the valid room messages', async () => {
  const store = new MemoryStore();
  const valid = { id: 'kept-message', sender: 'alice', text: 'kept safely', type: 'sent', timestamp: '2026-01-01T00:00:00.000Z', delivery: 'accepted' };
  const invalid = { id: 'bad-message', sender: 'alice', text: 42, type: 'sent', timestamp: 'not-a-date' };
  await store.write('product-messages', 'room', new TextEncoder().encode(JSON.stringify([valid, invalid])).buffer as ArrayBuffer);

  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const restored = await readMessages(store, 'room');
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({ id: 'kept-message', text: 'kept safely' });
  expect(await readMessages(store, 'room')).toHaveLength(1);
  const repaired = JSON.parse(new TextDecoder().decode(new Uint8Array((await store.read('product-messages', 'room'))!)));
  const quarantine = JSON.parse(new TextDecoder().decode(new Uint8Array((await store.read('product-message-quarantine', 'room'))!)));
  expect(repaired).toHaveLength(1);
  expect(quarantine).toMatchObject({ version: 1, entries: [{ index: 1, value: invalid, reason: 'invalid-message-entry' }] });
  expect(warn).toHaveBeenCalledWith('[K3NCRYPT]', { event: 'conversation_open_failed', reason: 'MESSAGE_HISTORY_ENTRY_QUARANTINED' });
  warn.mockRestore();
});
