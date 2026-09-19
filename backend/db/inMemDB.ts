export type MongoDataType = Record<any, any> | null;
const findOneFromArr = (arr: [], findCondition:any): MongoDataType =>
  arr.find((data) => {
    const conditionKeys = Object.keys(findCondition);
    const results = conditionKeys.filter(
      (key) => findCondition[key] && data[key] === findCondition[key]
    );
    return results.length === conditionKeys.length;
  });

const storage = {};
let pk = 0;

export const insertInDb = (data, collectionName: string): void => {
  if (!storage[collectionName]) {
    storage[collectionName] = [];
  }
  const collection = storage[collectionName];
  collection.push({
    pk,
    ...data
  });
  pk += 1;
};
export const findOneFromDB = (findCondition, collectionName: string) => {
  if (!storage[collectionName]) {
    return null;
  }
  const collection = storage[collectionName];
  return findOneFromArr(collection, findCondition);
};
export const updateOneFromDb = (condition, data, collectionName: string): MongoDataType  => {
  if (!storage[collectionName]) {
    return null;
  }
  const collection = storage[collectionName];
  const originalData = findOneFromArr(collection, condition);

  if (!originalData) {
    return null;
  }

  Object.keys(data).forEach((key) => {
    const val = data[key];
    originalData[key] = val;
  });

  return originalData;
};

/** Process-local atomic claim used when Mongo is not configured. */
export const claimOneTimeKey = (condition, keyId: string, collectionName: string): MongoDataType => {
  const collection = storage[collectionName];
  if (!collection) return null;
  const record = collection.find((entry) => {
    if (!Object.keys(condition).every((key) => entry[key] === condition[key])) return false;
    if (!(entry.expiresAt instanceof Date) || entry.expiresAt.getTime() <= Date.now()) return false;
    return Array.isArray(entry.bundle?.oneTimeKeys) && entry.bundle.oneTimeKeys.some((key) => key.id === keyId);
  });
  if (!record) return null;
  const index = record.bundle.oneTimeKeys.findIndex((key) => key.id === keyId);
  const [claimed] = record.bundle.oneTimeKeys.splice(index, 1);
  return { ...claimed };
};

export const deleteExpiredPrekeyBundles = (now: number, collectionName: string): number => {
  const collection = storage[collectionName];
  if (!collection) return 0;
  const retained = collection.filter((entry) => !(entry.expiresAt instanceof Date) || entry.expiresAt.getTime() > now);
  const removed = collection.length - retained.length;
  storage[collectionName] = retained;
  return removed;
};

export const findOfflineMessages = (condition: Record<string, unknown>, collectionName: string, limit: number): any[] => {
  const collection = storage[collectionName] || [];
  return collection.filter((entry) => Object.keys(condition).every((key) => entry[key] === condition[key]) &&
    (!entry.expiresAt || entry.expiresAt.getTime() > Date.now()) && (!entry.claimedUntil || entry.claimedUntil.getTime() <= Date.now()))
    .slice(0, limit);
};

export const insertOfflineMessage = (data: any, collectionName: string): any => {
  const collection = storage[collectionName] || (storage[collectionName] = []);
  const existing = collection.find((entry) => entry.dedupeKey === data.dedupeKey);
  if (existing) return existing;
  collection.push({ pk: pk++, ...data });
  return data;
};

export const claimOfflineMessage = (condition: Record<string, unknown>, leaseUntil: Date, collectionName: string): any => {
  const message = findOfflineMessages(condition, collectionName, 1)[0];
  if (!message) return null;
  message.claimedUntil = leaseUntil;
  return message;
};

export const ackOfflineMessage = (condition: Record<string, unknown>, collectionName: string): boolean => {
  const collection = storage[collectionName] || [];
  const index = collection.findIndex((entry) => Object.keys(condition).every((key) => entry[key] === condition[key]));
  if (index < 0) return false;
  collection.splice(index, 1);
  return true;
};

export const deleteExpiredOfflineMessages = (now: number, collectionName: string): number => {
  const collection = storage[collectionName] || [];
  const retained = collection.filter((entry) => !(entry.expiresAt instanceof Date) || entry.expiresAt.getTime() > now);
  storage[collectionName] = retained;
  return collection.length - retained.length;
};

export const countOfflineMessages = (condition: Record<string, unknown>, collectionName: string): number =>
  (storage[collectionName] || []).filter((entry) => Object.keys(condition).every((key) => entry[key] === condition[key]) && (!entry.expiresAt || entry.expiresAt.getTime() > Date.now())).length;
