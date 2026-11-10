import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { Db } from 'mongodb';
import { MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import type { PushRow } from './privateWake';
import { ownerKey, PUSH_ROUTES, routeKey, type RouteDocument } from './durableWakeStore';

export type AdmittedWakeRoute = { account: string; device: string; epoch: number; room: string; address: string; control: string; routingProof: string; current: () => boolean };
const equalHash = (actual: string, expected: unknown): boolean => typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Called ONLY after existing authenticated room admission. This pointer never authorizes a relay operation. */
export async function captureAdmittedWakeRoute(db: Db, input: AdmittedWakeRoute): Promise<boolean> {
  if (!input.current()) return false;
  const now = Date.now(); const trust = new MongoDeviceTrustStore(db);
  const device = await trust.read(input.account, input.device);
  if (!device || device.state !== 'active' || device.trustEpoch !== input.epoch) return false;
  const registration = await db.collection<PushRow>('device_push_tokens_v1').findOne({ accountIdentityReference: input.account, deviceId: input.device, trustEpoch: input.epoch, deviceIdentityReference: device.deviceIdentityReference, registrationVersion: { $exists: true } });
  if (!registration) return false;
  const publication = await db.collection('prekey_bundles').findOne({ channel: input.room, address: input.address, expiresAt: { $gt: new Date(now) } });
  const room = await db.collection('links').findOne({ hash: input.room });
  const identity = publication?.bundle?.identity as { curve25519?: string; ed25519?: string } | undefined;
  if (!room || room.deleted || room.expired || !equalHash(hash(input.control), room.controlCapabilityHash) ||
      !publication || !equalHash(hash(`k3ncrypt-prekey-renewal-v1\0${input.routingProof}`), publication.renewalProofHash) ||
      !identity || !/^[A-Za-z0-9_-]{43}$/.test(identity.curve25519 ?? '') || identity.ed25519 !== device.verificationKeyReference) return false;
  const digest = createHash('sha256').update(`k3ncrypt:vodozemac-identity:v1\0${identity.curve25519}\0${identity.ed25519}`).digest('base64url').toUpperCase();
  const fingerprint = `K3 ${digest.match(/.{1,4}/g)!.join(' ')}`;
  if (fingerprint !== device.deviceIdentityReference || !input.current()) return false;
  const id = ownerKey(input.account, input.device); const rows = db.collection<RouteDocument>(PUSH_ROUTES);
  const previous = await rows.findOne({ _id: id });
  const routes = previous?.trustEpoch === device.trustEpoch && previous.deviceIdentityReference === fingerprint ? previous.routes.filter((route) => route.validUntil.getTime() > now) : [];
  const key = routeKey(input.room, input.address);
  if (!routes.some((route) => route.key === key) && routes.length >= 32) return false;
  const next = routes.filter((route) => route.key !== key);
  next.push({ key, room: input.room, routingAddress: input.address, identityReference: fingerprint, verifiedAt: new Date(now), validUntil: new Date(now + 30 * 24 * 60 * 60_000) });
  const revision = randomUUID();
  const doc: RouteDocument = { _id: id, accountIdentityReference: input.account, deviceId: input.device, deviceIdentityReference: fingerprint, trustEpoch: device.trustEpoch, revision, routes: next, updatedAt: new Date(now), expiresAt: new Date(Math.max(...next.map((route) => route.validUntil.getTime()))) };
  const current = await trust.read(input.account, input.device);
  if (!input.current() || !current || current.state !== 'active' || current.trustEpoch !== device.trustEpoch || current.deviceIdentityReference !== fingerprint) return false;
  if (previous) {
    if (!(await rows.replaceOne({ _id: id, revision: previous.revision }, doc)).modifiedCount) return false;
  } else { await rows.insertOne(doc); }
  // A concurrent revocation may leave an inert old pointer, never valid notification authority.
  return true;
}

/**
 * A participant who removes a contact withdraws the wake route for (room, its own address). Authority is exactly what created the route:
 * the room control capability plus the routing proof of that address. Returns false when it cannot be proven (for example the
 * pre-key publication has already expired, in which case the route no longer authorises a call wake anyway).
 * Re-joining the room later captures a fresh route, so restoring a contact restores wakes.
 */
export async function revokeWakeRoute(db: Db, input: { room: string; address: string; control: string; routingProof: string }): Promise<boolean> {
  const room = await db.collection('links').findOne({ hash: input.room });
  if (!room || !equalHash(hash(input.control), room.controlCapabilityHash)) return false;
  const publication = await db.collection('prekey_bundles').findOne({ channel: input.room, address: input.address });
  if (!publication || !equalHash(hash(`k3ncrypt-prekey-renewal-v1\0${input.routingProof}`), publication.renewalProofHash)) return false;
  const key = routeKey(input.room, input.address);
  await db.collection<RouteDocument>(PUSH_ROUTES).updateMany({ 'routes.key': key }, { $pull: { routes: { key } }, $set: { revision: randomUUID(), updatedAt: new Date() } });
  return true;
}

/** No prekey query here: a retained binding plus CURRENT existing authority is required. */
export async function validWakeRoute(db: Db, row: PushRow, keys: readonly string[]): Promise<boolean> {
  const doc = await db.collection<RouteDocument>(PUSH_ROUTES).findOne({ _id: ownerKey(row.accountIdentityReference, row.deviceId), trustEpoch: row.trustEpoch, deviceIdentityReference: row.deviceIdentityReference, expiresAt: { $gt: new Date() } });
  if (!doc) return false;
  for (const route of doc.routes) {
    if (!keys.includes(route.key) || route.validUntil.getTime() <= Date.now() || route.identityReference !== row.deviceIdentityReference) continue;
    if (await db.collection('links').findOne({ hash: route.room, deleted: false, expired: false })) return true;
  }
  return false;
}

export async function registrationsForRoute(db: Db, room: string, address: string): Promise<PushRow[]> {
  const key = routeKey(room, address);
  const doc = await db.collection<RouteDocument>(PUSH_ROUTES).findOne({ routes: { $elemMatch: { key, validUntil: { $gt: new Date() } } }, expiresAt: { $gt: new Date() } });
  if (!doc) return [];
  return db.collection<PushRow>('device_push_tokens_v1').find({ accountIdentityReference: doc.accountIdentityReference, deviceId: doc.deviceId, deviceIdentityReference: doc.deviceIdentityReference, trustEpoch: doc.trustEpoch, registrationVersion: { $exists: true } }).limit(1).toArray();
}
