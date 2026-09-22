import express, { Request, Response } from 'express';

import chatHashController from './chatHash';
import chatController from './messaging';
import { createProductionAttachmentRouter } from './attachments/production';

const router = express.Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  res.send({ message: "/api is working!" });
});

router.use("/chat", chatController);
router.use("/chat-link", chatHashController);
router.use('/attachments', createProductionAttachmentRouter());

export default router;
