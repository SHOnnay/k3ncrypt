import { createHash, createPublicKey, randomUUID, verify } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import type { Db, MongoClient, Filter } from 'mongodb';
import { wakeSchemaReady } from './durableWakeStore';
import type { DeviceAuthorizationProof, DeviceLifecycleRecord } from '../security/deviceTrust';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { captureAdmittedWakeRoute, type AdmittedWakeRoute } from './authenticatedWakeRoutes';
import { DurableWakeRuntime } from './durableWakeRuntime';
import { WakeDispatcher, emptyWakeCounters, type WakeCounters } from './wakeDispatcher';

export type PushEvent = {
  version: 1; requestId: string; accountIdentityReference: string; deviceId: string;
  deviceIdentityReference: string; trustEpoch: number; operation: 'register' | 'remove';
  tokenHash: string; createdAt: number; expiresAt: number; nonce: string; signature: string;
};
export type PushRow = { _id: string; token: string; accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; trustEpoch: number; updatedAt: Date; registrationVersion?: string };
export type WakePayload = { version: '1'; type: 'encrypted-activity' | 'call' | 'call-cancel'; eventId: string; createdAt: string; expiresAt: string };
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export const canonicalPushEvent = (event: PushEvent): string => JSON.stringify({ version: event.version, requestId: event.requestId,
  accountIdentityReference: event.accountIdentityReference, deviceId: event.deviceId, deviceIdentityReference: event.deviceIdentityReference,
  trustEpoch: event.trustEpoch, operation: event.operation, tokenHash: event.tokenHash, createdAt: event.createdAt, expiresAt: event.expiresAt, nonce: event.nonce });
export const wakePayload = (now: number): WakePayload => ({ version: '1', type: 'encrypted-activity', eventId: randomUUID(), createdAt: String(now), expiresAt: String(now + 60_000) });
const eventKeys = 'accountIdentityReference,createdAt,deviceId,deviceIdentityReference,expiresAt,nonce,operation,requestId,signature,tokenHash,trustEpoch,version';
export const validPushEvent = (event: PushEvent, now: number): boolean => !!event && Object.keys(event).sort().join(',') === eventKeys &&
  event.version === 1 && /^[0-9a-f-]{36}$/.test(event.requestId) && /^[0-9a-f-]{36}$/.test(event.deviceId) &&
  typeof event.accountIdentityReference === 'string' && event.accountIdentityReference.length <= 128 &&
  typeof event.deviceIdentityReference === 'string' && event.deviceIdentityReference.length <= 128 &&
  Number.isSafeInteger(event.trustEpoch) && event.trustEpoch >= 1 && ['register', 'remove'].includes(event.operation) &&
  /^[a-f0-9]{64}$/.test(event.tokenHash) && Number.isSafeInteger(event.createdAt) && Number.isSafeInteger(event.expiresAt) &&
  event.createdAt >= 0 && event.createdAt <= now + 5_000 && event.expiresAt > event.createdAt && event.expiresAt > now && event.expiresAt - event.createdAt <= 30_000 &&
  /^[A-Za-z0-9_-]{16,128}$/.test(event.nonce) && /^[A-Za-z0-9_-]{86}$/.test(event.signature);
export const verifyPushEvent = (event: PushEvent, record: DeviceLifecycleRecord): boolean => {
  try {
    const key = Buffer.from(record.verificationKeyReference, 'base64url');
    return key.length === 32 && verify(null, Buffer.from(canonicalPushEvent(event)), createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki',
    }), Buffer.from(event.signature, 'base64url'));
  } catch { return false; }
};

export interface PushStore {
  register(row: PushRow): Promise<void>;
  remove(account: string, device: string, hash?: string): Promise<void>;
  removeObserved(row: PushRow): Promise<boolean>;
  readActive(account: string, device: string): Promise<DeviceLifecycleRecord | undefined>;
  rowsForIdentity(identity: string): Promise<PushRow[]>;
}
export class MongoPushStore implements PushStore {
  constructor(private readonly db: Db, private readonly client?: MongoClient) {}
  async register(row: PushRow): Promise<void> {
    if (!this.client || !await wakeSchemaReady(this.db)) throw new Error('PUSH_SCHEMA_UNAVAILABLE');
    const session = this.client.startSession();
    try {
      session.startTransaction({ maxCommitTimeMS: 2000 });
      // Token hash remains globally unique; unique device index makes concurrent rotation conflict.
      await this.db.collection<PushRow>('device_push_tokens_v1').deleteMany({ accountIdentityReference: row.accountIdentityReference, deviceId: row.deviceId }, { session, maxTimeMS: 2000 });
      await this.db.collection<PushRow>('device_push_tokens_v1').insertOne(row, { session });
      await session.commitTransaction();
    } catch (error) { if (session.inTransaction()) await session.abortTransaction().catch(() => undefined); throw error; }
    finally { await session.endSession(); }
  }

  async remove(account: string, device: string, hash?: string): Promise<void> {
    await this.db.collection<PushRow>('device_push_tokens_v1').deleteMany({ accountIdentityReference: account, deviceId: device, ...(hash ? { _id: hash } : {}) });
  }
  /** Compare every observed registration field; never delete another epoch or a rotated/re-registered token. */
  private observed(row: PushRow): Filter<PushRow> { return { _id: row._id, token: row.token, accountIdentityReference: row.accountIdentityReference,
    deviceId: row.deviceId, deviceIdentityReference: row.deviceIdentityReference, trustEpoch: row.trustEpoch, updatedAt: row.updatedAt, registrationVersion: row.registrationVersion ?? { $exists: false } }; }
  async isCurrent(row: PushRow): Promise<boolean> {
    return !!await this.db.collection<PushRow>('device_push_tokens_v1').findOne(this.observed(row), { projection: { _id: 1 } });
  }
  async removeObserved(row: PushRow): Promise<boolean> {
    return (await this.db.collection<PushRow>('device_push_tokens_v1').deleteOne(this.observed(row))).deletedCount === 1;
  }
  async readActive(account: string, device: string): Promise<DeviceLifecycleRecord | undefined> { return new MongoDeviceTrustStore(this.db).read(account, device); }
  async rowsForIdentity(identity: string): Promise<PushRow[]> { return this.db.collection<PushRow>('device_push_tokens_v1').find({ deviceIdentityReference: identity }).limit(8).toArray(); }
}

/** Tokens are routing handles only. Registration requires both a fresh device proof and a signature over the token hash. */
export class PrivatePushRegistry {
  private outstanding = 0;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly store: PushStore, private readonly authorize: (proof: DeviceAuthorizationProof) => Promise<DeviceLifecycleRecord>,
    private readonly enabled: () => boolean, private readonly now: () => number = Date.now) {}
  async update(event: PushEvent, proof: DeviceAuthorizationProof, token?: string): Promise<void> {
    if (!this.enabled()) throw new Error('PUSH_DISABLED');
    if (this.outstanding >= 128) throw new Error('PUSH_BUSY');
    this.outstanding += 1;
    try { await this.updateAuthorized(event, proof, token); } finally { this.outstanding -= 1; }
  }
  private async updateAuthorized(event: PushEvent, proof: DeviceAuthorizationProof, token?: string): Promise<void> {
    if (!validPushEvent(event, this.now()) || proof.operation !== 'device-control' || proof.nonce !== event.nonce || proof.resource !== undefined) throw new Error('PUSH_REJECTED');
    if (event.operation === 'register' && (typeof token !== 'string' || !/^[A-Za-z0-9:._-]{16,4096}$/.test(token) || tokenHash(token) !== event.tokenHash)) throw new Error('PUSH_REJECTED');
    const record = await this.authorize(proof);
    if (record.state !== 'active' || record.accountIdentityReference !== event.accountIdentityReference || record.deviceId !== event.deviceId ||
      record.deviceIdentityReference !== event.deviceIdentityReference || record.trustEpoch !== event.trustEpoch || !verifyPushEvent(event, record)) throw new Error('PUSH_REJECTED');
    const owner = `${record.accountIdentityReference}\0${record.deviceId}`;
    if (this.locks.size >= 128 && !this.locks.has(owner)) throw new Error('PUSH_BUSY');
    const previous = this.locks.get(owner) ?? Promise.resolve(); let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; }); this.locks.set(owner, current);
    await previous;
    try {
      if (!this.enabled() || !validPushEvent(event, this.now())) throw new Error('PUSH_REJECTED');
      const active = await this.store.readActive(record.accountIdentityReference, record.deviceId);
      if (!active || active.state !== 'active' || active.trustEpoch !== record.trustEpoch || active.deviceIdentityReference !== record.deviceIdentityReference) throw new Error('PUSH_REJECTED');
      if (event.operation === 'remove') await this.store.remove(record.accountIdentityReference, record.deviceId, event.tokenHash === '0'.repeat(64) ? undefined : event.tokenHash);
      else {
        const registration: PushRow = { _id: event.tokenHash, token: token!, accountIdentityReference: record.accountIdentityReference, deviceId: record.deviceId,
          deviceIdentityReference: record.deviceIdentityReference, trustEpoch: record.trustEpoch, updatedAt: new Date(this.now()), registrationVersion: randomUUID() };
        await this.store.register(registration);
        const after = await this.store.readActive(record.accountIdentityReference, record.deviceId);
        if (!after || after.state !== 'active' || after.trustEpoch !== record.trustEpoch) {
          await this.store.removeObserved(registration); throw new Error('PUSH_REJECTED');
        }
      }
    } finally { release(); if (this.locks.get(owner) === current) this.locks.delete(owner); }
  }
}

/** No SDK initialization, credentials read, token mutation or network request unless explicitly configured. */
export const pushConfigured = (): boolean => process.env.K3NCRYPT_FCM_ENABLED === 'true' &&
  !!process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH && existsSync(process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH) && !!process.env.K3NCRYPT_FCM_PROJECT_ID;
const registries = new WeakMap<Db, { secret: string; registry: PrivatePushRegistry }>();
export const createPushRegistry = (db: Db, client?: MongoClient): PrivatePushRegistry | undefined => {
  if (!pushConfigured() || !process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET || !client) return undefined;
  const secret = process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET;
  const previous = registries.get(db); if (previous?.secret === secret) return previous.registry;
  const authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(db), secret);
  const registry = new PrivatePushRegistry(new MongoPushStore(db, client), (proof) => authority.verify(proof, 'device-control'), pushConfigured);
  registries.set(db, { secret, registry }); return registry;
};

let pending = 0;
const dispatchers = new WeakMap<Db, WakeDispatcher>();
/** The only place that talks to Firebase. No provider/configuration access until the disabled-by-default gate has passed. */
export const sendFcm = async (token: string, data: WakePayload, ttl: number, collapseKey?: string): Promise<void> => {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  if (!pushConfigured()) throw new Error('PUSH_DISABLED');
  const app = getApps().find((value) => value.name === 'k3ncrypt-private-push') ?? initializeApp({
    credential: cert(JSON.parse(readFileSync(process.env.K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH!, 'utf8'))), projectId: process.env.K3NCRYPT_FCM_PROJECT_ID,
  }, 'k3ncrypt-private-push');
  if (!pushConfigured()) throw new Error('PUSH_DISABLED');
  await getMessaging(app).send({ token, data, android: { priority: 'high', ttl, ...(collapseKey ? { collapseKey } : {}) } });
};
const dispatcherFor = (db: Db): WakeDispatcher => {
  const existing = dispatchers.get(db); if (existing) return existing;
  const dispatcher = new WakeDispatcher(new MongoPushStore(db), (token, data, ttl) => sendFcm(token, data, ttl, 'encrypted_activity'), pushConfigured, wakePayload);
  dispatchers.set(db, dispatcher); return dispatcher;
};
/** Aggregate process-local counters only. No identifiers, provider errors, tokens, or public HTTP endpoint. */
export const privateWakeCounters = (db: Db): Readonly<WakeCounters> => dispatchers.get(db)?.snapshot() ?? emptyWakeCounters();
const runtimes = new WeakMap<Db, DurableWakeRuntime>();
const runtimeFor = (db: Db): DurableWakeRuntime => {
  let runtime = runtimes.get(db);
  if (!runtime) { runtime = new DurableWakeRuntime(db, dispatcherFor(db)); runtimes.set(db, runtime); }
  return runtime;
};
export const startPrivateWakeWorker = (db: Db): (() => void) => {
  if (!pushConfigured()) return () => {};
  const runtime = runtimeFor(db); runtime.start(); return () => runtime.stop();
};
export const durableWakeCounters = (db: Db) => runtimes.get(db)?.snapshot();
export const recordAdmittedPushRoute = (db: Db | undefined, input: AdmittedWakeRoute): void => {
  if (!db || !pushConfigured() || pending >= 32) return;
  pending++;
  void (async () => { if (await wakeSchemaReady(db) && !await captureAdmittedWakeRoute(db, input)) dispatcherFor(db).lookupRejected(); })()
    .catch(() => { dispatcherFor(db).lookupFailed(); }).finally(() => { pending--; });
};
/** Called after successful persistence only. Never awaited by mail insertion or sender acceptance. */
export const notifyEncryptedMailboxStored = (db: Db, room: unknown, recipient: unknown, id?: unknown): void => {
  if (!pushConfigured()) return;
  void runtimeFor(db).enqueuePersisted(room, recipient, id).catch(() => { dispatcherFor(db).lookupFailed(); });
};
