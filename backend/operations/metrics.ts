import { createHash, timingSafeEqual } from 'crypto';
import db from '../db';
import { LINK_COLLECTION, OFFLINE_MESSAGE_COLLECTION } from '../db/const';
import { STORAGE_CAPS } from '../db/storageCaps';
import { privateCallWakeCounters } from '../push/callWake';
import { privateWakeCounters } from '../push/privateWake';

/**
 * Operator counters with no identifiers: no rooms, devices, addresses, tokens, IPs or timestamps of single events.
 * Only fixed names from this list can be counted, so a caller can never smuggle data into a metric name.
 */
const EVENTS = ['envelope_stored', 'envelope_discarded_removed_contact', 'envelope_refused', 'contact_removed', 'call_wake_requested',
  'join_accepted', 'join_rejected_malformed-request', 'join_rejected_room-control', 'join_rejected_routing-authorization', 'join_rejected_device-proof',
  'join_rejected_device-socket-limit', 'join_rejected_invalid-channel', 'join_rejected_channel-full', 'join_rejected_room-transport-conflict'] as const;
export type MetricEvent = typeof EVENTS[number];
const counts = new Map<MetricEvent, number>(EVENTS.map((name) => [name, 0]));
const startedAt = Date.now();

export const countEvent = (name: MetricEvent): void => { counts.set(name, Math.min(Number.MAX_SAFE_INTEGER, (counts.get(name) ?? 0) + 1)); };
export const countJoinRejection = (code: string): void => {
  const name = `join_rejected_${code}`;
  if ((EVENTS as readonly string[]).includes(name)) countEvent(name as MetricEvent);
};

/** Off unless K3NCRYPT_METRICS_TOKEN (32+ characters) is set. Compared in constant time. */
export const metricsAuthorized = (authorization: string | undefined): boolean => {
  const token = process.env.K3NCRYPT_METRICS_TOKEN;
  if (!token || token.length < 32 || !authorization?.startsWith('Bearer ')) return false;
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(token));
};
export const metricsConfigured = (): boolean => (process.env.K3NCRYPT_METRICS_TOKEN?.length ?? 0) >= 32;

export const metricsSnapshot = async (): Promise<Record<string, unknown>> => {
  const database = db.getDatabase();
  const size = async (name: string): Promise<number | null> => database ? database.collection(name).estimatedDocumentCount().catch(() => null) : null;
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    events: Object.fromEntries(counts),
    wake: database ? { message: privateWakeCounters(database), call: privateCallWakeCounters(database) } : null,
    storage: {
      waitingEnvelopes: { count: await size(OFFLINE_MESSAGE_COLLECTION), cap: STORAGE_CAPS.offlineGlobal },
      rooms: { count: await size(LINK_COLLECTION), cap: STORAGE_CAPS.rooms },
      devices: { count: await size('device_lifecycle'), cap: STORAGE_CAPS.devices },
    },
  };
};
export const testOnlyResetMetrics = (): void => { for (const name of EVENTS) counts.set(name, 0); };
