import type { Db } from 'mongodb';
import type { DeviceLifecycleRecord } from './deviceTrust';

export class AttachmentTrustError extends Error {
  constructor() { super('Attachment authorization unavailable.'); }
}

/** A request-local continuation of a proof already verified and consumed once.
 * It cannot issue/consume proofs or grant new permissions. Each fence reads the
 * existing lifecycle authority on the primary; no positive authorization cache.
 */
export const attachmentTrustGuard = (
  database: Db, admitted: DeviceLifecycleRecord, expiresAt: number, now: () => number = Date.now,
): { assertTrusted(): Promise<void> } => {
  const expected = Object.freeze({ accountIdentityReference: admitted.accountIdentityReference,
    deviceId: admitted.deviceId, deviceIdentityReference: admitted.deviceIdentityReference,
    verificationKeyReference: admitted.verificationKeyReference, trustEpoch: admitted.trustEpoch });
  if (admitted.state !== 'active' || !Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt - now() > 30_000) throw new AttachmentTrustError();
  const records = database.collection<DeviceLifecycleRecord>('device_lifecycle');
  return { assertTrusted: async () => {
    if (expiresAt <= now()) throw new AttachmentTrustError();
    const current = await records.findOne({ accountIdentityReference: expected.accountIdentityReference, deviceId: expected.deviceId }, {
      readPreference: 'primary', maxTimeMS: 5000,
      projection: { accountIdentityReference: 1, deviceId: 1, deviceIdentityReference: 1, verificationKeyReference: 1, state: 1, trustEpoch: 1 },
    });
    if (expiresAt <= now() || !current || current.state !== 'active' ||
      current.accountIdentityReference !== expected.accountIdentityReference || current.deviceId !== expected.deviceId ||
      current.deviceIdentityReference !== expected.deviceIdentityReference ||
      current.verificationKeyReference !== expected.verificationKeyReference || current.trustEpoch !== expected.trustEpoch) throw new AttachmentTrustError();
  } };
};
