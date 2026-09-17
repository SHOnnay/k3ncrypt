import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import path from 'path';

import apiController from './backend/api';
import { corsOrigin } from './backend/security/cors';

require("dotenv").config();

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(bodyParser.json({ limit: '64kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '64kb' }));

// add routes
app.use("/api", apiController);

if (process.env.NODE_ENV === "production") {
  app.use(express.static("client/dist"));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
  });
} else {
  app.get("/*", (req, res) => {
    res.status(500).send("Cant serve production build in dev mode, please open react dev server");
  });
}

export default app;
