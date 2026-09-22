import type { DeviceEntry, DeviceList } from './deviceIdentity';
import { COMMITMENT_PATTERN } from './deviceIdentity';
import { createDeviceList } from './deviceList';

const textEncoder = new TextEncoder();

const canonicalEntry = (entry: DeviceEntry): string => {
    const value: Record<string, unknown> = {
        deviceId: entry.deviceId,
        publicIdentityReference: entry.publicIdentityReference,
        algorithm: entry.algorithm,
        state: entry.state,
        createdAt: entry.createdAt,
    };
    if (entry.revokedAt !== undefined) value.revokedAt = entry.revokedAt;
    if (entry.label !== undefined) value.label = entry.label;
    return JSON.stringify(value);
};

/** Canonical UTF-8 bytes for a validated, public-only device list. */
export const canonicalDeviceListJson = (input: DeviceList): string => {
    const list = createDeviceList(input);
    const devices = [...list.devices].sort((left, right) => left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0);
    const value: Record<string, unknown> = {
        version: 1,
        identityReference: list.identityReference,
        epoch: list.epoch,
        previousCommitment: list.previousCommitment,
        devices: devices.map((entry) => JSON.parse(canonicalEntry(entry))),
    };
    return JSON.stringify(value);
};

export const canonicalDeviceListBytes = (input: DeviceList): Uint8Array => textEncoder.encode(canonicalDeviceListJson(input));

const toHex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const bufferSource = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

/** SHA-256(canonical device-list object bytes), represented as lowercase hex. */
export const deviceListCommitment = async (input: DeviceList): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new Error('Device-list commitment is unavailable.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bufferSource(canonicalDeviceListBytes(input)));
    return toHex(new Uint8Array(digest));
};

export const verifyDeviceListCommitment = async (input: DeviceList, expected: string): Promise<boolean> => {
    if (!COMMITMENT_PATTERN.test(expected)) return false;
    return (await deviceListCommitment(input)) === expected;
};
