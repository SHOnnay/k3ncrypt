import type { Db } from 'mongodb';
import type { DeviceLifecycleRecord } from './deviceTrust';
import { attachmentTrustGuard } from './attachmentTrust';
const record: DeviceLifecycleRecord = { accountIdentityReference: 'disposable-account', deviceId: 'disposable-device', deviceIdentityReference: 'disposable-identity', verificationKeyReference: 'disposable-control-key', state: 'active', trustEpoch: 3, createdAt: 1, lastTrustUpdate: 1 };
const fixture = () => {
  const findOne = jest.fn().mockResolvedValue({ ...record });
  const database = { collection: jest.fn().mockReturnValue({ findOne }) } as unknown as Db;
  let now = 10;
  return { findOne, database, guard: attachmentTrustGuard(database, record, 100, () => now), time: (n: number) => { now = n; } };
};
test('each continuation reads the primary with a bounded deadline; proof is not consumed again or cached', async () => {
  const f = fixture(); await f.guard.assertTrusted(); await f.guard.assertTrusted();
  expect(f.findOne).toHaveBeenCalledTimes(2);
  expect(f.findOne).toHaveBeenCalledWith({ accountIdentityReference: record.accountIdentityReference, deviceId: record.deviceId }, expect.objectContaining({ readPreference: 'primary', maxTimeMS: 5000 }));
});
test.each([null, { ...record, state: 'revoked' }, { ...record, state: 'pending' }, { ...record, trustEpoch: 4 }, { ...record, deviceIdentityReference: 'replacement' }, { ...record, verificationKeyReference: 'replacement' }, { ...record, accountIdentityReference: 'foreign' }, { ...record, deviceId: 'foreign' }])('rejects missing or changed authority state %#', async current => {
  const f = fixture(); f.findOne.mockResolvedValue(current); await expect(f.guard.assertTrusted()).rejects.toThrow('authorization');
});
test('expiry is checked before and after asynchronous trust lookup', async () => {
  const f = fixture(); f.time(100); await expect(f.guard.assertTrusted()).rejects.toThrow('authorization'); expect(f.findOne).not.toHaveBeenCalled();
  const g = fixture(); g.findOne.mockImplementation(async () => { g.time(100); return record; }); await expect(g.guard.assertTrusted()).rejects.toThrow('authorization');
});
test('read outage fails closed without retrying or trusting admission', async () => {
  const f = fixture(); f.findOne.mockRejectedValue(new Error('synthetic database unavailable')); await expect(f.guard.assertTrusted()).rejects.toThrow(); expect(f.findOne).toHaveBeenCalledTimes(1);
});
test('admission identity/epoch snapshot cannot be mutated into a replacement authorization', async () => {
  const admitted = { ...record }; const f = fixture(); const guard = attachmentTrustGuard(f.database, admitted, 100, () => 10);
  admitted.trustEpoch = 4; f.findOne.mockResolvedValue({ ...record, trustEpoch: 4 }); await expect(guard.assertTrusted()).rejects.toThrow('authorization');
});
