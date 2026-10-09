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

const offlineMessageFifo = (left, right): number => (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
  (left.pk ?? 0) - (right.pk ?? 0) || String(left.id ?? '').localeCompare(String(right.id ?? ''));

const nextActiveOfflineMessage = (condition: Record<string, unknown>, collectionName: string): any =>
  (storage[collectionName] || []).filter((entry) => entry.state === 'active' &&
    Object.keys(condition).every((key) => entry[key] === condition[key]) && (!entry.expiresAt || entry.expiresAt.getTime() > Date.now()))
    .sort(offlineMessageFifo)[0];

export const findOfflineMessages = (condition: Record<string, unknown>, collectionName: string, limit: number): any[] => {
  const now = Date.now();
  return (storage[collectionName] || []).filter((entry) => entry.state === 'active' &&
    Object.keys(condition).every((key) => entry[key] === condition[key]) && (!entry.expiresAt || entry.expiresAt.getTime() > now) &&
    (!entry.claimedUntil || entry.claimedUntil.getTime() <= now)).sort(offlineMessageFifo).slice(0, limit);
};

export const insertOfflineMessage = (data: any, collectionName: string): any => {
  const collection = storage[collectionName] || (storage[collectionName] = []);
  const existing = collection.find((entry) => entry.dedupeKey === data.dedupeKey);
  if (existing) return existing;
  const stored = { state: 'active', ...data };
  collection.push({ pk: pk++, ...stored });
  return stored;
};

export const claimOfflineMessage = (condition: Record<string, unknown>, leaseUntil: Date, claimId: string, collectionName: string): any => {
  // Do not skip an already-claimed FIFO head to claim a later row. A slow or
  // recovering head intentionally blocks this mailbox until ACK, rejection,
  // expiry, or lease recovery.
  const message = nextActiveOfflineMessage(condition, collectionName);
  if (!message) return null;
  if (message.claimedUntil instanceof Date && message.claimedUntil.getTime() > Date.now()) return null;
  message.claimedUntil = leaseUntil;
  message.claimId = claimId;
  return message;
};

export const offlineMessageClaimUntil = (condition: Record<string, unknown>, collectionName: string): Date | undefined => {
  const message = nextActiveOfflineMessage(condition, collectionName);
  return message?.claimedUntil instanceof Date && message.claimedUntil.getTime() > Date.now() ? message.claimedUntil : undefined;
};

export const ackOfflineMessage = (condition: Record<string, unknown>, collectionName: string): boolean => {
  const collection = storage[collectionName] || [];
  const index = collection.findIndex((entry) => Object.keys(condition).every((key) => entry[key] === condition[key]) &&
    (Object.prototype.hasOwnProperty.call(condition, 'claimId') ? entry.claimId === condition.claimId : entry.claimId === undefined));
  if (index < 0) return false;
  collection.splice(index, 1);
  return true;
};

export const rejectOfflineMessage = (condition: Record<string, unknown>, reasonClass: string, now: Date, collectionName: string): 'rejected' | 'duplicate' | 'stale' => {
  const collection = storage[collectionName] || [];
  const active = collection.find((entry) => entry.state !== 'rejected' && Object.keys(condition).every((key) => entry[key] === condition[key]));
  if (active) {
    active.state = 'rejected';
    active.terminalReason = reasonClass;
    active.terminalAt = now;
    active.terminalClaimId = condition.claimId;
    // Previous relays do not filter `state`; keep their legacy lease query
    // from claiming an empty terminal row until the original TTL expires.
    active.claimedUntil = active.expiresAt;
    delete active.envelope;
    delete active.claimId;
    delete active.slot;
    return 'rejected';
  }
  const prior = collection.find((entry) => entry.state === 'rejected' && Object.keys(condition).filter((key) => key !== 'claimId').every((key) => entry[key] === condition[key]) && entry.terminalClaimId === condition.claimId);
  return prior ? 'duplicate' : 'stale';
};

export const recordOfflineRejection = (data: Record<string, unknown>, collectionName: string): 'rejected' | 'duplicate' => {
  const collection = storage[collectionName] || (storage[collectionName] = []);
  const existing = collection.find((entry) => entry.dedupeKey === data.dedupeKey);
  if (existing?.state === 'rejected') return 'duplicate';
  if (existing) {
    existing.state = 'rejected';
    existing.terminalReason = data.terminalReason;
    existing.terminalAt = data.terminalAt;
    existing.terminalClaimId = undefined;
    existing.claimedUntil = existing.expiresAt;
    delete existing.envelope;
    delete existing.claimId;
    delete existing.slot;
    return 'rejected';
  }
  collection.push({ pk: pk++, ...data, state: 'rejected', claimedUntil: data.expiresAt });
  return 'rejected';
};

export const deleteExpiredOfflineMessages = (now: number, collectionName: string): number => {
  const collection = storage[collectionName] || [];
  const retained = collection.filter((entry) => !(entry.expiresAt instanceof Date) || entry.expiresAt.getTime() > now);
  storage[collectionName] = retained;
  return collection.length - retained.length;
};

export const countOfflineMessages = (condition: Record<string, unknown>, collectionName: string): number =>
  (storage[collectionName] || []).filter((entry) => entry.state !== 'rejected' && Object.keys(condition).every((key) => entry[key] === condition[key]) && (!entry.expiresAt || entry.expiresAt.getTime() > Date.now())).length;
