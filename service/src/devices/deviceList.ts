import type { DeviceEntry, DeviceList } from './deviceIdentity';
import { createDeviceEntry, isCommitment } from './deviceIdentity';

const fail = (message = 'Invalid device list.'): never => { throw new Error(message); };

const freezeList = (list: DeviceList): DeviceList => Object.freeze({ ...list, devices: Object.freeze([...list.devices]) });

/** Validates a device list and returns an immutable historical snapshot. */
export const createDeviceList = (input: DeviceList): DeviceList => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
    const value = input as unknown as Record<string, unknown>;
    const allowed = ['devices', 'epoch', 'identityReference', 'previousCommitment', 'version'];
    if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
    if (value.version !== 1) fail('Unsupported device-list version.');
    if (typeof value.identityReference !== 'string' || value.identityReference.length === 0 || value.identityReference.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(value.identityReference) || value.identityReference.normalize('NFC') !== value.identityReference) fail();
    if (!Number.isSafeInteger(value.epoch) || (value.epoch as number) < 0) fail();
    if (value.previousCommitment !== null && !isCommitment(value.previousCommitment)) fail();
    if (!Array.isArray(value.devices)) fail();
    const devices = (value.devices as unknown[]).map((entry) => createDeviceEntry(entry as DeviceEntry));
    const ids = new Set<string>();
    const identities = new Set<string>();
    for (const entry of devices) {
        if (ids.has(entry.deviceId)) fail('Duplicate device identifier.');
        ids.add(entry.deviceId);
        if (identities.has(entry.publicIdentityReference)) fail('Duplicate device public identity.');
        identities.add(entry.publicIdentityReference);
    }
    return freezeList({
        version: 1,
        identityReference: value.identityReference as string,
        epoch: value.epoch as number,
        previousCommitment: value.previousCommitment as string | null,
        devices,
    });
};

export const deviceEntryById = (list: DeviceList, deviceId: string): DeviceEntry | undefined =>
    list.devices.find((entry) => entry.deviceId === deviceId);
