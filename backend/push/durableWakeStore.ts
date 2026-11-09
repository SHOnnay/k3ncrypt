import { createHash, randomUUID } from 'crypto';
import { Long, type Db, type Collection } from 'mongodb';
import type { PushRow, WakePayload } from './privateWake';

export const WAKE_SLOTS = 'private_wake_slots_v1';
export const PUSH_ROUTES = 'device_push_routes_v1';
export const SLOT_COUNT = 1024;
export const routeKey = (room: string, address: string): string => createHash('sha256').update(`k3ncrypt:push-route:v1\0${room}\0${address}`).digest('hex');
export const ownerKey = (account: string, device: string): string => createHash('sha256').update(`k3ncrypt:push-owner:v1\0${account}\0${device}`).digest('hex');
export type Route = { key: string; room: string; routingAddress: string; identityReference: string; verifiedAt: Date; validUntil: Date };
export type RouteDocument = { _id: string; accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; trustEpoch: number; revision: string; routes: Route[]; updatedAt: Date; expiresAt: Date };
export type Wave = { id: string; createdAt: Date; expiresAt: Date; routeKeys: string[] };
export type Slot = {
  _id: number; generation: Long; state: 'idle' | 'pending' | 'leased'; requestGeneration?: Long;
  registrationId?: string; registrationVersion?: string; trustEpoch?: number; event?: Wave;
  attempts?: number; nextAttemptAt?: Date; lease?: { id: string; until: Date }; successor?: Wave;
};
const opts = { maxTimeMS: 2000 };
const waveSchema = { bsonType: 'object', required: ['id', 'createdAt', 'expiresAt', 'routeKeys'], additionalProperties: false, properties: {
  id: { bsonType: 'string', pattern: '^[a-f0-9-]{36}$' }, createdAt: { bsonType: 'date' }, expiresAt: { bsonType: 'date' },
  routeKeys: { bsonType: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' } },
} };
const slotsValidator = { $and: [
  { $jsonSchema: { bsonType: 'object', required: ['_id', 'generation', 'state'], additionalProperties: false, oneOf: [
    { properties: { state: { enum: ['idle'] } } },
    { required: ['registrationId', 'registrationVersion', 'trustEpoch', 'event', 'attempts', 'nextAttemptAt', 'requestGeneration'], properties: { state: { enum: ['pending'] } } },
    { required: ['registrationId', 'registrationVersion', 'trustEpoch', 'event', 'attempts', 'nextAttemptAt', 'requestGeneration', 'lease'], properties: { state: { enum: ['leased'] } } },
  ], properties: {
    _id: { bsonType: ['int', 'double'], minimum: 0, maximum: 1023, multipleOf: 1 }, generation: { bsonType: 'long' },
    state: { enum: ['idle', 'pending', 'leased'] }, requestGeneration: { bsonType: 'long' },
    registrationId: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, registrationVersion: { bsonType: 'string', maxLength: 36 },
    trustEpoch: { bsonType: ['int', 'double', 'long'], minimum: 1 }, attempts: { bsonType: ['int', 'double'], minimum: 0, maximum: 3 },
    nextAttemptAt: { bsonType: 'date' }, event: waveSchema, successor: waveSchema, lease: { bsonType: 'object', required: ['id', 'until'], additionalProperties: false, properties: { id: { bsonType: 'string', maxLength: 36 }, until: { bsonType: 'date' } } },
  } } },
  { $expr: { $and: [
    { $lte: [{ $bsonSize: '$$ROOT' }, 4096] },
    { $or: [{ $eq: ['$state', 'idle'] }, { $and: [{ $gt: ['$event.expiresAt', '$event.createdAt'] }, { $lte: [{ $subtract: ['$event.expiresAt', '$event.createdAt'] }, 60000] }] }] },
    { $or: [{ $eq: [{ $type: '$successor' }, 'missing'] }, { $and: [{ $gt: ['$successor.expiresAt', '$successor.createdAt'] }, { $lte: [{ $subtract: ['$successor.expiresAt', '$successor.createdAt'] }, 60000] }] }] },
  ] } },
] };
const routesValidator = { $and: [
  { $jsonSchema: { bsonType: 'object', required: ['_id', 'accountIdentityReference', 'deviceId', 'deviceIdentityReference', 'trustEpoch', 'routes', 'revision', 'updatedAt', 'expiresAt'], additionalProperties: false, properties: {
    _id: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, accountIdentityReference: { bsonType: 'string', maxLength: 128 }, deviceId: { bsonType: 'string', maxLength: 36 },
    deviceIdentityReference: { bsonType: 'string', maxLength: 128 }, trustEpoch: { bsonType: ['int', 'double', 'long'], minimum: 1 }, revision: { bsonType: 'string', maxLength: 36 }, updatedAt: { bsonType: 'date' }, expiresAt: { bsonType: 'date' },
    routes: { bsonType: 'array', maxItems: 32, items: { bsonType: 'object', required: ['key', 'room', 'routingAddress', 'identityReference', 'verifiedAt', 'validUntil'], additionalProperties: false, properties: {
      key: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, room: { bsonType: 'string', maxLength: 36 }, routingAddress: { bsonType: 'string', maxLength: 36 }, identityReference: { bsonType: 'string', maxLength: 128 }, verifiedAt: { bsonType: 'date' }, validUntil: { bsonType: 'date' },
    } } },
  } } },
  { $expr: { $and: [
    { $lte: [{ $bsonSize: '$$ROOT' }, 32768] },
    { $eq: [{ $size: '$routes' }, { $size: { $setUnion: ['$routes.key', []] } }] },
    { $allElementsTrue: [{ $map: { input: '$routes', as: 'r', in: { $and: [{ $gte: ['$$r.validUntil', '$$r.verifiedAt'] }, { $lte: ['$$r.validUntil', { $add: ['$$r.verifiedAt', 30 * 24 * 60 * 60_000] }] }] } } }] },
  ] } },
] };

/** EXPLICIT optional migration only. Never called by core startup/readiness or mail persistence. */
export async function applyWakeSchema(db: Db): Promise<void> {
  if (process.env.K3NCRYPT_FCM_ENABLED === 'true') throw new Error('PUSH_MIGRATION_REQUIRES_FCM_OFF');
  const hello = await db.command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('PUSH_TRANSACTIONS_REQUIRED');
  const duplicates = await db.collection('device_push_tokens_v1').aggregate([{ $group: { _id: { a: '$accountIdentityReference', d: '$deviceId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 1 }]).hasNext();
  if (duplicates) throw new Error('PUSH_REGISTRATION_CONFLICT');
  for await (const row of db.collection<PushRow>('device_push_tokens_v1').find({ registrationVersion: { $exists: false } }).batchSize(32)) {
    await db.collection<PushRow>('device_push_tokens_v1').updateOne({ ...row, registrationVersion: { $exists: false } }, { $set: { registrationVersion: randomUUID() } });
  }
  await db.collection('device_push_tokens_v1').createIndex({ accountIdentityReference: 1, deviceId: 1 }, { name: 'push_one_device', unique: true });
  for (const [name, validator] of [[WAKE_SLOTS, slotsValidator], [PUSH_ROUTES, routesValidator]] as const) {
    if (!await db.listCollections({ name }).hasNext()) await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  }
  const slots = db.collection<Slot>(WAKE_SLOTS);
  await slots.bulkWrite(Array.from({ length: SLOT_COUNT }, (_, _id) => ({ updateOne: { filter: { _id }, update: { $setOnInsert: { generation: Long.ZERO, state: 'idle' as const } }, upsert: true } })));
  await slots.createIndex({ registrationId: 1 }, { name: 'wake_one_registration', unique: true, partialFilterExpression: { registrationId: { $exists: true } } });
  await slots.createIndex({ state: 1, nextAttemptAt: 1, _id: 1 }, { name: 'wake_due' });
  await slots.createIndex({ state: 1, 'lease.until': 1, _id: 1 }, { name: 'wake_lease' });
  await slots.createIndex({ 'event.expiresAt': 1, _id: 1 }, { name: 'wake_expiry' });
  const routes = db.collection<RouteDocument>(PUSH_ROUTES);
  await routes.createIndex({ accountIdentityReference: 1, deviceId: 1 }, { name: 'push_route_owner', unique: true });
  await routes.createIndex({ 'routes.key': 1 }, { name: 'push_route_key', unique: true, partialFilterExpression: { 'routes.key': { $exists: true } } });
  await routes.createIndex({ expiresAt: 1 }, { name: 'push_route_expiry', expireAfterSeconds: 0 });
  await db.collection('offline_messages').createIndex({ timestamp: -1, _id: -1 }, { name: 'wake_reconcile_recent' });
}

export async function wakeSchemaReady(db: Db): Promise<boolean> {
  try {
    for (const [name, expected] of [[WAKE_SLOTS, ['wake_one_registration', 'wake_due', 'wake_lease', 'wake_expiry']], [PUSH_ROUTES, ['push_route_owner', 'push_route_key', 'push_route_expiry']], ['device_push_tokens_v1', ['push_one_device']]] as const) {
      const indexes = await db.collection(name).indexes();
      if (expected.some((n) => !indexes.some((i) => i.name === n))) return false;
    }
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    for (const [name, expected] of [[WAKE_SLOTS, slotsValidator], [PUSH_ROUTES, routesValidator]] as const) {
      const info = await db.listCollections({ name }).next();
      if (!info || !('options' in info) || info.options?.validationLevel !== 'strict' || info.options?.validationAction !== 'error' || canonical(info.options?.validator) !== canonical(expected)) return false;
    }
    return await db.collection(WAKE_SLOTS).countDocuments({}, opts) === SLOT_COUNT;
  } catch { return false; }
}

const wave = (keys: string[]): Wave => { const now = Date.now(); return { id: randomUUID(), createdAt: new Date(now), expiresAt: new Date(now + 60_000), routeKeys: [...new Set(keys)].slice(0, 8) }; };
const fresh = { $expr: { $gt: ['$event.expiresAt', '$$NOW'] } };
export class DurableWakeStore {
  private readonly rows: Collection<Slot>;
  constructor(readonly db: Db) { this.rows = db.collection<Slot>(WAKE_SLOTS); }
  private fence(job: Slot) { return { _id: job._id, state: 'leased' as const, generation: job.generation, 'lease.id': job.lease!.id }; }
  async enqueue(row: PushRow, key: string): Promise<boolean> {
    if (!row.registrationVersion) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await this.rows.findOne({ registrationId: row._id }, { ...opts, promoteLongs: false });
      if (existing) {
        // Never retarget a stale wave to a replacement registration.
        if (existing.registrationVersion !== row.registrationVersion || existing.trustEpoch !== row.trustEpoch) {
          if (existing.state === 'leased' && existing.lease!.until.getTime() > Date.now()) return false;
          await this.recycle(existing, false); continue;
        }
        const leased = existing.state === 'leased';
        if (!leased && existing.event!.expiresAt.getTime() <= Date.now()) { await this.recycle(existing, false); continue; }
        const previous = leased ? existing.successor : existing.event;
        if (previous && previous.expiresAt.getTime() > Date.now() && previous.routeKeys.length >= 8 && !previous.routeKeys.includes(key)) return false;
        const next = previous && previous.expiresAt.getTime() > Date.now() ? { ...previous, routeKeys: [...new Set([...previous.routeKeys, key])].slice(0, 8) } : wave([key]);
        const result = await this.rows.updateOne({ _id: existing._id, generation: existing.generation, requestGeneration: existing.requestGeneration }, { $set: leased ? { successor: next } : { event: next }, $inc: { requestGeneration: Long.ONE } }, opts);
        if (result.modifiedCount === 1) return true;
      } else {
        try {
          const result = await this.rows.findOneAndUpdate({ state: 'idle' }, { $set: { state: 'pending', registrationId: row._id, registrationVersion: row.registrationVersion, trustEpoch: row.trustEpoch, event: wave([key]), attempts: 0, nextAttemptAt: new Date(), requestGeneration: Long.ZERO }, $inc: { generation: Long.ONE } }, { ...opts, sort: { _id: 1 }, returnDocument: 'after', includeResultMetadata: false });
          return !!result;
        } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
      }
    }
    return false;
  }
  async claim(): Promise<Slot | null> {
    return this.rows.findOneAndUpdate({ ...fresh, attempts: { $lt: 3 }, $or: [
      { state: 'pending', $expr: { $lte: ['$nextAttemptAt', '$$NOW'] } },
      { state: 'leased', $expr: { $lte: ['$lease.until', '$$NOW'] } },
    ] }, [{ $set: { state: 'leased', generation: { $add: ['$generation', Long.ONE] }, lease: { id: randomUUID(), until: { $min: ['$event.expiresAt', { $add: ['$$NOW', 15_000] }] } } } }], { ...opts, sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: 'after', includeResultMetadata: false, promoteLongs: false });
  }
  async beginAttempt(job: Slot): Promise<boolean> {
    const result = await this.rows.updateOne({ ...this.fence(job), ...fresh, attempts: { $lt: 3 }, $expr: { $and: [{ $gt: ['$event.expiresAt', '$$NOW'] }, { $gt: ['$lease.until', '$$NOW'] }] } }, [{ $set: { attempts: { $add: ['$attempts', 1] }, 'lease.until': { $min: ['$event.expiresAt', { $add: ['$$NOW', 15_000] }] } } }], opts);
    return result.modifiedCount === 1;
  }
  async finish(job: Slot, retry: boolean): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      const current = await this.rows.findOne(this.fence(job), { ...opts, promoteLongs: false });
      if (!current) return false;
      if (retry && current.attempts! < 3 && current.event!.expiresAt.getTime() > Date.now() + 250 * 2 ** (current.attempts! - 1)) {
        const result = await this.rows.updateOne({ ...this.fence(job), requestGeneration: current.requestGeneration }, [{ $set: { state: 'pending', nextAttemptAt: { $add: ['$$NOW', 250 * 2 ** (current.attempts! - 1)] } } }, { $unset: 'lease' }], opts);
        if (result.modifiedCount) return true;
      } else if (await this.recycle(current, true)) return true;
    }
    return false;
  }
  private async recycle(job: Slot, owned: boolean): Promise<boolean> {
    const filter = owned ? this.fence(job) : { _id: job._id, generation: job.generation, state: job.state };
    const successor = job.successor && job.successor.expiresAt.getTime() > Date.now() ? job.successor : undefined;
    const replacement: Slot = successor ? { _id: job._id, generation: job.generation.add(Long.ONE), state: 'pending', registrationId: job.registrationId, registrationVersion: job.registrationVersion, trustEpoch: job.trustEpoch, requestGeneration: Long.ZERO, event: successor, attempts: 0, nextAttemptAt: new Date() } : { _id: job._id, generation: job.generation.add(Long.ONE), state: 'idle' };
    return (await this.rows.replaceOne({ ...filter, requestGeneration: job.requestGeneration }, replacement, opts)).modifiedCount === 1;
  }
  async expire(): Promise<{ expired: number; exhausted: number }> {
    const jobs = await this.rows.aggregate<Slot & { expiredNow: boolean }>([
      { $match: { state: { $ne: 'idle' }, $expr: { $and: [
        { $or: [{ $lte: ['$event.expiresAt', '$$NOW'] }, { $gte: ['$attempts', 3] }] },
        { $or: [{ $ne: ['$state', 'leased'] }, { $lte: ['$lease.until', '$$NOW'] }] },
      ] } } }, { $limit: 32 }, { $addFields: { expiredNow: { $lte: ['$event.expiresAt', '$$NOW'] } } },
    ], { ...opts, promoteLongs: false }).toArray();
    const result = { expired: 0, exhausted: 0 };
    for (const job of jobs) if (await this.recycle(job, false)) result[job.expiredNow ? 'expired' : 'exhausted']++;
    return result;
  }
  payload(job: Slot): WakePayload {
    const event = job.event!;
    return { version: '1', type: 'encrypted-activity', eventId: event.id, createdAt: String(event.createdAt.getTime()), expiresAt: String(event.expiresAt.getTime()) };
  }
}
