import { createHash } from 'crypto';
import type { Db } from 'mongodb';
import { maintenanceModeEnabled } from '../operations/maintenanceGate';
import { registrationsForRoute, validWakeRoute } from './authenticatedWakeRoutes';
import { routeKey, wakeSchemaReady } from './durableWakeStore';
import { MongoPushStore, pushConfigured, sendFcm, type PushRow, type WakePayload } from './privateWake';
import { WakeDispatcher, emptyWakeCounters, type WakeCounters } from './wakeDispatcher';

/**
 * Content-free incoming-call wake-up. The caller's client asks the relay (`call-wake` event); the relay never detects calls itself.
 * Off unless push is configured AND K3NCRYPT_CALL_WAKE_ENABLED === 'true' AND maintenance mode is off. Writes nothing durable.
 * Payload = { version, type: 'call' | 'call-cancel', eventId (caller-chosen uuid), createdAt, expiresAt }: no names, rooms or contacts.
 */
export const CALL_WAKE_LIFETIME_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validWakeId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const callWakeEnabled = (): boolean => pushConfigured() && process.env.K3NCRYPT_CALL_WAKE_ENABLED === 'true' && !maintenanceModeEnabled();
export const callWakePayload = (type: 'call' | 'call-cancel', eventId: string, now: number): WakePayload =>
  ({ version: '1', type, eventId, createdAt: String(now), expiresAt: String(now + CALL_WAKE_LIFETIME_MS) });

const hashKey = (...parts: string[]): string => createHash('sha256').update(parts.join('\0')).digest('hex');

/** Token bucket + hourly cap per key. A full map refuses unknown keys (fail closed) instead of evicting and resetting limits. */
class KeyedLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number; hour: number[] }>();
  constructor(private readonly capacity: number, private readonly refillMs: number, private readonly perHour: number, private readonly maxKeys = 4096) {}
  admit(key: string, now: number): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) { this.sweep(now); if (this.buckets.size >= this.maxKeys) return false; }
      bucket = { tokens: this.capacity, at: now, hour: [] }; this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) / this.refillMs); bucket.at = now;
    bucket.hour = bucket.hour.filter((t) => now - t < 3_600_000);
    if (bucket.tokens < 1 || bucket.hour.length >= this.perHour) return false;
    bucket.tokens -= 1; bucket.hour.push(now); return true;
  }
  private sweep(now: number): void { for (const [key, bucket] of this.buckets) if (now - bucket.at > 3_600_000) this.buckets.delete(key); }
}

export class CallWakeLimiter {
  private readonly caller = new KeyedLimit(4, 15_000, 40);
  private readonly pair = new KeyedLimit(1, 8_000, 20);
  private readonly target = new KeyedLimit(3, 20_000, 30);
  private readonly global = new KeyedLimit(120, 500, Number.MAX_SAFE_INTEGER, 1);
  admitCaller(key: string, now = Date.now()): boolean { return this.caller.admit(key, now); }
  admitPair(key: string, now = Date.now()): boolean { return this.pair.admit(key, now); }
  admitTarget(key: string, now = Date.now()): boolean { return this.target.admit(key, now); }
  admitGlobal(now = Date.now()): boolean { return this.global.admit('all', now); }
}

type Kind = 'ring' | 'cancel';
export type CallWakeRequest = { room: string; recipient: string; callerAccount: string; callerDevice: string; wakeId: string; kind: Kind };

const limiter = new CallWakeLimiter();
const dispatchers = new WeakMap<Db, WakeDispatcher>();
const IN_FLIGHT_MAX = 16;
let inFlight = 0;
/** Rings that were really sent: a cancel is honoured only for the same caller device and target. Bounded, short-lived, in memory. */
const sentRings = new Map<string, { pair: string; at: number }>();
const rememberRing = (wakeId: string, pair: string, now: number): void => {
  for (const [id, ring] of sentRings) if (now - ring.at > 60_000) sentRings.delete(id);
  if (sentRings.size >= 512) return;
  sentRings.set(wakeId, { pair, at: now });
};

const dispatcherFor = (db: Db): WakeDispatcher => {
  const existing = dispatchers.get(db); if (existing) return existing;
  // A separate instance from message wakes: a call is never coalesced with, or throttled by, a message wake. No FCM collapse key.
  const dispatcher = new WakeDispatcher(new MongoPushStore(db), (token, data, ttl) => sendFcm(token, data, ttl), callWakeEnabled, (now) => callWakePayload('call', '00000000-0000-4000-8000-000000000000', now));
  dispatchers.set(db, dispatcher); return dispatcher;
};
export const privateCallWakeCounters = (db: Db): Readonly<WakeCounters> => dispatchers.get(db)?.snapshot() ?? emptyWakeCounters();

/** Fire-and-forget. Never throws, never awaited by signalling. */
export const requestCallWake = (db: Db | undefined, input: CallWakeRequest): void => {
  if (!db || !callWakeEnabled()) return;
  void run(db, input).catch(() => dispatcherFor(db).lookupFailed());
};

async function run(db: Db, input: CallWakeRequest): Promise<void> {
  const now = Date.now();
  const callerKey = hashKey(input.callerAccount, input.callerDevice);
  const targetRoute = routeKey(input.room, input.recipient);
  const pairKey = hashKey(callerKey, targetRoute);
  if (input.kind === 'ring') {
    // Caller-side limits first, before any database read, so abuse cannot cause database load.
    if (!limiter.admitCaller(callerKey, now) || !limiter.admitPair(pairKey, now)) return;
    rememberRing(input.wakeId, pairKey, now); // recorded at request time so a quick cancel is not lost to the send race
  } else {
    const ring = sentRings.get(input.wakeId);
    if (!ring || ring.pair !== pairKey) return;      // only the caller of a real ring may cancel it, once
    sentRings.delete(input.wakeId);
  }
  if (inFlight >= IN_FLIGHT_MAX) return;
  inFlight++;
  try {
    if (!await wakeSchemaReady(db)) return;
    const rows = await registrationsForRoute(db, input.room, input.recipient);
    const row = rows[0];
    if (!row || (row.accountIdentityReference === input.callerAccount && row.deviceId === input.callerDevice)) return;
    const store = new MongoPushStore(db);
    const authorized = async (): Promise<boolean> => {
      if (!callWakeEnabled() || !row.registrationVersion) return false;
      const active = await store.readActive(row.accountIdentityReference, row.deviceId);
      if (!active || active.state !== 'active' || active.trustEpoch !== row.trustEpoch || active.deviceIdentityReference !== row.deviceIdentityReference) return false;
      if (!await store.isCurrent(row) || !await validWakeRoute(db, row, [targetRoute])) return false;
      // A removed contact stops renewing its pre-key publication; without a live one the route no longer counts.
      return !!await db.collection('prekey_bundles').findOne({ channel: input.room, address: input.recipient, expiresAt: { $gt: new Date() } }, { projection: { _id: 1 } });
    };
    const data = callWakePayload(input.kind === 'ring' ? 'call' : 'call-cancel', input.wakeId, now);
    await dispatcherFor(db).dispatch(row as PushRow, {
      data,
      authorized,
      // The target and global budgets are spent only on a send that is already authorised (rings only; a cancel must not be starved).
      beforeSend: async () => input.kind === 'cancel' || (limiter.admitTarget(row._id, Date.now()) && limiter.admitGlobal(Date.now())),
      allowed: callWakeEnabled,
    });
  } finally { inFlight--; }
}
