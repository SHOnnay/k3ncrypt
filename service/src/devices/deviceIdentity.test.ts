import {
  assertCurrentEpoch,
  assertDeviceCanAuthorize,
  assertDeviceEntryTransition,
  assertNextEpoch,
  assertNotRollback,
  canonicalDeviceListBytes,
  canonicalDeviceListJson,
  compareEpoch,
  createDeviceEntry,
  createDeviceList,
  deviceListCommitment,
  isValidDeviceLifecycleTransition,
  verifyDeviceListCommitment,
} from './index';
import type { DeviceEntry, DeviceList } from './index';

const pending: DeviceEntry = {
  deviceId: 'device-b',
  publicIdentityReference: 'public-b',
  algorithm: 'vodozemac-v1',
  state: 'pending_enrollment',
  createdAt: 1_700_000_000_000,
};

const active: DeviceEntry = {
  deviceId: 'device-a',
  publicIdentityReference: 'public-a',
  algorithm: 'vodozemac-v1',
  state: 'active',
  createdAt: 1_700_000_000_000,
  label: 'Primary',
};

const list: DeviceList = {
  version: 1,
  identityReference: 'user-public-identity',
  epoch: 0,
  previousCommitment: null,
  devices: [pending, active],
};

describe('Phase 6B.1 device identity foundation', () => {
  it('produces deterministic canonical bytes independent of field and entry order', () => {
    const reordered: DeviceList = {
      devices: [active, pending],
      previousCommitment: null,
      epoch: 0,
      identityReference: 'user-public-identity',
      version: 1,
    };
    expect(canonicalDeviceListJson(list)).toBe('{"version":1,"identityReference":"user-public-identity","epoch":0,"previousCommitment":null,"devices":[{"deviceId":"device-a","publicIdentityReference":"public-a","algorithm":"vodozemac-v1","state":"active","createdAt":1700000000000,"label":"Primary"},{"deviceId":"device-b","publicIdentityReference":"public-b","algorithm":"vodozemac-v1","state":"pending_enrollment","createdAt":1700000000000}]}');
    expect(Array.from(canonicalDeviceListBytes(list))).toEqual(Array.from(canonicalDeviceListBytes(reordered)));
  });

  it('computes and verifies the SHA-256 commitment test vector', async () => {
    const commitment = await deviceListCommitment(list);
    expect(commitment).toBe('4e46e10ce668b30e9b5f3b08fad8551f25658d8abf235440f3fafc27f8981be0');
    expect(await verifyDeviceListCommitment(list, commitment)).toBe(true);
    expect(await verifyDeviceListCommitment({ ...list, epoch: 1 }, commitment)).toBe(false);
    expect(await verifyDeviceListCommitment({ ...list, devices: [{ ...pending, deviceId: 'device-c' }, active] }, commitment)).toBe(false);
    expect(await verifyDeviceListCommitment({ ...list, devices: [{ ...pending, state: 'revoked', revokedAt: 1_700_000_000_001 }, active] }, commitment)).toBe(false);
  });

  it('rejects malformed fields, duplicates, and revoked entries without timestamps', () => {
    expect(() => createDeviceList({ ...list, devices: [pending, pending] })).toThrow('Duplicate device identifier');
    expect(() => createDeviceEntry({ ...pending, state: 'revoked' })).toThrow('revokedAt');
    expect(() => createDeviceList({ ...list, epoch: -1 })).toThrow();
    expect(() => createDeviceList({ ...list, version: 2 as 1 })).toThrow('Unsupported');
    expect(() => createDeviceList({ ...list, devices: [{ ...pending, unexpected: true } as DeviceEntry] })).toThrow();
  });

  it('rejects invalid lifecycle transitions and revoked authorization', () => {
    expect(isValidDeviceLifecycleTransition('pending_enrollment', 'approved_pending_confirmation')).toBe(true);
    expect(isValidDeviceLifecycleTransition('approved_pending_confirmation', 'active')).toBe(true);
    expect(isValidDeviceLifecycleTransition('active', 'pending_enrollment')).toBe(false);
    expect(isValidDeviceLifecycleTransition('revoked', 'active')).toBe(false);
    expect(() => assertDeviceEntryTransition(active, { ...active, state: 'pending_enrollment' })).toThrow();
    expect(() => assertDeviceCanAuthorize({ ...active, state: 'revoked', revokedAt: 1_700_000_000_001 })).toThrow();
    expect(() => assertDeviceCanAuthorize(active)).not.toThrow();
    expect(Object.isFrozen(createDeviceEntry(active))).toBe(true);
    expect(Object.isFrozen(createDeviceList(list))).toBe(true);
  });

  it('rejects rollback and stale epochs while accepting the next epoch', () => {
    const next: DeviceList = { ...list, epoch: 1, previousCommitment: 'a'.repeat(64) };
    expect(() => assertNextEpoch(list, next)).not.toThrow();
    expect(() => assertNextEpoch(list, { ...next, epoch: 2 })).toThrow();
    expect(() => assertNotRollback(list, { ...list, epoch: 0 })).not.toThrow();
    expect(() => assertNotRollback(next, list)).toThrow('rollback');
    expect(compareEpoch(2, 2)).toBe('current');
    expect(compareEpoch(2, 1)).toBe('stale');
    expect(compareEpoch(2, 3)).toBe('future');
    expect(() => assertCurrentEpoch(next, 0)).toThrow('Stale');
    expect(() => assertCurrentEpoch(next, 1)).not.toThrow();
  });
});
