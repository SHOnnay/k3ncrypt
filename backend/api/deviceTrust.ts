import express from 'express';
import db from '../db';
import { durableDeviceTrustAuthority, type DurableDeviceTrustAuthority } from '../security/durableDeviceTrust';
import type { BootstrapRequest, EnrollmentEvent, DeviceProofRequest } from '../../service/src/devices/trustProtocol';
import type { SignedLifecycleEvent } from '../security/lifecycleEvent';

const router = express.Router();

/**
 * These capability-only mutations are intentionally disabled. A room bearer
 * is not a device identity and must never create, revoke, or refresh trust.
 * The signed lifecycle-event endpoint is enabled only once the WASM signer is
 * rebuilt and its end-to-end verification path is available.
 */
const authority = (): DurableDeviceTrustAuthority | undefined => durableDeviceTrustAuthority(db.getDatabase());
router.post('/bootstrap', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); return res.status(201).send(await value.bootstrap(req.body as BootstrapRequest)); } catch { return res.status(403).send({ error: 'Initial device bootstrap rejected' }); } });
router.post('/enrollment', async (req, res) => { try { const value = authority(); const body = req.body as { event?: EnrollmentEvent; deviceAuthorizationProof?: import('../security/deviceTrust').DeviceAuthorizationProof; proofNonce?: string }; if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); if (!body.event || !body.deviceAuthorizationProof || body.proofNonce !== body.deviceAuthorizationProof.nonce) return res.status(403).send({ error: 'Lifecycle enrollment rejected' }); return res.status(201).send(await value.enroll(body.event, body.deviceAuthorizationProof)); } catch { return res.status(403).send({ error: 'Lifecycle enrollment rejected' }); } });
router.post('/activation', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); return res.send(await value.activate(req.body as SignedLifecycleEvent)); } catch { return res.status(403).send({ error: 'Lifecycle activation rejected' }); } });
router.post('/update', async (req, res) => { try { const value = authority(); const body = req.body as { event?: SignedLifecycleEvent; deviceAuthorizationProof?: import('../security/deviceTrust').DeviceAuthorizationProof }; if (!value || !body.event || !body.deviceAuthorizationProof) return res.status(403).send({ error: 'Lifecycle update rejected' }); return res.send(await value.update(body.event, body.deviceAuthorizationProof)); } catch { return res.status(403).send({ error: 'Lifecycle update rejected' }); } });
router.post('/proof', async (req, res) => { try { const value = authority(); if (!value) return res.status(503).send({ error: 'Device trust unavailable' }); return res.send(await value.issue(req.body as DeviceProofRequest)); } catch { return res.status(403).send({ error: 'Device proof rejected' }); } });
router.post(['/register', '/revoke'], (_req, res) => res.status(410).send({ error: 'Signed lifecycle events are required' }));
export default router;
