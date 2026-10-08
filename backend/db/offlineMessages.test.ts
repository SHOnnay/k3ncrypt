import { ackOfflineMessage, claimOfflineMessage, cleanupExpiredOfflineMessages, countOfflineMessages, recordOfflineRejection, rejectOfflineMessage, storeOfflineMessage } from './index';
import { randomUUID } from 'crypto';

describe('opaque offline message mailbox', () => {
  const base = () => ({ id: randomUUID(), dedupeKey: `dedupe-${randomUUID()}`, channel: randomUUID(), mailbox: randomUUID(), sender: randomUUID(), envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: 'ciphertext' } }, timestamp: Date.now(), expiresAt: new Date(Date.now() + 60_000) });

  it('deduplicates submissions, claims once, and removes only on ACK', async () => {
    const message = base();
    const first = await storeOfflineMessage(message);
    const duplicate = await storeOfflineMessage({ ...message, id: randomUUID() });
    expect(duplicate.id).toBe(first.id);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(1);
    const claimId = randomUUID();
    expect(await claimOfflineMessage(message.mailbox, message.channel, new Date(Date.now() + 30_000), claimId)).toEqual(expect.objectContaining({ id: message.id }));
    expect(await claimOfflineMessage(message.mailbox, message.channel, new Date(Date.now() + 30_000), randomUUID())).toBeFalsy();
    expect(await ackOfflineMessage(message.id, message.mailbox, message.channel, claimId)).toBe(true);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
  });

  it('allows the same envelope key to be stored again after its mailbox row is deleted', async () => {
    const message = base();
    const first = await storeOfflineMessage(message);
    expect(await ackOfflineMessage(first.id, message.mailbox, message.channel)).toBe(true);

    const resubmitted = await storeOfflineMessage({
      ...message,
      id: randomUUID(),
      timestamp: message.timestamp + 1,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(resubmitted.id).not.toBe(first.id);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(1);
    expect(await ackOfflineMessage(resubmitted.id, message.mailbox, message.channel)).toBe(true);
  });

  it('expires abandoned ciphertext without inspecting its contents', async () => {
    const message = { ...base(), expiresAt: new Date(Date.now() - 1) };
    await storeOfflineMessage(message);
    expect(cleanupExpiredOfflineMessages()).toBeGreaterThanOrEqual(1);
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
  });

  it('enforces the mailbox bound in the active test storage', async () => {
    const seed = base();
    for (let index = 0; index < 64; index += 1) await storeOfflineMessage({ ...seed, id: randomUUID(), dedupeKey: `quota-${randomUUID()}` });
    await expect(storeOfflineMessage({ ...seed, id: randomUUID(), dedupeKey: `quota-${randomUUID()}` })).rejects.toThrow('MAILBOX_QUOTA');
  });

  it('rotates claim generations and rejects stale/duplicate terminal decisions safely', async () => {
    const message = base();
    await storeOfflineMessage(message);
    const staleClaim = randomUUID();
    const first = await claimOfflineMessage<{ claimId: string }>(message.mailbox, message.channel, new Date(Date.now() - 1), staleClaim);
    expect(first?.claimId).toBe(staleClaim);
    const currentClaim = randomUUID();
    const current = await claimOfflineMessage<{ claimId: string }>(message.mailbox, message.channel, new Date(Date.now() + 30_000), currentClaim);
    expect(current?.claimId).toBe(currentClaim);
    expect(await ackOfflineMessage(message.id, message.mailbox, message.channel)).toBe(false);
    expect(await ackOfflineMessage(message.id, message.mailbox, message.channel, '')).toBe(false);
    expect(await rejectOfflineMessage(message.id, message.mailbox, message.channel, staleClaim, 'authenticated-invalid')).toBe('stale');
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(1);
    expect(await rejectOfflineMessage(message.id, message.mailbox, message.channel, currentClaim, 'authenticated-invalid')).toBe('rejected');
    expect(await rejectOfflineMessage(message.id, message.mailbox, message.channel, currentClaim, 'authenticated-invalid')).toBe('duplicate');
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
  });

  it('removes 64 terminal poison entries from active quota while keeping bounded metadata only', async () => {
    const seed = base();
    const poisoned = [] as Array<{ id: string; claimId: string }>;
    for (let index = 0; index < 64; index += 1) {
      const message = { ...seed, id: randomUUID(), dedupeKey: `poison-${randomUUID()}` };
      await storeOfflineMessage(message);
      const claimId = randomUUID();
      await claimOfflineMessage(message.mailbox, message.channel, new Date(Date.now() + 30_000), claimId);
      poisoned.push({ id: message.id, claimId });
    }
    expect(await countOfflineMessages({ mailbox: seed.mailbox, channel: seed.channel })).toBe(64);
    for (const item of poisoned) expect(await rejectOfflineMessage(item.id, seed.mailbox, seed.channel, item.claimId, 'unsupported-message')).toBe('rejected');
    expect(await countOfflineMessages({ mailbox: seed.mailbox, channel: seed.channel })).toBe(0);
    const next = { ...seed, id: randomUUID(), dedupeKey: `legitimate-${randomUUID()}` };
    await expect(storeOfflineMessage(next)).resolves.toMatchObject({ id: next.id, state: 'active' });
  });

  it('records live terminal decisions as expiring metadata and does not re-enqueue the same ciphertext', async () => {
    const message = base();
    await expect(recordOfflineRejection({ ...message, terminalReason: 'unsupported-message' })).resolves.toBe('rejected');
    expect(await countOfflineMessages({ mailbox: message.mailbox, channel: message.channel })).toBe(0);
    const duplicate = await storeOfflineMessage(message);
    expect(duplicate).toMatchObject({ id: message.id, state: 'rejected', terminalReason: 'unsupported-message' });
    expect(duplicate).not.toHaveProperty('envelope');
    await expect(recordOfflineRejection({ ...message, terminalReason: 'unsupported-message' })).resolves.toBe('duplicate');
  });
});
