import express, { Request, Response } from 'express';

import chatHashController from './chatHash';
import chatController from './messaging';
import { createProductionAttachmentRouter } from './attachments/production';
import { createProductionFileRouter } from './attachments/files';
import operationsController from './operations';
import { apiRateLimit } from '../middleware/apiRateLimit';
import deviceTrustController from './deviceTrust';
import networkMembershipController from './networkMembership';

const router = express.Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  res.send({ message: "/api is working!" });
});

router.use(operationsController);
router.use(apiRateLimit);

router.use("/chat", chatController);
router.use("/chat-link", chatHashController);
router.use('/device-trust', deviceTrustController);
router.use('/network-membership', networkMembershipController);
router.use('/attachments/v2', createProductionFileRouter());
router.use('/attachments', createProductionAttachmentRouter());

export default router;
