/**
 * P0-2 retention (owner decision): hard-delete transfer metadata 24h after the transfer
 * completes, and never keep unclaimed transfer metadata longer than 7 days, matching the
 * offline mailbox TTL. Each record carries a `purgeAt` Date; Mongo TTL indexes on `purgeAt`
 * do the deleting, so retention does not depend on anyone touching the record again.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_UNCLAIMED_MS = 7 * DAY_MS;
export const PURGE_INDEX = 'purgeAt_1';
export const RETENTION_COLLECTIONS = ['file_ledgers_v2', 'attachment_metadata', 'attachment_chunks', 'attachment_access'] as const;

/**
 * v2 ledger: one document per account. Each transfer's download window ends at `expiresAt`;
 * the record is kept 24h after that so a late recipient sees "expired" rather than "missing".
 * An account with no transfers left is deleted now.
 */
export const ledgerPurgeAt = (transfers: ReadonlyArray<{ expiresAt: number }>, now = Date.now()): Date => {
  if (!transfers.length) return new Date(now);
  const latest = Math.max(...transfers.map((transfer) => transfer.expiresAt)) + DAY_MS;
  return new Date(Math.min(latest, now + MAX_UNCLAIMED_MS));
};

/** Legacy v1 metadata: 24h after its expiry, never more than 7 days after creation. */
export const attachmentPurgeAt = (record: { createdAt?: number; expiresAt: number }): Date => {
  const created = Number.isSafeInteger(record.createdAt) ? record.createdAt as number : Date.now();
  return new Date(Math.min(record.expiresAt + DAY_MS, created + MAX_UNCLAIMED_MS));
};

/** Chunks and access grants carry no completion signal: 7-day cap from when they were stored. */
export const unclaimedPurgeAt = (storedAt = Date.now()): Date => new Date(storedAt + MAX_UNCLAIMED_MS);
