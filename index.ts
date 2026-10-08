require("dotenv").config();
import app from './app';
import db from './backend/db';
import { initSocket } from './backend/socket.io';
import { initSyncRelay } from './backend/sync/relay';
import { initPrivateNetworkRelay } from './backend/privateNetwork/relay';
import { validateProductionConfig } from './backend/security/productionConfig';
import { operationalLog } from './backend/operations/logger';

const PORT = process.env.PORT || 3001;
const BIND_HOST = process.env.K3NCRYPT_BIND_HOST;

validateProductionConfig();
void (async () => {
  await db.connectDb();
  const onListening = () => operationalLog('info', 'server_listening', { port: Number(PORT) });
  const server = BIND_HOST ? app.listen(Number(PORT), BIND_HOST, onListening) : app.listen(PORT, onListening);
  initSocket(server);
  initSyncRelay(server);
  initPrivateNetworkRelay(server);
})().catch((error: unknown) => {
  operationalLog('error', 'startup_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
  process.exitCode = 1;
});
