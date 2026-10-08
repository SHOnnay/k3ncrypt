import { Db, MongoClient, ServerApiVersion } from 'mongodb';
import { randomInt } from 'crypto';

import {
    findOneFromDB as _findOneFromDB, insertInDb as _insertInDb, updateOneFromDb as _updateOneFromDb, claimOneTimeKey as _claimOneTimeKey, deleteExpiredPrekeyBundles as _deleteExpiredPrekeyBundles
    , insertOfflineMessage as _insertOfflineMessage, claimOfflineMessage as _claimOfflineMessage, ackOfflineMessage as _ackOfflineMessage, rejectOfflineMessage as _rejectOfflineMessage, recordOfflineRejection as _recordOfflineRejection, deleteExpiredOfflineMessages as _deleteExpiredOfflineMessages, countOfflineMessages as _countOfflineMessages
} from './inMemDB';
import { LINK_COLLECTION, PREKEY_COLLECTION, OFFLINE_MESSAGE_COLLECTION } from './const';
import { applyMigrations } from './migrations';

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME;

let db: Db = null;
let connectedClient: MongoClient | undefined;
let inMem = uri ? false : true;

const connectDb = async (): Promise<void> => {
  if (db) return;
  try {
    if (!uri) throw new Error("No URI");
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });
    if (!client) throw new Error("No client");
    await client.connect();
    connectedClient = client;
    db = client.db(dbName);
    // Tests and local development get a convenient additive setup. Production
    // deploys run this explicitly via `npm run migrate` before traffic moves.
    if (process.env.NODE_ENV !== 'production') await applyMigrations(db);
  } catch (err) {
    inMem = true;
    if (process.env.NODE_ENV !== 'test') {
      console.error(process.env.NODE_ENV === 'production'
        ? 'Database unavailable; using volatile in-memory room storage. Modern pre-key publication is disabled.'
        : 'Database unavailable; using volatile in-memory room storage.');
    }
    if (process.env.NODE_ENV === 'production') throw new Error('Persistent database is unavailable in production.');
  }
};

const disconnectDb = async (): Promise<void> => {
  await connectedClient?.close();
  connectedClient = undefined; db = null; inMem = true;
};

const insertInDb = async<T>(data: T, collectionName: string): Promise<T> => {
  if(inMem) {
    _insertInDb(data, collectionName);
  }else {
    await db.collection(collectionName).insertOne(data);
  }

  return data;
};

const findOneFromDB = async<T>(findCondition, collectionName: string): Promise<T> => {
  if(inMem) {
    return _findOneFromDB(findCondition, collectionName);
  }

  return db.collection(collectionName).findOne(findCondition, { sort: { _id: -1 } }) as T;
}

const updateOneFromDb = async<T>(condition, data, collectionName: string): Promise<T> => {
  if(inMem) {
    return _updateOneFromDb(condition, data, collectionName) as Promise<T>;
  }
  return db.collection(collectionName).updateOne(condition, { $set: data })  as Promise<T>;
}

export const claimOneTimeKey = async <T>(condition, keyId: string, collectionName: string): Promise<T | undefined> => {
  if (inMem) return _claimOneTimeKey(condition, keyId, collectionName) as T | undefined;
  const result = await db.collection(collectionName).findOneAndUpdate(
    { ...condition, expiresAt: { $gt: new Date() }, 'bundle.oneTimeKeys.id': keyId },
    { $pull: { 'bundle.oneTimeKeys': { id: keyId } } } as any,
    { returnDocument: 'before' },
  );
  // mongodb v5 returns a FindAndModifyResult while mongodb v6 returns the
  // document directly. Support both without weakening the single-claim
  // conditional update above.
  const value = ((result && typeof result === 'object' && 'value' in result)
    ? (result as { value?: unknown }).value
    : result) as { bundle?: { oneTimeKeys?: Array<{ id: string; key: string }> } } | null;
  return value?.bundle?.oneTimeKeys?.find((key) => key.id === keyId) as T | undefined;
};

export const prekeyStorageReady = (): boolean => process.env.NODE_ENV !== 'production' || !inMem;

/** New invitations allow only the creator and one joining peer. Room operations remain available after join. */
export const reserveInvitationPublication = async (channel: string, now = Date.now()): Promise<boolean> => {
  if (inMem) {
    const room = _findOneFromDB({ hash: channel }, LINK_COLLECTION) as { invitationExpiresAt?: Date; invitationPublications?: number; deleted?: boolean; expired?: boolean } | undefined;
    if (!room || room.deleted || room.expired) return false;
    if (room.invitationExpiresAt === undefined) return true; // Existing rooms retain their established compatibility contract.
    if (!(room.invitationExpiresAt instanceof Date) || room.invitationExpiresAt.getTime() <= now ||
        !Number.isSafeInteger(room.invitationPublications) || room.invitationPublications! >= 2) return false;
    room.invitationPublications! += 1;
    return true;
  }
  const result = await db.collection(LINK_COLLECTION).updateOne(
    { hash: channel, deleted: false, expired: false, invitationExpiresAt: { $gt: new Date(now) }, invitationPublications: { $gte: 0, $lt: 2 } },
    { $inc: { invitationPublications: 1 } },
  );
  if (result.modifiedCount === 1) return true;
  const legacy = await db.collection(LINK_COLLECTION).findOne({ hash: channel, deleted: false, expired: false, invitationExpiresAt: { $exists: false } });
  return !!legacy;
};
export const persistentStorageReady = (): boolean => !inMem;
export const getDatabase = (): Db | undefined => inMem || !db ? undefined : db;
export const ping = async (): Promise<void> => {
  if (inMem || !db) throw new Error('Persistent database unavailable.');
  await db.command({ ping: 1 });
};
const requiredIndexes: Record<string, string[]> = {
  file_ledgers_v2: ['transfers.context.transferId_1'],
  [LINK_COLLECTION]: ['hash_1'],
  [PREKEY_COLLECTION]: ['expiresAt_1', 'channel_1_address_1'],
  [OFFLINE_MESSAGE_COLLECTION]: ['expiresAt_1', 'dedupeKey_1', 'channel_1_mailbox_1_slot_1', 'channel_1_mailbox_1_claimedUntil_1_expiresAt_1'],
  attachment_metadata: ['id_1', 'expiresAt_1_status_1'],
  attachment_chunks: ['attachmentId_1_index_1', 'attachmentId_1_storedAt_1'],
  attachment_access: ['attachmentId_1'],
  device_lifecycle: ['accountIdentityReference_1_deviceId_1'],
  device_identity_registry: ['deviceId_1'],
  device_proof_nonces: ['proofId_1_deviceId_1', 'expiresAt_1'],
  private_network_members: ['networkId_1_deviceId_1'],
  private_network_membership_events: ['eventId_1'],
};
export const requiredIndexesReady = async (): Promise<boolean> => {
  if (inMem || !db) return false;
  for (const [collection, expected] of Object.entries(requiredIndexes)) {
    const actual = new Set((await db.collection(collection).indexes()).map((index) => index.name));
    if (expected.some((name) => !actual.has(name))) return false;
  }
  return true;
};
export const cleanupExpiredPrekeyBundles = (now = Date.now()): number =>
  inMem ? _deleteExpiredPrekeyBundles(now, PREKEY_COLLECTION) : 0;

export const storeOfflineMessage = async <T extends Record<string, unknown>>(data: T): Promise<T> => {
  const activeData = { state: 'active', ...data };
  if (inMem) {
    const duplicate = _findOneFromDB({ dedupeKey: data.dedupeKey }, OFFLINE_MESSAGE_COLLECTION);
    if (duplicate) return duplicate as T;
    if (_countOfflineMessages({ channel: data.channel, mailbox: data.mailbox }, OFFLINE_MESSAGE_COLLECTION) >= 64) throw new Error('MAILBOX_QUOTA');
    return _insertOfflineMessage(activeData, OFFLINE_MESSAGE_COLLECTION) as T;
  }
  const existing = await db.collection(OFFLINE_MESSAGE_COLLECTION).findOne({ dedupeKey: data.dedupeKey });
  if (existing) return existing as unknown as T;
  const start = randomInt(0, 64);
  for (let offset = 0; offset < 64; offset += 1) {
    const candidate = { ...activeData, slot: (start + offset) % 64 };
    try {
      await db.collection(OFFLINE_MESSAGE_COLLECTION).insertOne(candidate);
      return candidate;
    } catch {
      const duplicate = await db.collection(OFFLINE_MESSAGE_COLLECTION).findOne({ dedupeKey: data.dedupeKey });
      if (duplicate) return duplicate as unknown as T;
    }
  }
  throw new Error('MAILBOX_QUOTA');
};

export const claimOfflineMessage = async <T>(mailbox: string, channel: string, leaseUntil: Date, claimId: string): Promise<T | undefined> => {
  if (inMem) return _claimOfflineMessage({ mailbox, channel }, leaseUntil, claimId, OFFLINE_MESSAGE_COLLECTION) as T | undefined;
  const result = await db.collection(OFFLINE_MESSAGE_COLLECTION).findOneAndUpdate(
    { mailbox, channel, state: 'active', expiresAt: { $gt: new Date() }, $or: [{ claimedUntil: { $exists: false } }, { claimedUntil: { $lte: new Date() } }] },
    { $set: { claimedUntil: leaseUntil, claimId } }, { returnDocument: 'after' },
  );
  return ((result && typeof result === 'object' && 'value' in result) ? (result as { value?: unknown }).value : result) as T | undefined;
};

export const ackOfflineMessage = async (id: string, mailbox: string, channel: string, claimId?: string): Promise<boolean> => {
  const condition = { id, mailbox, channel, ...(claimId ? { claimId } : {}) };
  if (inMem) return _ackOfflineMessage(condition, OFFLINE_MESSAGE_COLLECTION);
  const result = await db.collection(OFFLINE_MESSAGE_COLLECTION).deleteOne(condition);
  return result.deletedCount === 1;
};

export type OfflineRejectionReason = 'authenticated-invalid' | 'unsupported-message' | 'identity-changed';
export type OfflineRejectionResult = 'rejected' | 'duplicate' | 'stale';
export const rejectOfflineMessage = async (id: string, mailbox: string, channel: string, claimId: string, reasonClass: OfflineRejectionReason): Promise<OfflineRejectionResult> => {
  if (inMem) return _rejectOfflineMessage({ id, mailbox, channel, claimId }, reasonClass, new Date(), OFFLINE_MESSAGE_COLLECTION);
  const collection = db.collection(OFFLINE_MESSAGE_COLLECTION);
  const result = await collection.updateOne(
    { id, mailbox, channel, state: 'active', claimId },
    { $set: { state: 'rejected', terminalReason: reasonClass, terminalAt: new Date(), terminalClaimId: claimId },
      $unset: { envelope: '', claimId: '', claimedUntil: '', slot: '' } },
  );
  if (result.modifiedCount === 1) return 'rejected';
  const prior = await collection.findOne({ id, mailbox, channel, state: 'rejected', terminalClaimId: claimId }, { projection: { _id: 1 } });
  return prior ? 'duplicate' : 'stale';
};

export const recordOfflineRejection = async (data: { id: string; dedupeKey: string; channel: string; mailbox: string; sender: string; timestamp: number; expiresAt: Date; terminalReason: OfflineRejectionReason }): Promise<'rejected' | 'duplicate'> => {
  const terminalData = { id: data.id, dedupeKey: data.dedupeKey, channel: data.channel, mailbox: data.mailbox, sender: data.sender,
    timestamp: data.timestamp, expiresAt: data.expiresAt, terminalReason: data.terminalReason, state: 'rejected', terminalAt: new Date() };
  if (inMem) return _recordOfflineRejection(terminalData, OFFLINE_MESSAGE_COLLECTION);
  const collection = db.collection(OFFLINE_MESSAGE_COLLECTION);
  const existing = await collection.findOne({ dedupeKey: data.dedupeKey });
  if (existing?.state === 'rejected') return 'duplicate';
  if (existing) {
    await collection.updateOne({ _id: existing._id, dedupeKey: data.dedupeKey }, { $set: { state: 'rejected', terminalReason: data.terminalReason, terminalAt: terminalData.terminalAt }, $unset: { envelope: '', claimId: '', claimedUntil: '', slot: '' } });
    return 'rejected';
  }
  try { await collection.insertOne(terminalData); return 'rejected'; }
  catch {
    const duplicate = await collection.findOne({ dedupeKey: data.dedupeKey }, { projection: { _id: 1, state: 1 } });
    if (duplicate?.state === 'rejected') return 'duplicate';
    throw new Error('Permanent mailbox result could not be recorded.');
  }
};

export const cleanupExpiredOfflineMessages = (now = Date.now()): number =>
  inMem ? _deleteExpiredOfflineMessages(now, OFFLINE_MESSAGE_COLLECTION) : 0;

export const countOfflineMessages = async (condition: Record<string, unknown>): Promise<number> =>
  inMem ? _countOfflineMessages(condition, OFFLINE_MESSAGE_COLLECTION) : db.collection(OFFLINE_MESSAGE_COLLECTION).countDocuments({ ...condition, state: 'active', expiresAt: { $gt: new Date() } });

export default {
  db,
  connectDb,
  disconnectDb,
  insertInDb,
  findOneFromDB,
  updateOneFromDb,
  claimOneTimeKey,
  prekeyStorageReady,
  reserveInvitationPublication,
  cleanupExpiredPrekeyBundles,
  storeOfflineMessage,
  claimOfflineMessage,
  ackOfflineMessage,
  rejectOfflineMessage,
  recordOfflineRejection,
  cleanupExpiredOfflineMessages,
  countOfflineMessages,
  persistentStorageReady,
  getDatabase,
  ping,
  requiredIndexesReady,
};
