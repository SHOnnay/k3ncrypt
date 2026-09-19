import express from 'express';

import db from '../../db';
import { LINK_COLLECTION } from '../../db/const';
import asyncHandler from '../../middleware/asyncHandler';
import channelValid, { CHANNEL_STATE } from './utils/validateChannel';
import generateHash from './utils/link';
import { controlRateLimit } from '../../middleware/controlRateLimit';
import {
  authorizeRoomControl,
  isValidControlCapability,
  isValidControlCapabilityHash,
  isValidRoomId,
  readControlCapability,
} from '../../security/controlCapability';
import prekeysRouter from './prekeys';

const router = express.Router({ mergeParams: true });

router.use('/:channel/prekeys', prekeysRouter);

router.post(
  "/",
  controlRateLimit,
  asyncHandler(async (req, res) => {
    const { controlCapabilityHash } = req.body ?? {};
    if (Object.keys(req.body ?? {}).some((key) => key !== 'controlCapabilityHash') ||
        !isValidControlCapabilityHash(controlCapabilityHash)) {
      return res.status(400).send({ error: 'Invalid control capability verifier' });
    }
    const link = generateHash(controlCapabilityHash);
    await db.insertInDb(link, LINK_COLLECTION);
    const { hash, expired, deleted } = link;
    return res.send({ hash, expired, deleted });
  })
);
router.get(
  "/status/:channel",
  controlRateLimit,
  asyncHandler(async (req, res) => {
    const { channel } = req.params;
    const capability = readControlCapability(req);
    if (!isValidRoomId(channel) || !isValidControlCapability(capability)) {
      return res.status(400).send({ error: 'Malformed room control request' });
    }
    if (!await authorizeRoomControl(channel, capability)) {
      return res.status(401).send({ error: 'Unauthorized room control capability' });
    }
    const { valid, state } = await channelValid(channel);

    if (!valid) {
      if (state === CHANNEL_STATE.DELETED) {
        return res.status(410).send({ error: "Channel deleted", state });
      }
      return res.status(404).send({ error: "Invalid channel", state });
    }

    return res.send({ status: "ok", state });
  })
);
router.delete(
  "/:channel",
  controlRateLimit,
  asyncHandler(async (req, res) => {
    const { channel } = req.params;
    const capability = readControlCapability(req);
    if (!isValidRoomId(channel) || !isValidControlCapability(capability)) {
      return res.status(400).send({ error: 'Malformed room control request' });
    }
    if (!await authorizeRoomControl(channel, capability)) {
      return res.status(401).send({ error: 'Unauthorized room control capability' });
    }
    const { state } = await channelValid(channel);

    const invalidstates = [ CHANNEL_STATE.DELETED, CHANNEL_STATE.NOT_FOUND ];
    if (invalidstates.includes(state)) {
      return res.status(404).send({ error: 'Invalid channel' });
    }

    await db.updateOneFromDb({ hash: channel }, { deleted: true }, LINK_COLLECTION);
    return res.send({ status: "ok" });
  })
);

export default router;
