require("dotenv").config();
import app from './app';
import db from './backend/db';
import { initSocket } from './backend/socket.io';
import { initSyncRelay } from './backend/sync/relay';
import { validateProductionConfig } from './backend/security/productionConfig';

const PORT = process.env.PORT || 3001;

validateProductionConfig();
void (async () => {
  await db.connectDb();
  const server = app.listen(PORT, () => console.log(`Server running at ${PORT}`));
  initSocket(server);
  initSyncRelay(server);
})();
