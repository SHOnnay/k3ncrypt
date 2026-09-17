import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

import db from '../db';
import { LINK_COLLECTION } from '../db/const';
import type { LinkType } from '../api/chatHash/utils/link';

export const CONTROL_CAPABILITY_HEADER = 'x-k3ncrypt-control-capability';
const BASE64URL_256_BIT = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidRoomId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export const isValidControlCapability = (value: unknown): value is string =>
  typeof value === 'string' && BASE64URL_256_BIT.test(value);

export const isValidControlCapabilityHash = (value: unknown): value is string =>
  typeof value === 'string' && SHA256_HEX.test(value);

export const hashControlCapability = (capability: string): string =>
  createHash('sha256').update(capability, 'utf8').digest('hex');

export const readControlCapability = (req: Request): string | undefined => {
  const value = req.get(CONTROL_CAPABILITY_HEADER);
  return value || undefined;
};

/**
 * Authorizes a room operation without exposing whether an unauthorized room
 * exists. The database contains only the capability's SHA-256 verifier.
 */
export const authorizeRoomControl = async (channel: string, capability: string): Promise<LinkType | undefined> => {
  const room = await db.findOneFromDB<LinkType>({ hash: channel }, LINK_COLLECTION);
  if (!room || !isValidControlCapabilityHash(room.controlCapabilityHash)) {
    return undefined;
  }
  const supplied = Buffer.from(hashControlCapability(capability), 'hex');
  const expected = Buffer.from(room.controlCapabilityHash, 'hex');
  return timingSafeEqual(supplied, expected) ? room : undefined;
};
