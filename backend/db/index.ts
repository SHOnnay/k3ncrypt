import { Db, MongoClient, ServerApiVersion } from 'mongodb';
import { randomInt } from 'crypto';

import {
    findOneFromDB as _findOneFromDB, insertInDb as _insertInDb, updateOneFromDb as _updateOneFromDb, claimOneTimeKey as _claimOneTimeKey, deleteExpiredPrekeyBundles as _deleteExpiredPrekeyBundles
    , insertOfflineMessage as _insertOfflineMessage, claimOfflineMessage as _claimOfflineMessage, ackOfflineMessage as _ackOfflineMessage, deleteExpiredOfflineMessages as _deleteExpiredOfflineMessages, countOfflineMessages as _countOfflineMessages
} from './inMemDB';
import { LINK_COLLECTION, PREKEY_COLLECTION, OFFLINE_MESSAGE_COLLECTION } from './const';
import { applyMigrations } from './migrations';

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME;

let db: Db = null;
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
export const persistentStorageReady = (): boolean => !inMem;
export const getDatabase = (): Db | undefined => inMem || !db ? undefined : db;
export const ping = async (): Promise<void> => {
  if (inMem || !db) throw new Error('Persistent database unavailable.');
  await db.command({ ping: 1 });
};
const requiredIndexes: Record<string, string[]> = {
  [LINK_COLLECTION]: ['hash_1'],
  [PREKEY_COLLECTION]: ['expiresAt_1', 'channel_1_address_1'],
  [OFFLINE_MESSAGE_COLLECTION]: ['expiresAt_1', 'dedupeKey_1', 'channel_1_mailbox_1_slot_1', 'channel_1_mailbox_1_claimedUntil_1_expiresAt_1'],
  attachment_metadata: ['id_1', 'expiresAt_1_status_1'],
  attachment_chunks: ['attachmentId_1_index_1', 'attachmentId_1_storedAt_1'],
  attachment_access: ['attachmentId_1'],
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
  if (inMem) {
    const duplicate = _findOneFromDB({ dedupeKey: data.dedupeKey }, OFFLINE_MESSAGE_COLLECTION);
    if (duplicate) return duplicate as T;
    if (_countOfflineMessages({ channel: data.channel, mailbox: data.mailbox }, OFFLINE_MESSAGE_COLLECTION) >= 64) throw new Error('MAILBOX_QUOTA');
    return _insertOfflineMessage(data, OFFLINE_MESSAGE_COLLECTION) as T;
  }
  const existing = await db.collection(OFFLINE_MESSAGE_COLLECTION).findOne({ dedupeKey: data.dedupeKey });
  if (existing) return existing as unknown as T;
  const start = randomInt(0, 64);
  for (let offset = 0; offset < 64; offset += 1) {
    const candidate = { ...data, slot: (start + offset) % 64 };
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

export const claimOfflineMessage = async <T>(mailbox: string, channel: string, leaseUntil: Date): Promise<T | undefined> => {
  if (inMem) return _claimOfflineMessage({ mailbox, channel }, leaseUntil, OFFLINE_MESSAGE_COLLECTION) as T | undefined;
  const result = await db.collection(OFFLINE_MESSAGE_COLLECTION).findOneAndUpdate(
    { mailbox, channel, expiresAt: { $gt: new Date() }, $or: [{ claimedUntil: { $exists: false } }, { claimedUntil: { $lte: new Date() } }] },
    { $set: { claimedUntil: leaseUntil } }, { returnDocument: 'after' },
  );
  return ((result && typeof result === 'object' && 'value' in result) ? (result as { value?: unknown }).value : result) as T | undefined;
};

export const ackOfflineMessage = async (id: string, mailbox: string, channel: string): Promise<boolean> => {
  if (inMem) return _ackOfflineMessage({ id, mailbox, channel }, OFFLINE_MESSAGE_COLLECTION);
  const result = await db.collection(OFFLINE_MESSAGE_COLLECTION).deleteOne({ id, mailbox, channel });
  return result.deletedCount === 1;
};

export const cleanupExpiredOfflineMessages = (now = Date.now()): number =>
  inMem ? _deleteExpiredOfflineMessages(now, OFFLINE_MESSAGE_COLLECTION) : 0;

export const countOfflineMessages = async (condition: Record<string, unknown>): Promise<number> =>
  inMem ? _countOfflineMessages(condition, OFFLINE_MESSAGE_COLLECTION) : db.collection(OFFLINE_MESSAGE_COLLECTION).countDocuments({ ...condition, expiresAt: { $gt: new Date() } });

export default {
  db,
  connectDb,
  insertInDb,
  findOneFromDB,
  updateOneFromDb,
  claimOneTimeKey,
  prekeyStorageReady,
  cleanupExpiredPrekeyBundles,
  storeOfflineMessage,
  claimOfflineMessage,
  ackOfflineMessage,
  cleanupExpiredOfflineMessages,
  countOfflineMessages,
  persistentStorageReady,
  getDatabase,
  ping,
  requiredIndexesReady,
};
