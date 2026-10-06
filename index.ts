require("dotenv").config();
import app from './app';
import db from './backend/db';
import { initSocket } from './backend/socket.io';
import { initSyncRelay } from './backend/sync/relay';
import { initPrivateNetworkRelay } from './backend/privateNetwork/relay';
import { validateProductionConfig } from './backend/security/productionConfig';
import { operationalLog } from './backend/operations/logger';

const PORT = process.env.PORT || 3001;

validateProductionConfig();
void (async () => {
  await db.connectDb();
  const onListening = () => operationalLog('info', 'server_listening', { port: Number(PORT) });
  // Keep the development backend private to this Mac. The local HTTPS proxy is
  // the only process intended to accept LAN traffic for interoperability tests.
  const server = process.env.NODE_ENV === 'development'
    ? app.listen(Number(PORT), '127.0.0.1', onListening)
    : app.listen(PORT, onListening);
  initSocket(server);
  initSyncRelay(server);
  initPrivateNetworkRelay(server);
})().catch((error: unknown) => {
  operationalLog('error', 'startup_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
  process.exitCode = 1;
});
