import express, { Request, Response } from 'express';

import asyncHandler from '../../middleware/asyncHandler';
import getClientInstance from '../../socket.io/clients';
import channelValid from '../chatHash/utils/validateChannel';
import { UsersInChannelResponse } from './types';
import { controlRateLimit } from '../../middleware/controlRateLimit';
import {
  authorizeRoomControl,
  isValidControlCapability,
  isValidRoomId,
  readControlCapability,
} from '../../security/controlCapability';

const router = express.Router({ mergeParams: true });
const clients = getClientInstance();

router.get(
  "/get-users-in-channel",
  controlRateLimit,
  asyncHandler(async (req: Request, res: Response): Promise<Response<UsersInChannelResponse>> => {
    const { channel } = req.query;
    const capability = readControlCapability(req);

    if (Object.keys(req.query).some((key) => key !== 'channel') ||
        !isValidRoomId(channel) || !isValidControlCapability(capability)) {
      return res.status(400).send({ error: 'Malformed room control request' } as never);
    }
    if (!await authorizeRoomControl(channel, capability)) {
      return res.status(401).send({ error: 'Unauthorized room control capability' } as never);
    }

    const { valid } = await channelValid(channel);

    if (!valid) {
      return res.sendStatus(404);
    }

    const data = clients.getClientsByChannel(channel);
    const usersInChannel = data ? Object.keys(data).map((userId) => ({ uuid: userId })) : [];
    return res.send(usersInChannel);
  })
);

export default router;
