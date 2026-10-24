import { createHash, timingSafeEqual } from 'crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import db from '../db';
import { LINK_COLLECTION, PREKEY_COLLECTION } from '../db/const';
import type { DeviceLifecycleRecord } from './deviceTrust';
import { fingerprintVodozemacIdentity, type VodozemacPublicIdentity } from '../../service/src/identity/vodozemacIdentity';

export const durableRoutingEnabled = (): boolean => process.env.K3NCRYPT_DURABLE_ROUTING === 'true';
export interface RoutingOwner {
  address: string; identity: VodozemacPublicIdentity; identityReference: string; renewalProofHash: string;
  accountIdentityReference: string; deviceId: string; deviceEpoch: number; verificationKeyReference: string;
  state: 'active' | 'revoked'; generation: number; establishedAt: Date; revokedAt?: Date;
}
interface RoutingRoom { hash: string; deleted?: boolean; expired?: boolean; routingOwnershipVersion?: number; routingOwnershipRevision?: number; routingOwners?: RoutingOwner[]; }
export class RoutingAuthorizationError extends Error { constructor() { super('Routing authorization unavailable.'); } }
const deny = (): never => { throw new RoutingAuthorizationError(); };
const live = (room: RoutingRoom | null | undefined): room is RoutingRoom => !!room && room.deleted !== true && room.expired !== true;
export const routingProofHash = (proof: string): string => createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest('hex');
export const routingProofMatches = (proof: unknown, hash: unknown): boolean => {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(routingProofHash(proof), 'hex'), Buffer.from(hash, 'hex'));
};
const matchesDevice = (owner: RoutingOwner, device: DeviceLifecycleRecord): boolean => device.state === 'active' &&
  owner.accountIdentityReference === device.accountIdentityReference && owner.deviceId === device.deviceId &&
  owner.deviceEpoch === device.trustEpoch && owner.identityReference === device.deviceIdentityReference &&
  owner.verificationKeyReference === device.verificationKeyReference;

/** Two durable slots per room, including tombstones. No positive authorization cache. */
export class RoutingOwnershipStore {
  constructor(private readonly database: Db, private readonly client: MongoClient, private readonly now: () => number = Date.now) {}
  async room(channel: string, session?: ClientSession): Promise<RoutingRoom | null> {
    return this.database.collection<RoutingRoom>(LINK_COLLECTION).findOne({ hash: channel }, { session, readPreference: 'primary', maxTimeMS: 5000 });
  }
  /** One snapshot command checks room, owner and device together on the primary. */
  async current(channel: string, address: string): Promise<RoutingOwner | undefined> {
    const record = await this.database.collection<RoutingRoom>(LINK_COLLECTION).aggregate<RoutingOwner>([
      { $match: { hash: channel, deleted: { $ne: true }, expired: { $ne: true } } },
      { $unwind: '$routingOwners' },
      { $match: { 'routingOwners.address': address, 'routingOwners.state': 'active' } },
      { $lookup: { from: 'device_lifecycle', let: { owner: '$routingOwners' }, pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$accountIdentityReference', '$$owner.accountIdentityReference'] }, { $eq: ['$deviceId', '$$owner.deviceId'] },
          { $eq: ['$state', 'active'] }, { $eq: ['$trustEpoch', '$$owner.deviceEpoch'] },
          { $eq: ['$deviceIdentityReference', '$$owner.identityReference'] }, { $eq: ['$verificationKeyReference', '$$owner.verificationKeyReference'] },
        ] } } }, { $project: { _id: 1 } },
      ], as: 'authorizedDevice' } },
      { $match: { 'authorizedDevice.0': { $exists: true } } }, { $replaceWith: '$routingOwners' },
    ], { readPreference: 'primary', readConcern: { level: 'snapshot' }, maxTimeMS: 5000 }).next();
    return record ?? undefined;
  }
  private deadline(until: number): void { if (!Number.isFinite(until) || until <= this.now()) deny(); }
  private async transact<T>(run: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 5000 }, maxCommitTimeMS: 5000 });
        try { const result = await run(session); await session.commitTransaction(); return result; }
        catch (error) {
          await session.abortTransaction().catch(() => undefined);
          if (attempt === 2 || !(error as { hasErrorLabel?: (label: string) => boolean })?.hasErrorLabel?.('TransientTransactionError')) throw error;
        }
      }
      return deny();
    } finally { await session.endSession(); }
  }
  /** Writes serialize against the existing device-revocation document, not a separate trust authority. */
  private async fenceDevice(owner: RoutingOwner, session: ClientSession): Promise<void> {
    const result = await this.database.collection('device_lifecycle').updateOne({
      accountIdentityReference: owner.accountIdentityReference, deviceId: owner.deviceId, state: 'active',
      deviceIdentityReference: owner.identityReference, verificationKeyReference: owner.verificationKeyReference, trustEpoch: owner.deviceEpoch,
    }, { $inc: { routingAuthorizationFence: 1 } }, { session });
    if (result.matchedCount !== 1) deny();
  }
  async adopt(channel: string, address: string, proof: string, admitted: DeviceLifecycleRecord, until: number): Promise<RoutingOwner> {
    this.deadline(until);
    return this.transact(async session => {
      this.deadline(until); const room = await this.room(channel, session); if (!live(room)) return deny();
      const existing = room.routingOwners?.find(o => o.address === address);
      if (existing) {
        if (existing.state !== 'active' || !matchesDevice(existing, admitted) || !routingProofMatches(proof, existing.renewalProofHash)) return deny();
        await this.fenceDevice(existing, session); this.deadline(until);
        await this.database.collection(LINK_COLLECTION).updateOne({ hash: channel }, { $inc: { routingOwnershipRevision: 1 } }, { session, maxTimeMS: 5000 }); return existing;
      }
      if ((room.routingOwners?.length ?? 0) >= 2) return deny();
      const publication = await this.database.collection(PREKEY_COLLECTION).findOne({ channel, address, expiresAt: { $gt: new Date(this.now()) } }, { session });
      if (!publication?.bundle?.identity || !routingProofMatches(proof, publication.renewalProofHash)) return deny();
      const identity = publication.bundle.identity as VodozemacPublicIdentity;
      const identityReference = await fingerprintVodozemacIdentity(identity);
      if (admitted.state !== 'active' || admitted.deviceIdentityReference !== identityReference || admitted.verificationKeyReference !== identity.ed25519) return deny();
      const owner: RoutingOwner = { address, identity: { ...identity }, identityReference, renewalProofHash: publication.renewalProofHash,
        accountIdentityReference: admitted.accountIdentityReference, deviceId: admitted.deviceId, deviceEpoch: admitted.trustEpoch,
        verificationKeyReference: admitted.verificationKeyReference, state: 'active', generation: 1, establishedAt: new Date(this.now()) };
      await this.fenceDevice(owner, session); this.deadline(until);
      const updated = await this.database.collection<RoutingRoom>(LINK_COLLECTION).updateOne({ hash: channel, deleted: { $ne: true }, expired: { $ne: true } }, {
        $set: { routingOwnershipVersion: 1, routingOwners: [...(room.routingOwners ?? []), owner] }, $inc: { routingOwnershipRevision: 1 },
      }, { session });
      if (updated.matchedCount !== 1) return deny(); return owner;
    });
  }
  async renew(channel: string, address: string, proof: string, admitted: DeviceLifecycleRecord, until: number, bundle: unknown): Promise<void> {
    this.deadline(until);
    await this.transact(async session => {
      const room = await this.room(channel, session); const owner = room?.routingOwners?.find(o => o.address === address);
      if (!live(room) || !owner || owner.state !== 'active' || !matchesDevice(owner, admitted) || !routingProofMatches(proof, owner.renewalProofHash) ||
          (bundle as { identity?: VodozemacPublicIdentity })?.identity?.curve25519 !== owner.identity.curve25519 ||
          (bundle as { identity?: VodozemacPublicIdentity })?.identity?.ed25519 !== owner.identity.ed25519) return deny();
      await this.fenceDevice(owner, session); this.deadline(until);
      // A room write conflicts with concurrent ownership revocation and room deletion.
      await this.database.collection(LINK_COLLECTION).updateOne({ hash: channel }, { $inc: { routingOwnershipRevision: 1 } }, { session });
      const at = new Date(this.now());
      await this.database.collection(PREKEY_COLLECTION).replaceOne({ channel, address }, { channel, address, bundle,
        renewalProofHash: owner.renewalProofHash, createdAt: at, expiresAt: new Date(at.getTime() + 7 * 86400000) }, { upsert: true, session });
    });
  }
  async revoke(channel: string, address: string, proof: string, admitted: DeviceLifecycleRecord, until: number): Promise<void> {
    this.deadline(until);
    await this.transact(async session => {
      const room = await this.room(channel, session); const owner = room?.routingOwners?.find(o => o.address === address);
      if (!live(room) || !owner || owner.state !== 'active' || !matchesDevice(owner, admitted) || !routingProofMatches(proof, owner.renewalProofHash)) return deny();
      await this.fenceDevice(owner, session); this.deadline(until);
      const owners = room.routingOwners!.map(o => o.address === address ? { ...o, state: 'revoked' as const, generation: o.generation + 1, revokedAt: new Date(this.now()) } : o);
      await this.database.collection(LINK_COLLECTION).updateOne({ hash: channel }, { $set: { routingOwners: owners }, $inc: { routingOwnershipRevision: 1 } }, { session });
    });
  }
}

export const routingOwnershipStore = (): RoutingOwnershipStore | undefined => {
  const database = db.getDatabase(), client = db.getMongoClient();
  return database && client ? new RoutingOwnershipStore(database, client) : undefined;
};

/** Existing records always override legacy publication checks, including tombstones. */
export const currentRoutingIdentity = async (channel: string, address: string, allowLegacy = true): Promise<string | undefined> => {
  const store = routingOwnershipStore(); const room = await store?.room(channel);
  if (room?.routingOwners?.some(o => o.address === address)) return (await store!.current(channel, address))?.identityReference;
  if (!allowLegacy || room?.routingOwnershipVersion === 1 && !durableRoutingEnabled()) return undefined;
  const publication = await db.findOneFromDB<{ expiresAt: Date; bundle?: { identity?: VodozemacPublicIdentity } }>({ channel, address }, PREKEY_COLLECTION);
  if (!publication?.bundle?.identity || !(publication.expiresAt instanceof Date) || publication.expiresAt.getTime() <= Date.now()) return undefined;
  return fingerprintVodozemacIdentity(publication.bundle.identity);
};
export const authorizeCurrentRouting = async (channel: string, address: string, proof: unknown): Promise<boolean> => {
  const store = routingOwnershipStore(); const room = await store?.room(channel);
  if (room?.routingOwners?.some(o => o.address === address)) {
    const owner = await store!.current(channel, address); return !!owner && routingProofMatches(proof, owner.renewalProofHash) && durableRoutingEnabled();
  }
  if (room?.routingOwnershipVersion === 1 && !durableRoutingEnabled()) return false;
  const publication = await db.findOneFromDB<{ expiresAt: Date; renewalProofHash: string }>({ channel, address }, PREKEY_COLLECTION);
  return !!publication && publication.expiresAt instanceof Date && publication.expiresAt.getTime() > Date.now() && routingProofMatches(proof, publication.renewalProofHash);
};
export const bindVerifiedRouting = async (channel: string, address: string, proof: string, admitted: DeviceLifecycleRecord, until: number): Promise<RoutingOwner | undefined> => {
  const store = routingOwnershipStore(); const room = await store?.room(channel);
  if (!durableRoutingEnabled()) { if (room?.routingOwnershipVersion === 1) return deny(); return undefined; }
  if (!store) return deny();
  const present = room?.routingOwners?.find(o => o.address === address);
  if (present) {
    const owner = await store.current(channel, address);
    if (!owner || !matchesDevice(owner, admitted) || !routingProofMatches(proof, owner.renewalProofHash) || until <= Date.now()) return deny();
    return owner;
  }
  return store.adopt(channel, address, proof, admitted, until);
};
export const boundRoutingDevice = async (channel: string, address: string, device: Pick<DeviceLifecycleRecord, 'accountIdentityReference' | 'deviceId' | 'trustEpoch'>): Promise<boolean> => {
  const store = routingOwnershipStore(); const room = await store?.room(channel);
  if (!durableRoutingEnabled() && room?.routingOwnershipVersion !== 1) return true;
  if (!durableRoutingEnabled()) return false;
  const owner = await store?.current(channel, address);
  return !!owner && owner.accountIdentityReference === device.accountIdentityReference && owner.deviceId === device.deviceId && owner.deviceEpoch === device.trustEpoch;
};

export const routingContinuation = (channel: string, address: string, owner: RoutingOwner, until: number): { assertTrusted(): Promise<void> } => ({
  assertTrusted: async () => {
    if (!durableRoutingEnabled() || until <= Date.now()) return deny();
    const current = await routingOwnershipStore()?.current(channel, address);
    if (!current || current.generation !== owner.generation || current.identityReference !== owner.identityReference ||
        current.deviceId !== owner.deviceId || current.accountIdentityReference !== owner.accountIdentityReference ||
        current.deviceEpoch !== owner.deviceEpoch || until <= Date.now()) return deny();
  },
});
