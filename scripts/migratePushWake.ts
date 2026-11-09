import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { applyWakeSchema } from '../backend/push/durableWakeStore';

/** Separate operator-approved optional migration. Never chained to startup/core migrations. */
async function run(): Promise<void> {
  if (!process.argv.includes('--apply') || process.env.K3NCRYPT_FCM_ENABLED === 'true') throw new Error('PUSH_MIGRATION_REQUIRES_EXPLICIT_APPLY_AND_FCM_OFF');
  if (!process.env.MONGO_URI || !process.env.MONGO_DB_NAME) throw new Error('PUSH_MIGRATION_DATABASE_REQUIRED');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); await applyWakeSchema(client.db(process.env.MONGO_DB_NAME)); process.stdout.write('Optional wake schema ready. Firebase remains off.\n'); }
  finally { await client.close(); }
}
void run().catch(() => { process.stderr.write('Optional wake migration failed; core mail was not migrated.\n'); process.exitCode = 1; });
