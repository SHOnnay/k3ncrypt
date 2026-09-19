import express from 'express';
import { randomUUID } from 'crypto';
import db from '../../db';
import { PREKEY_COLLECTION } from '../../db/const';
import asyncHandler from '../../middleware/asyncHandler';
import { controlRateLimit } from '../../middleware/controlRateLimit';
import { authorizeRoomControl, isValidControlCapability, isValidRoomId, readControlCapability } from '../../security/controlCapability';

const router = express.Router({ mergeParams: true });
const MAX_BUNDLE_BYTES = 32 * 1024;
const MAX_KEYS = 100;
const BASE64_KEY = /^[A-Za-z0-9_-]{43}$/;
const ADDRESS = /^[0-9a-f-]{36}$/i;

const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

const validKey = (value: unknown): value is string => typeof value === 'string' && BASE64_KEY.test(value);

const validBundle = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (JSON.stringify(value).length > MAX_BUNDLE_BYTES) return false;
  const bundle = value as Record<string, unknown>;
  if (!exactKeys(bundle, ['fallbackKey', 'identity', 'oneTimeKeys', 'protocol', 'version']) &&
      !exactKeys(bundle, ['identity', 'oneTimeKeys', 'protocol', 'version'])) return false;
  if (bundle.version !== 1 || bundle.protocol !== 'vodozemac-olm-v1' || !Array.isArray(bundle.oneTimeKeys) || bundle.oneTimeKeys.length > MAX_KEYS) return false;
  const identity = bundle.identity as Record<string, unknown>;
  if (!identity || !exactKeys(identity, ['curve25519', 'ed25519']) || !validKey(identity.curve25519) || !validKey(identity.ed25519)) return false;
  const ids = new Set<string>();
  for (const item of bundle.oneTimeKeys) {
    if (!item || typeof item !== 'object' || !exactKeys(item as Record<string, unknown>, ['id', 'key'])) return false;
    const key = item as Record<string, unknown>;
    if (typeof key.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key.id) || !validKey(key.key) || ids.has(key.id)) return false;
    ids.add(key.id);
  }
  if (bundle.fallbackKey !== undefined) {
    const fallback = bundle.fallbackKey as Record<string, unknown>;
    if (!fallback || !exactKeys(fallback, ['id', 'key']) || typeof fallback.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(fallback.id) || !validKey(fallback.key) || ids.has(fallback.id)) return false;
  }
  return true;
};

const authorize = async (channel: unknown, capability: string | undefined): Promise<boolean> =>
  isValidRoomId(channel) && isValidControlCapability(capability) && !!await authorizeRoomControl(channel, capability);

router.post('/', controlRateLimit, asyncHandler(async (req, res) => {
  const channel = req.params.channel;
  const capability = readControlCapability(req);
  if (!await authorize(channel, capability) || !validBundle(req.body)) return res.status(400).send({ error: 'Invalid pre-key bundle' });
  const address = randomUUID();
  await db.insertInDb({ channel, address, bundle: req.body, createdAt: Date.now() }, PREKEY_COLLECTION);
  return res.status(201).send({ address });
}));

router.get('/:address', controlRateLimit, asyncHandler(async (req, res) => {
  const { channel, address } = req.params;
  const capability = readControlCapability(req);
  if (!ADDRESS.test(address) || !await authorize(channel, capability)) return res.status(404).send({ error: 'Pre-key bundle unavailable' });
  const record = await db.findOneFromDB<{ bundle: unknown }>({ channel, address }, PREKEY_COLLECTION);
  return record ? res.send(record.bundle) : res.status(404).send({ error: 'Pre-key bundle unavailable' });
}));

router.post('/:address/claim', controlRateLimit, asyncHandler(async (req, res) => {
  const { channel, address } = req.params;
  const capability = readControlCapability(req);
  const keyId = req.body?.keyId;
  if (!ADDRESS.test(address) || typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(keyId) || !await authorize(channel, capability)) {
    return res.status(404).send({ error: 'Pre-key unavailable' });
  }
  const claimed = await db.claimOneTimeKey<{ id: string; key: string }>({ channel, address }, keyId, PREKEY_COLLECTION);
  return claimed ? res.send(claimed) : res.status(409).send({ error: 'Pre-key unavailable' });
}));

export default router;
