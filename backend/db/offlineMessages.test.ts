import { ackOfflineMessage, claimOfflineMessage, cleanupExpiredOfflineMessages, countOfflineMessages, storeOfflineMessage } from './index';
import { randomUUID } from 'crypto';

describe('opaque offline message mailbox', () => {
  const base = () => ({ id: randomUUID(), dedupeKey: `dedupe-${randomUUID()}`, channel: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mailbox: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sender: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'ciphertext' } }, timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000) });

  it('deduplicates submissions, claims once, and removes only on ACK', async () => {
    const message = base();
    const first = await storeOfflineMessage(message);
    const duplicate = await storeOfflineMessage({ ...message, id: randomUUID() });
    expect(duplicate.id).toBe(first.id);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(1);
    expect(await claimOfflineMessage(message.mailbox, message.channel, new Date(Date.now() + 30_000))).toEqual(expect.objectContaining({ id: message.id }));
    expect(await claimOfflineMessage(message.mailbox, message.channel, new Date(Date.now() + 30_000))).toBeFalsy();
    expect(await ackOfflineMessage(message.id, message.mailbox, message.channel)).toBe(true);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
  });

  it('expires abandoned ciphertext without inspecting its contents', async () => {
    const message = { ...base(), expiresAt: new Date(Date.now() - 1) };
    await storeOfflineMessage(message);
    expect(cleanupExpiredOfflineMessages()).toBeGreaterThanOrEqual(1);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
  });
});
