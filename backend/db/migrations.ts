import type { Db } from 'mongodb';
import { LINK_COLLECTION, OFFLINE_MESSAGE_COLLECTION, PREKEY_COLLECTION } from './const';

/** Additive, idempotent schema setup. Invoke explicitly before a production rollout. */
export const applyMigrations = async (database: Db): Promise<void> => {
  await database.collection(LINK_COLLECTION).createIndex({ hash: 1 }, { unique: true });
  await database.collection(PREKEY_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection(PREKEY_COLLECTION).createIndex({ channel: 1, address: 1 }, { unique: true });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ dedupeKey: 1 }, { unique: true });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ channel: 1, mailbox: 1, slot: 1 }, { unique: true });
  await database.collection(OFFLINE_MESSAGE_COLLECTION).createIndex({ channel: 1, mailbox: 1, claimedUntil: 1, expiresAt: 1 });
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
};
