import { verifyDeviceListCheckpoint } from './codec';
import type { SyncAuthorization, SyncTrustBoundary } from './contracts';

export const authorizeSync = async (authorization: SyncAuthorization, trust: SyncTrustBoundary, now = Date.now()): Promise<void> => {
    const members = authorization.activeMemberDeviceIds ?? [authorization.sourceDeviceId, authorization.targetDeviceId];
    if (authorization.version !== 1 || !authorization.scope || !authorization.sourceDeviceId || !authorization.targetDeviceId || authorization.sourceDeviceId === authorization.targetDeviceId || !Number.isSafeInteger(authorization.expiresAt) || now > authorization.expiresAt || !members.includes(authorization.sourceDeviceId) || !members.includes(authorization.targetDeviceId) || new Set(members).size !== members.length) throw new Error('Sync authorization rejected.');
    const snapshot = await trust.snapshot();
    await verifyDeviceListCheckpoint(snapshot.list, authorization.checkpoint);
    await trust.assertTrustedAt(authorization.checkpoint.epoch);
    const source = snapshot.list.devices.find((entry) => entry.deviceId === authorization.sourceDeviceId);
    const target = snapshot.list.devices.find((entry) => entry.deviceId === authorization.targetDeviceId);
    if (!source || source.state !== 'active' || source.publicIdentityReference !== authorization.sourceIdentityReference || !target || target.state !== 'active' || target.publicIdentityReference !== authorization.targetIdentityReference) throw new Error('Sync authorization rejected.');
};
