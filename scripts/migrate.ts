import 'dotenv/config';
import db from '../backend/db';
import { applyMigrations } from '../backend/db/migrations';

const run = async (): Promise<void> => {
  if (!process.env.MONGO_URI || !process.env.MONGO_DB_NAME) throw new Error('MONGO_URI and MONGO_DB_NAME are required for migrations.');
  await db.connectDb();
  const database = db.getDatabase();
  if (!database) throw new Error('Persistent database connection unavailable.');
  await applyMigrations(database);
  process.stdout.write('K3NCRYPT migrations applied successfully.\n');
};
void run().catch(() => { process.stderr.write('K3NCRYPT migrations failed.\n'); process.exitCode = 1; });
