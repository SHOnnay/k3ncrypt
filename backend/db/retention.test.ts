import { DAY_MS, MAX_UNCLAIMED_MS, attachmentPurgeAt, ledgerPurgeAt, unclaimedPurgeAt } from './retention';

// P0-2 (owner decision): hard-delete transfer metadata 24h after the transfer completes,
// and never keep unclaimed transfer metadata longer than 7 days (the mailbox TTL).
describe('transfer metadata retention rules', () => {
  const now = Date.UTC(2026, 10, 2);

  it('purges an empty v2 ledger document immediately and a busy one 24h after its last transfer ends', () => {
    expect(ledgerPurgeAt([], now).getTime()).toBe(now);
    const transfers = [{ expiresAt: now + 2 * 60 * 60 * 1000 }, { expiresAt: now + 20 * 60 * 60 * 1000 }];
    expect(ledgerPurgeAt(transfers, now).getTime()).toBe(now + 20 * 60 * 60 * 1000 + DAY_MS);
  });

  it('never lets a v2 ledger outlive 7 days, even with a bad expiry', () => {
    expect(ledgerPurgeAt([{ expiresAt: now + 30 * DAY_MS }], now).getTime()).toBe(now + MAX_UNCLAIMED_MS);
  });

  it('purges legacy v1 metadata 24h after expiry, capped at 7 days after creation', () => {
    expect(attachmentPurgeAt({ createdAt: now, expiresAt: now + DAY_MS }).getTime()).toBe(now + 2 * DAY_MS);
    expect(attachmentPurgeAt({ createdAt: now, expiresAt: now + 30 * DAY_MS }).getTime()).toBe(now + MAX_UNCLAIMED_MS);
  });

  it('caps chunks and access records with no completion signal at 7 days', () => {
    expect(unclaimedPurgeAt(now).getTime()).toBe(now + MAX_UNCLAIMED_MS);
  });
});
