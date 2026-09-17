import { randomBytes } from 'crypto';

import db from '../db';
import { LINK_COLLECTION } from '../db/const';
import {
  authorizeRoomControl,
  hashControlCapability,
  isValidControlCapability,
  isValidControlCapabilityHash,
  isValidRoomId,
} from './controlCapability';

const capability = randomBytes(32).toString('base64url');
const roomId = 'f64a75a8-cc64-4fa9-89a4-e944ee5f0c64';

describe('room control capabilities', () => {
  beforeAll(async () => {
    await db.insertInDb({
      hash: roomId,
      expired: false,
      deleted: false,
      controlCapabilityHash: hashControlCapability(capability),
    }, LINK_COLLECTION);
  });

  it('accepts only exact 256-bit base64url capabilities and SHA-256 verifiers', () => {
    expect(isValidControlCapability(capability)).toBe(true);
    expect(isValidControlCapability(`${capability}a`)).toBe(false);
    expect(isValidControlCapability('not-a-capability')).toBe(false);
    expect(isValidControlCapabilityHash(hashControlCapability(capability))).toBe(true);
    expect(isValidControlCapabilityHash('0'.repeat(63))).toBe(false);
  });

  it('strictly validates room identifiers', () => {
    expect(isValidRoomId(roomId)).toBe(true);
    expect(isValidRoomId('../room')).toBe(false);
    expect(isValidRoomId('f64a75a8cc644fa989a4e944ee5f0c64')).toBe(false);
  });

  it('authorizes the matching capability and fails closed for a wrong value', async () => {
    await expect(authorizeRoomControl(roomId, capability)).resolves.toMatchObject({ hash: roomId });
    await expect(authorizeRoomControl(roomId, randomBytes(32).toString('base64url'))).resolves.toBeUndefined();
  });
});
