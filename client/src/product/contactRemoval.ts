import { completeRemovals, readRemovalOutbox, type ProductSecureStorage, type RemovalOutboxEntry } from './sessionStore';

/** After this long the relay holds nothing that still matters for the address (mail and wake routes have expired). */
export const REMOVAL_ABANDON_MS = 30 * 24 * 60 * 60_000;
const PRODUCT_ROOM_RECORDS = ['product-messages', 'product-message-quarantine', 'product-file-details', 'product-remote-profile'] as const;

export type RevokeRoute = (entry: RemovalOutboxEntry) => Promise<'revoked' | 'gone'>;
const running = new WeakMap<object, Promise<number>>();

/**
 * Tells the relay about every removed contact still waiting in the vault. An entry leaves the outbox only when the relay
 * confirms ('revoked'), the room no longer exists ('gone'), or it is older than REMOVAL_ABANDON_MS. Any failure keeps it
 * for the next attempt. Returns how many are still waiting. One drain per vault at a time.
 */
export const drainRemovalOutbox = (storage: ProductSecureStorage, revoke: RevokeRoute, now: () => number = Date.now): Promise<number> => {
  const active = running.get(storage);
  if (active) return active;
  const run = (async () => {
    const done: string[] = [];
    for (const entry of await readRemovalOutbox(storage)) {
      if (now() - entry.queuedAt > REMOVAL_ABANDON_MS) { done.push(entry.roomId); continue; }
      try { await revoke(entry); done.push(entry.roomId); } catch { /* kept for the next attempt */ }
    }
    return (done.length ? await completeRemovals(storage, done) : await readRemovalOutbox(storage)).length;
  })().finally(() => running.delete(storage));
  running.set(storage, run);
  return run;
};

/** Deletes this device's saved messages, file details and profile copy for a removed chat. */
export const purgeProductRecords = async (storage: ProductSecureStorage & { delete(recordType: string, recordId: string): Promise<void> }, roomId: string): Promise<void> => {
  for (const recordType of PRODUCT_ROOM_RECORDS) await storage.delete(recordType, roomId);
};
