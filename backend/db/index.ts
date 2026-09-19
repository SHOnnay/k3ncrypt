import { Db, MongoClient, ServerApiVersion } from 'mongodb';

import {
    findOneFromDB as _findOneFromDB, insertInDb as _insertInDb, updateOneFromDb as _updateOneFromDb, claimOneTimeKey as _claimOneTimeKey, deleteExpiredPrekeyBundles as _deleteExpiredPrekeyBundles
} from './inMemDB';
import { PREKEY_COLLECTION } from './const';

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME;

let db: Db = null;
let inMem = uri ? false : true;

const connectDb = async (): Promise<void> => {
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
    await db.collection(PREKEY_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (err) {
    inMem = true;
    if (process.env.NODE_ENV !== 'test') {
      console.error(process.env.NODE_ENV === 'production'
        ? 'Database unavailable; using volatile in-memory room storage. Modern pre-key publication is disabled.'
        : 'Database unavailable; using volatile in-memory room storage.');
    }
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
export const cleanupExpiredPrekeyBundles = (now = Date.now()): number =>
  inMem ? _deleteExpiredPrekeyBundles(now, PREKEY_COLLECTION) : 0;

export default {
  db,
  connectDb,
  insertInDb,
  findOneFromDB,
  updateOneFromDb,
  claimOneTimeKey,
  prekeyStorageReady,
  cleanupExpiredPrekeyBundles,
};
