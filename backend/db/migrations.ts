import type { Db } from 'mongodb';
import { LINK_COLLECTION, OFFLINE_MESSAGE_COLLECTION, PREKEY_COLLECTION } from './const';
import { DAY_MS, MAX_UNCLAIMED_MS, RETENTION_COLLECTIONS } from './retention';

/** Additive, idempotent schema setup. Invoke explicitly before a production rollout. */
export const applyMigrations = async (database: Db): Promise<void> => {
  await database.collection(LINK_COLLECTION).createIndex({ hash: 1 }, { unique: true });
  await database.collection(PREKEY_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection(PREKEY_COLLECTION).createIndex({ channel: 1, address: 1 }, { unique: true });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ dedupeKey: 1 }, { unique: true });
  const offlineMessages = database.collection(OFFLINE_MESSAGE_COLLECTION);
  await offlineMessages.updateMany({ state: { $exists: false } }, { $set: { state: 'active' } });
  const slotIndex = (await offlineMessages.listIndexes().toArray()).find((index) => index.name === 'channel_1_mailbox_1_slot_1');
  if (slotIndex && JSON.stringify(slotIndex.partialFilterExpression) !== JSON.stringify({ state: 'active' })) {
    await offlineMessages.dropIndex('channel_1_mailbox_1_slot_1');
  }
  await offlineMessages.createIndex({ channel: 1, mailbox: 1, slot: 1 }, { unique: true, partialFilterExpression: { state: 'active' } });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ channel: 1, mailbox: 1, claimedUntil: 1, expiresAt: 1 });
  await database.collection('file_ledgers_v2').createIndex({ 'transfers.context.transferId': 1 }, { unique: true, partialFilterExpression: { 'transfers.0': { $exists: true } } });
  await database.collection('attachment_metadata').createIndex({ id: 1 }, { unique: true });
  await database.collection('attachment_metadata').createIndex({ expiresAt: 1, status: 1 });
  await database.collection('attachment_chunks').createIndex({ attachmentId: 1, index: 1 }, { unique: true });
  await database.collection('attachment_chunks').createIndex({ attachmentId: 1, storedAt: 1 });
  await database.collection('attachment_access').createIndex({ attachmentId: 1 }, { unique: true });
  await database.collection('device_lifecycle').createIndex({ accountIdentityReference: 1, deviceId: 1 }, { unique: true });
  await database.collection('device_identity_registry').createIndex({ deviceId: 1 }, { unique: true });
  await database.collection('device_proof_nonces').createIndex({ proofId: 1, deviceId: 1 }, { unique: true });
  await database.collection('device_proof_nonces').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection('private_network_members').createIndex({ networkId: 1, deviceId: 1 }, { unique: true });
  await database.collection('private_network_membership_events').createIndex({ eventId: 1 }, { unique: true });
  await applyRetention(database);
};

/**
 * P0-2 retention. Backfills purgeAt on rows written before retention existed, then adds
 * TTL indexes. Rows whose purgeAt is already past are deleted by Mongo shortly afterwards:
 * this migration is the moment old transfer metadata goes away. Idempotent.
 */
export const applyRetention = async (database: Db): Promise<void> => {
  const now = { $toLong: '$$NOW' };
  const capped = (value: unknown) => ({ $toDate: { $min: [value, { $add: [now, MAX_UNCLAIMED_MS] }] } });
  await database.collection('file_ledgers_v2').updateMany({ purgeAt: { $exists: false } }, [{ $set: { purgeAt: { $cond: [
    { $gt: [{ $size: { $ifNull: ['$transfers', []] } }, 0] },
    capped({ $add: [{ $max: '$transfers.expiresAt' }, DAY_MS] }),
    '$$NOW',
  ] } } }]);
  await database.collection('attachment_metadata').updateMany({ purgeAt: { $exists: false } }, [{ $set: { purgeAt: { $toDate: { $min: [
    { $add: [{ $ifNull: ['$expiresAt', { $toLong: '$$NOW' }] }, DAY_MS] },
    { $add: [{ $ifNull: ['$createdAt', { $toLong: '$$NOW' }] }, MAX_UNCLAIMED_MS] },
  ] } } } }]);
  await database.collection('attachment_chunks').updateMany({ purgeAt: { $exists: false } }, [{ $set: { purgeAt: { $toDate: { $add: [{ $ifNull: ['$storedAt', { $toLong: '$$NOW' }] }, MAX_UNCLAIMED_MS] } } } }]);
  await database.collection('attachment_access').updateMany({ purgeAt: { $exists: false } }, [{ $set: { purgeAt: { $toDate: { $add: [{ $toLong: '$$NOW' }, MAX_UNCLAIMED_MS] } } } }]);
  for (const name of RETENTION_COLLECTIONS) await database.collection(name).createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
};
