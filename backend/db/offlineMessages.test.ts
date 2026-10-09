import { ackOfflineMessage, claimOfflineMessage, cleanupExpiredOfflineMessages, countOfflineMessages, offlineMessageClaimUntil, recordOfflineRejection, rejectOfflineMessage, storeOfflineMessage } from './index';
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

  it('claims only the FIFO head under concurrency and advances after its matching ACK', async () => {
    const room = randomUUID(); const mailbox = randomUUID(); const now = Date.now();
    const first = { ...base(), channel: room, mailbox, timestamp: now, dedupeKey: `fifo-${randomUUID()}` };
    const second = { ...base(), channel: room, mailbox, timestamp: now + 1, dedupeKey: `fifo-${randomUUID()}` };
    // Insert out of order to assert ordering comes from durable message order.
    await storeOfflineMessage(second);
    await storeOfflineMessage(first);

    const [one, competing] = await Promise.all([
      claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID()),
      claimOfflineMessage<typeof second & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID()),
    ]);
    const owner = one ?? competing;
    expect(owner?.id).toBe(first.id);
    expect(Number(!!one) + Number(!!competing)).toBe(1);
    expect(await claimOfflineMessage(mailbox, room, new Date(Date.now() + 30_000), randomUUID())).toBeFalsy();
    expect(await ackOfflineMessage(first.id, mailbox, room, owner!.claimId)).toBe(true);

    const next = await claimOfflineMessage<typeof second & { claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
    expect(next?.id).toBe(second.id);
    expect(await ackOfflineMessage(second.id, mailbox, room, next!.claimId)).toBe(true);
  });

  it('preserves insertion order when mailbox timestamps have the same millisecond', async () => {
    const room = randomUUID(); const mailbox = randomUUID(); const timestamp = Date.now();
    const first = { ...base(), channel: room, mailbox, timestamp, dedupeKey: `same-time-${randomUUID()}` };
    const second = { ...base(), channel: room, mailbox, timestamp, dedupeKey: `same-time-${randomUUID()}` };
    await storeOfflineMessage(first); await storeOfflineMessage(second);
    const claim = await claimOfflineMessage<{ id: string; claimId: string }>(mailbox, room, new Date(Date.now() + 30_000), randomUUID());
    expect(claim?.id).toBe(first.id);
  });

  it('recovers the FIFO head after its lease expires without skipping it', async () => {
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const room = randomUUID(); const mailbox = randomUUID();
    const first = { ...base(), channel: room, mailbox, timestamp: now, dedupeKey: `lease-head-${randomUUID()}` };
    const second = { ...base(), channel: room, mailbox, timestamp: now + 1, dedupeKey: `lease-next-${randomUUID()}` };
    await storeOfflineMessage(first); await storeOfflineMessage(second);
    const abandoned = await claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(now + 1_000), randomUUID());
    expect(abandoned?.id).toBe(first.id);
    expect(await claimOfflineMessage(mailbox, room, new Date(now + 30_000), randomUUID())).toBeFalsy();
    expect(await offlineMessageClaimUntil(mailbox, room)).toEqual(new Date(now + 1_000));

    now += 1_001;
    const recovered = await claimOfflineMessage<typeof first & { claimId: string }>(mailbox, room, new Date(now + 30_000), randomUUID());
    expect(recovered?.id).toBe(first.id);
    expect(await ackOfflineMessage(first.id, mailbox, room, recovered!.claimId)).toBe(true);
    const next = await claimOfflineMessage<typeof second & { claimId: string }>(mailbox, room, new Date(now + 30_000), randomUUID());
    expect(next?.id).toBe(second.id);
    expect(await ackOfflineMessage(second.id, mailbox, room, next!.claimId)).toBe(true);
    nowSpy.mockRestore();
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
    for (let index = 0; index < 64; index += 1) {
      const message = { ...seed, id: randomUUID(), dedupeKey: `poison-${randomUUID()}` };
      await storeOfflineMessage(message);
    }
    expect(await countOfflineMessages({ mailbox: seed.mailbox, channel: seed.channel })).toBe(64);
    // Terminal rows are handled in FIFO order, just like delivery. Claiming
    // every row concurrently would bypass the mailbox head-of-line guarantee.
    for (let index = 0; index < 64; index += 1) {
      const claimId = randomUUID();
      const item = await claimOfflineMessage<{ id: string; claimId: string }>(seed.mailbox, seed.channel, new Date(Date.now() + 30_000), claimId);
      expect(item).toBeDefined();
      expect(await rejectOfflineMessage(item!.id, seed.mailbox, seed.channel, item!.claimId, 'unsupported-message')).toBe('rejected');
    }
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
