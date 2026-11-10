import { STORAGE_CAPS, STORAGE_FULL_MESSAGE } from '../db/storageCaps';
import express from 'express';
import { createPushRegistry, pushConfigured, type PushEvent } from '../push/privateWake';
import { revokeWakeRoute } from '../push/authenticatedWakeRoutes';
import db from '../db';
import { durableDeviceTrustAuthority, type DurableDeviceTrustAuthority } from '../security/durableDeviceTrust';
import type { BootstrapRequest, EnrollmentEvent, DeviceProofRequest } from '../../service/src/devices/trustProtocol';
import type { SignedLifecycleEvent } from '../security/lifecycleEvent';
import { revokeMuxDeviceSubscriptions } from '../socket.io/multiplexed';

const router = express.Router();

/**
 * These capability-only mutations are intentionally disabled. A room bearer
 * is not a device identity and must never create, revoke, or refresh trust.
 * The signed lifecycle-event endpoint is enabled only once the WASM signer is
 * rebuilt and its end-to-end verification path is available.
 */
const authority = (): DurableDeviceTrustAuthority | undefined => durableDeviceTrustAuthority(db.getDatabase());
/** Registers or removes a device's push token. Needs a fresh device proof plus a signature over the token hash. 503 when push is not configured. */
router.post('/push', async (req, res) => {
  if (!pushConfigured()) return res.status(503).send({ error: 'Push unavailable' });
  try {
    const database = db.getDatabase(); const registry = database && createPushRegistry(database, db.getMongoClient());
    const body = req.body as { event?: PushEvent; deviceAuthorizationProof?: import('../security/deviceTrust').DeviceAuthorizationProof; token?: string };
    if (!registry || !body.event || !body.deviceAuthorizationProof || !Object.keys(body).every((key) => ['event', 'deviceAuthorizationProof', 'token'].includes(key))) return res.status(403).send({ error: 'Push rejected' });
    await registry.update(body.event, body.deviceAuthorizationProof, body.token);
    return res.send({ status: 'accepted' });
  } catch { return res.status(403).send({ error: 'Push rejected' }); }
});
/**
 * A removed contact must not be able to ring this device. The participant withdraws its wake route for (room, own address),
 * proving it with the room control capability and its routing proof. The answer never says whether a route existed.
 */
router.post('/push/route-revoke', async (req, res) => {
  const body = req.body as { room?: unknown; address?: unknown };
  const control = req.get('X-K3ncrypt-Control-Capability'); const proof = req.get('X-K3ncrypt-Routing-Proof');
  if (!body || typeof body !== 'object' || Object.keys(body).some((key) => !['room', 'address'].includes(key)) || typeof body.room !== 'string' || typeof body.address !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(body.room) || !/^[0-9a-f-]{36}$/.test(body.address) || typeof control !== 'string' || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return res.status(400).send({ error: 'Malformed route revocation' });
  try {
    const database = db.getDatabase();
    if (database && pushConfigured()) await revokeWakeRoute(database, { room: body.room, address: body.address, control, routingProof: proof });
    return res.send({ status: 'ok' });
  } catch { return res.send({ status: 'ok' }); }
});
router.post('/bootstrap', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); if (await db.collectionCount('device_lifecycle') >= STORAGE_CAPS.devices) return res.status(503).send({ error: STORAGE_FULL_MESSAGE }); /* P1-2: global device cap */ return res.status(201).send(await value.bootstrap(req.body as BootstrapRequest)); } catch { return res.status(403).send({ error: 'Initial device bootstrap rejected' }); } });
router.post('/enrollment', async (req, res) => { try { const value = authority(); const body = req.body as { event?: EnrollmentEvent; deviceAuthorizationProof?: import('../security/deviceTrust').DeviceAuthorizationProof; proofNonce?: string }; if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); if (!body.event || !body.deviceAuthorizationProof || body.proofNonce !== body.deviceAuthorizationProof.nonce) return res.status(403).send({ error: 'Lifecycle enrollment rejected' }); return res.status(201).send(await value.enroll(body.event, body.deviceAuthorizationProof)); } catch { return res.status(403).send({ error: 'Lifecycle enrollment rejected' }); } });
router.post('/activation', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); return res.send(await value.activate(req.body as SignedLifecycleEvent)); } catch { return res.status(403).send({ error: 'Lifecycle activation rejected' }); } });
router.post('/update', async (req, res) => { try { const value = authority(); const body = req.body as { event?: SignedLifecycleEvent; deviceAuthorizationProof?: import('../security/deviceTrust').DeviceAuthorizationProof }; if (!value || !body.event || !body.deviceAuthorizationProof) return res.status(403).send({ error: 'Lifecycle update rejected' }); const updated = await value.update(body.event, body.deviceAuthorizationProof); if (updated.state === 'revoked') revokeMuxDeviceSubscriptions(updated.accountIdentityReference, updated.deviceId); return res.send(updated); } catch { return res.status(403).send({ error: 'Lifecycle update rejected' }); } });
router.post('/proof', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); return res.send(await value.issue(req.body as DeviceProofRequest)); } catch { return res.status(403).send({ error: 'Device proof rejected' }); } });
router.post(['/register', '/revoke'], (_req, res) => res.status(410).send({ error: 'Signed lifecycle events are required' }));
export default router;
