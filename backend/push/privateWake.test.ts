import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { canonicalPushEvent, PrivatePushRegistry, tokenHash, validPushEvent, verifyPushEvent, wakePayload, type PushEvent, type PushRow, type PushStore } from './privateWake';
import type { DeviceAuthorizationProof, DeviceLifecycleRecord } from '../security/deviceTrust';

const pair = generateKeyPairSync('ed25519');
const now = 1_800_000_000_000;
const device = '11111111-1111-4111-8111-111111111111';
const record: DeviceLifecycleRecord = { accountIdentityReference: 'account-fixture', deviceId: device, deviceIdentityReference: 'identity-fixture', verificationKeyReference: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'), state: 'active', trustEpoch: 1, createdAt: now, lastTrustUpdate: now };
const token = 'synthetic-registration-token-not-a-real-credential';
const event = (): PushEvent => {
  const value = { version: 1 as const, requestId: randomUUID(), accountIdentityReference: record.accountIdentityReference, deviceId: device, deviceIdentityReference: record.deviceIdentityReference, trustEpoch: 1, operation: 'register' as const, tokenHash: tokenHash(token), createdAt: now, expiresAt: now + 30_000, nonce: 'fixture-proof-nonce-123', signature: '' };
  value.signature = sign(null, Buffer.from(canonicalPushEvent(value)), pair.privateKey).toString('base64url'); return value;
};
const proof = (): DeviceAuthorizationProof => ({ version: 1, proofId: randomUUID(), accountIdentityReference: record.accountIdentityReference, deviceId: device, deviceIdentityReference: record.deviceIdentityReference, operation: 'device-control', trustEpoch: 1, nonce: 'fixture-proof-nonce-123', issuedAt: now, expiresAt: now + 30_000, signature: 'synthetic-server-proof' });
const fixture = () => {
  const rows: PushRow[] = [];
  let active: DeviceLifecycleRecord | undefined = record;
  const store: PushStore = {
    register: jest.fn(async (row) => { rows.splice(0, rows.length, row); }),
    remove: jest.fn(async () => { rows.splice(0); }),
    removeObserved: jest.fn(async (observed) => {
      const index = rows.findIndex((value) => JSON.stringify(value) === JSON.stringify(observed));
      if (index < 0) return false;
      rows.splice(index, 1); return true;
    }),
    readActive: jest.fn(async () => active), rowsForIdentity: jest.fn(async () => rows),
  };
  const authorize = jest.fn(async () => record);
  return { rows, store, authorize, deactivate: () => { active = { ...record, state: 'revoked', trustEpoch: 2 }; } };
};
describe('private Android push wake boundary', () => {
  test('disabled feature performs no authorization or token mutation', async () => {
    const f = fixture(); const registry = new PrivatePushRegistry(f.store, f.authorize, () => false, () => now);
    await expect(registry.update(event(), proof(), token)).rejects.toThrow('PUSH_DISABLED');
    expect(f.authorize).not.toHaveBeenCalled(); expect(f.store.register).not.toHaveBeenCalled();
  });
  test('signature binds token, operation, owner and epoch', async () => {
    const value = event(); expect(validPushEvent(value, now)).toBe(true); expect(verifyPushEvent(value, record)).toBe(true);
    for (const altered of [{ ...value, tokenHash: '0'.repeat(64) }, { ...value, operation: 'remove' as const }, { ...value, trustEpoch: 2 }]) expect(verifyPushEvent(altered, record)).toBe(false);
    const f = fixture(); const registry = new PrivatePushRegistry(f.store, f.authorize, () => true, () => now);
    await expect(registry.update(value, proof(), token + '-altered')).rejects.toThrow('PUSH_REJECTED'); expect(f.store.register).not.toHaveBeenCalled();
  });
  test('fresh authorized device registers and revocation at commit boundary rejects', async () => {
    const f = fixture(); const registry = new PrivatePushRegistry(f.store, f.authorize, () => true, () => now);
    await registry.update(event(), proof(), token); expect(f.rows).toHaveLength(1);
    f.deactivate(); await expect(registry.update(event(), proof(), token)).rejects.toThrow('PUSH_REJECTED');
  });
  test('ambiguous authorization fails closed', async () => {
    const f = fixture(); const registry = new PrivatePushRegistry(f.store, async () => { throw new Error('unavailable'); }, () => true, () => now);
    await expect(registry.update(event(), proof(), token)).rejects.toThrow('unavailable'); expect(f.store.register).not.toHaveBeenCalled();
  });
  test('malformed expired events, wrong scope and nonce reject', async () => {
    const f = fixture(); const registry = new PrivatePushRegistry(f.store, f.authorize, () => true, () => now);
    await expect(registry.update({ ...event(), expiresAt: now }, proof(), token)).rejects.toThrow('PUSH_REJECTED');
    await expect(registry.update(event(), { ...proof(), nonce: 'other' }, token)).rejects.toThrow('PUSH_REJECTED');
    await expect(registry.update(event(), { ...proof(), operation: 'relay:message' }, token)).rejects.toThrow('PUSH_REJECTED');
    expect(f.store.register).not.toHaveBeenCalled();
  });
  test('concurrent updates for one device are serialized and locks release after an exception', async () => {
    const f = fixture(); let running = 0; let peak = 0;
    f.store.register = jest.fn(async (row) => { running += 1; peak = Math.max(peak, running); await Promise.resolve(); f.rows.splice(0, f.rows.length, row); running -= 1; });
    const registry = new PrivatePushRegistry(f.store, f.authorize, () => true, () => now);
    await Promise.all(Array.from({ length: 8 }, () => registry.update(event(), proof(), token)));
    expect(peak).toBe(1); expect(f.rows).toHaveLength(1);
    f.store.register = jest.fn().mockRejectedValueOnce(new Error('storage')).mockResolvedValue(undefined);
    await expect(registry.update(event(), proof(), token)).rejects.toThrow('storage'); await expect(registry.update(event(), proof(), token)).resolves.toBeUndefined();
  });
  test('wake payload is strictly generic and expiring, never delivery authority', () => {
    const data = wakePayload(now); expect(Object.keys(data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
    expect(Number(data.expiresAt) - Number(data.createdAt)).toBe(60_000);
    expect(JSON.stringify(data)).not.toMatch(/token|room|sender|body|fingerprint|identity|capability|key/i);
  });
  test('post-registration epoch race cannot remove a replacement registration', async () => {
    const f = fixture();
    (f.store.readActive as jest.Mock).mockResolvedValueOnce(record).mockResolvedValue({ ...record, trustEpoch: 2 });
    f.store.register = jest.fn(async (value) => { f.rows.splice(0, f.rows.length, { ...value, trustEpoch: 2, updatedAt: new Date(value.updatedAt.getTime() + 1) }); });
    const registry = new PrivatePushRegistry(f.store, f.authorize, () => true, () => now);
    await expect(registry.update(event(), proof(), token)).rejects.toThrow('PUSH_REJECTED');
    expect(f.store.removeObserved).toHaveBeenCalledWith(expect.objectContaining({ trustEpoch: 1 }));
    expect(f.store.remove).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(1); expect(f.rows[0].trustEpoch).toBe(2);
  });
});
