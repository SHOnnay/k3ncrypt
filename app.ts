import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import path from 'path';

import apiController from './backend/api';
import { corsOrigin } from './backend/security/cors';
import { safeErrorHandler } from './backend/middleware/safeErrorHandler';
import { productionWebHeaders } from './backend/security/webHeaders';
import { maintenanceHttpGate } from './backend/operations/maintenanceGate';

require("dotenv").config();

const app = express();
app.disable("x-powered-by");
app.use(productionWebHeaders);
if (process.env.K3NCRYPT_TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(cors({ origin: corsOrigin, credentials: false, exposedHeaders: ['Retry-After'] }));
app.use(maintenanceHttpGate);
app.use(bodyParser.json({ limit: '64kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '64kb' }));

// add routes
app.use("/api", apiController);

if (process.env.NODE_ENV === "production") {
  const clientDirectory = path.resolve(process.cwd(), 'client/dist');
  app.use(express.static(clientDirectory));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDirectory, "index.html"));
  });
} else {
  app.get("/*", (req, res) => {
    res.status(500).send("Cant serve production build in dev mode, please open react dev server");
  });
}

app.use(safeErrorHandler);

export default app;
