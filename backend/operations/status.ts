import db from '../db';

let messagingRelayReady = false;
let syncRelayReady = false;
let privateNetworkRelayReady = false;

export const markRelayReady = (relay: 'messaging' | 'sync' | 'private-network'): void => {
  if (relay === 'messaging') messagingRelayReady = true;
  else if (relay === 'sync') syncRelayReady = true;
  else privateNetworkRelayReady = true;
};

export const healthStatus = (): { status: 'ok' } => ({ status: 'ok' });

/** Readiness deliberately checks dependencies while liveness remains process-only. */
export const readinessStatus = async (): Promise<{ status: 'ready'; dependencies: Record<string, 'ready'> }> => {
  if (!messagingRelayReady || !syncRelayReady || !privateNetworkRelayReady) throw new Error('Relay initialization incomplete.');
  await db.ping();
  if (!db.persistentStorageReady()) throw new Error('Persistent storage unavailable.');
  if (!await db.requiredIndexesReady()) throw new Error('Required database migrations are incomplete.');
  return { status: 'ready', dependencies: { database: 'ready', messagingRelay: 'ready', syncRelay: 'ready', privateNetworkRelay: 'ready' } };
};
