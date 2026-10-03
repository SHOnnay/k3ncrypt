import type { Message } from '../types';
import type { ProductSecureStorage } from './sessionStore';
import { prepareMessageAcceptance, prepareMessageDeliveryUpdate, readMessages, writeMessages } from './messageStore';
interface SecureRecordUpdate { recordType: string; recordId: string; expected: ArrayBuffer | undefined; next: ArrayBuffer; }

class MemoryProductStorage implements ProductSecureStorage {
  readonly records = new Map<string, ArrayBuffer>();
  async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`)?.slice(0); }
  async write(type: string, id: string, value: ArrayBuffer): Promise<void> { this.records.set(`${type}:${id}`, value.slice(0)); }
  async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
    if (updates.some((item) => !same(this.records.get(`${item.recordType}:${item.recordId}`), item.expected))) return false;
    for (const item of updates) this.records.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
    return true;
  }
}

const same = (left: ArrayBuffer | undefined, right: ArrayBuffer | undefined): boolean => {
  if (left === undefined || right === undefined) return left === right;
  return Buffer.from(left).equals(Buffer.from(right));
};
const message = (id: string, text: string, delivery?: Message['delivery']): Message => ({
  id, sender: 'contact', text, type: 'received', timestamp: new Date('2026-01-01T00:00:00.000Z'), ...(delivery ? { delivery } : {}),
});

describe('atomic product message acceptance', () => {
  it('prepares an idempotent local history update for the envelope identity', async () => {
    const storage = new MemoryProductStorage();
    const accepted = message('v1:abc', 'accepted body');
    const first = await prepareMessageAcceptance(storage, 'room-a', accepted);
    expect(first).toMatchObject({ recordType: 'product-messages', recordId: 'room-a', expected: undefined });
    expect(await storage.compareAndSwapRecords([first])).toBe(true);
    const repeated = await prepareMessageAcceptance(storage, 'room-a', accepted);
    expect(await storage.compareAndSwapRecords([repeated])).toBe(true);
    expect(await readMessages(storage, 'room-a')).toEqual([accepted]);
  });

  it('merges a stale React projection without erasing an atomically accepted message', async () => {
    const storage = new MemoryProductStorage();
    const inbound = message('v1:inbound', 'new inbound');
    const update = await prepareMessageAcceptance(storage, 'room-a', inbound);
    expect(await storage.compareAndSwapRecords([update])).toBe(true);
    await writeMessages(storage, 'room-a', [message('local-old', 'older UI snapshot')]);
    expect((await readMessages(storage, 'room-a')).map(({ id }) => id)).toEqual(['v1:inbound', 'local-old']);
  });

  it('does not regress a delivery state from accepted to a stale pending snapshot', async () => {
    const storage = new MemoryProductStorage();
    await writeMessages(storage, 'room-a', [message('outbound', 'hello', 'accepted')]);
    await writeMessages(storage, 'room-a', [message('outbound', 'hello', 'pending')]);
    expect((await readMessages(storage, 'room-a'))[0].delivery).toBe('accepted');
  });

  it('persists accepted delivery monotonically and leaves missing history untouched', async () => {
    const storage = new MemoryProductStorage();
    const outbound: Message = { ...message('outbound', 'hello', 'pending'), sender: 'me', type: 'sent' };
    const created = await prepareMessageAcceptance(storage, 'room-a', outbound);
    expect(await storage.compareAndSwapRecords([created])).toBe(true);

    const accepted = await prepareMessageDeliveryUpdate(storage, 'room-a', outbound.id, 'accepted');
    expect(accepted).toBeDefined();
    expect(await storage.compareAndSwapRecords([accepted!])).toBe(true);
    expect((await readMessages(storage, 'room-a'))[0]).toMatchObject({ id: 'outbound', text: 'hello', delivery: 'accepted' });
    expect(await prepareMessageDeliveryUpdate(storage, 'room-a', outbound.id, 'pending')).toBeUndefined();
    expect(await prepareMessageDeliveryUpdate(storage, 'room-a', 'unknown', 'accepted')).toBeUndefined();
  });
});
