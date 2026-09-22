import express from 'express';
import db from '../db';
import type { NetworkMembershipEvent } from '../../service/src/devices/trustProtocol';
import type { DeviceAuthorizationProof } from '../security/deviceTrust';
import { DurableNetworkMembershipAuthority } from '../security/networkMembership';
const router = express.Router();
router.post('/:operation', async (req, res) => { try { const database = db.getDatabase(); const body = req.body as { event?: NetworkMembershipEvent; deviceAuthorizationProof?: DeviceAuthorizationProof }; if (!database || !body.event || !body.deviceAuthorizationProof || !['add-member', 'remove-member', 'update-capability'].includes(body.event.operation) || body.event.operation !== req.params.operation) return res.status(403).send({ error: 'Network membership rejected' }); return res.status(200).send(await new DurableNetworkMembershipAuthority(database).apply(body.event, body.deviceAuthorizationProof)); } catch { return res.status(403).send({ error: 'Network membership rejected' }); } });
export default router;
