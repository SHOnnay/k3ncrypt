require("dotenv").config();
import app from './app';
import db from './backend/db';
import { initSocket } from './backend/socket.io';
import { initSyncRelay } from './backend/sync/relay';
import { initPrivateNetworkRelay } from './backend/privateNetwork/relay';
import { validateProductionConfig } from './backend/security/productionConfig';
import { operationalLog } from './backend/operations/logger';
import { startPrivateWakeWorker } from './backend/push/privateWake';

const PORT = process.env.PORT || 3001;
const BIND_HOST = process.env.K3NCRYPT_BIND_HOST;

validateProductionConfig();
// Last-resort guard: a stray rejection fails only the request that caused it.
// Request handlers fail closed on their own; nothing about the payload is logged.
process.on('unhandledRejection', (reason: unknown) => {
  operationalLog('error', 'unhandled_rejection', { errorType: reason instanceof Error ? reason.name : typeof reason });
});
void (async () => {
  await db.connectDb();
  const onListening = () => operationalLog('info', 'server_listening', { port: Number(PORT) });
  const server = BIND_HOST ? app.listen(Number(PORT), BIND_HOST, onListening) : app.listen(PORT, onListening);
  initSocket(server);
  initSyncRelay(server);
  initPrivateNetworkRelay(server);
  // Content-free push wake-ups. Returns a no-op unless K3NCRYPT_FCM_ENABLED=true and the credentials are present.
  const database = db.getDatabase();
  const stopWakes = database ? startPrivateWakeWorker(database) : () => undefined;
  server.once('close', stopWakes);
  process.once('SIGTERM', stopWakes);
  process.once('SIGINT', stopWakes);
})().catch((error: unknown) => {
  operationalLog('error', 'startup_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
  process.exitCode = 1;
});
