import express, { type Request } from 'express';
import db from '../../db';
import { controlRateLimit } from '../../middleware/controlRateLimit';
import { authorizeRoomControl, isValidRoomId, readControlCapability } from '../../security/controlCapability';
import { durableDeviceTrustAuthority } from '../../security/durableDeviceTrust';
import type { DeviceAuthorizationProof } from '../../security/deviceTrust';
import { bindVerifiedRouting, durableRoutingEnabled, RoutingAuthorizationError, routingOwnershipStore, routingContinuation } from '../../security/routingOwnership';
import { purgeRemovedRoute } from '../../security/contactRemoval';
import { validBundle } from './prekeys';

const router = express.Router({ mergeParams: true });
class RoomGone extends Error {}
/** Room capability and a fresh device proof for this room. Does not yet say the device owns the claimed address. */
const proven = async (req: Request, goneIsDistinct = false) => {
  if (!durableRoutingEnabled()) throw new Error('unavailable');
  const { channel, address } = req.params, participant = req.get('X-K3ncrypt-Participant') ?? '', routingProof = req.get('X-K3ncrypt-Routing-Proof') ?? '';
  if (!isValidRoomId(channel) || !isValidRoomId(address) || !isValidRoomId(participant) || !/^[A-Za-z0-9_-]{43}$/.test(routingProof)) throw new RoutingAuthorizationError();
  const room = await authorizeRoomControl(channel, readControlCapability(req) ?? '');
  if (!room) throw new RoutingAuthorizationError();
  if (room.deleted || room.expired) throw goneIsDistinct ? new RoomGone() : new RoutingAuthorizationError();
  const encoded = req.get('X-K3ncrypt-Device-Proof') ?? '';
  if (encoded.length > 8192) throw new RoutingAuthorizationError();
  const proof = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DeviceAuthorizationProof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new RoutingAuthorizationError();
  if (proof.nonce !== req.get('X-K3ncrypt-Device-Nonce')) throw new RoutingAuthorizationError();
  const authority = durableDeviceTrustAuthority(db.getDatabase()), store = routingOwnershipStore();
  if (!authority || !store) throw new Error('unavailable');
  const device = await authority.verify(proof, 'device-control', { conversationId: channel });
  return { channel, address, participant, routingProof, device, until: proof.expiresAt, store };
};
const admitted = async (req: Request) => {
  const a = await proven(req);
  const owner = await bindVerifiedRouting(a.channel, a.participant, a.routingProof, a.device, a.until);
  if (!owner) throw new RoutingAuthorizationError();
  return { ...a, owner };
};
const handler = (run: (req: Request) => Promise<unknown>): express.RequestHandler => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await run(req)); }
  catch (error) {
    if (error instanceof RoomGone) { res.status(410).json({ status: 'gone' }); return; }
    const denied = error instanceof RoutingAuthorizationError || error instanceof SyntaxError ||
      error instanceof Error && error.message === 'Device proof rejected.';
    res.status(!durableRoutingEnabled() || !denied ? 503 : 403)
      .json({ error: 'Authenticated routing recovery unavailable', code: 'ROUTING_RECOVERY_REQUIRED' });
  }
};
router.get('/:address/identity', controlRateLimit, handler(async req => {
  const a = await admitted(req), owner = await a.store.current(a.channel, a.address);
  if (a.until <= Date.now()) throw new RoutingAuthorizationError();
  if (!owner) {
    // A participant who removed this contact left a tombstone. The requester already pinned that public identity, and the
    // answer must not differ from an ordinary offline peer, so the same durable identity is returned. It authorises nothing.
    const removed = a.address === a.participant ? undefined : await a.store.removedOwner(a.channel, a.address);
    if (!removed) throw new RoutingAuthorizationError();
    await routingContinuation(a.channel, a.participant, a.owner, a.until).assertTrusted();
    return { version: 1, identity: removed.identity };
  }
  await routingContinuation(a.channel, a.address, owner, a.until).assertTrusted();
  await routingContinuation(a.channel, a.participant, a.owner, a.until).assertTrusted();
  // No temporary key is retained or fabricated. This cannot bootstrap a new Olm session.
  return { version: 1, identity: owner.identity };
}));
router.post('/:address/prekeys', controlRateLimit, handler(async req => {
  if (!validBundle(req.body)) throw new RoutingAuthorizationError();
  const a = await admitted(req); if (a.participant !== a.address) throw new RoutingAuthorizationError();
  await a.store.renew(a.channel, a.address, a.routingProof, a.device, a.until, req.body);
  return { status: 'renewed' };
}));
/**
 * Remove contact: a device withdraws its own address from the room. Repeatable (the client retries until it sees 200 or 410).
 * Afterwards the relay accepts and drops the other participant's mail for this address, keeps no mail or wake route for it,
 * and never admits it to the room again. 410 means the room itself is already gone.
 */
router.delete('/:address', controlRateLimit, handler(async req => {
  const a = await proven(req, true); if (a.participant !== a.address) throw new RoutingAuthorizationError();
  await a.store.revoke(a.channel, a.address, a.routingProof, a.device, a.until);
  await purgeRemovedRoute(a.channel, a.address);
  return { status: 'revoked' };
}));
export default router;
