import type { SecureRecordUpdate, SecureStorage } from '../core/contracts';
import { toBase64Url } from './base64url';

export const ROOM_MESSAGE_VERSION_FLOOR_RECORD = 'room-message-version-floor';
export interface RoomMessageVersionFloor {
    version: 1;
    roomId: string;
    remoteIdentityReference: string;
    minimumWrapperVersion: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The local storage address binds both the room and exact pinned remote identity. */
export const roomMessageVersionFloorRecordId = async (roomId: string, remoteIdentityReference: string): Promise<string> => {
    if (!roomId || !remoteIdentityReference) throw new Error('Room message security identity is unavailable.');
    const material = encoder.encode(`K3NCRYPT/ROOM-MESSAGE-FLOOR/v1\0${roomId}\0${remoteIdentityReference}`);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', material));
    return `rmvf:${toBase64Url(digest)}`;
};

export const parseRoomMessageVersionFloor = (
    bytes: ArrayBuffer | undefined,
    expected: { roomId: string; remoteIdentityReference: string },
): RoomMessageVersionFloor | undefined => {
    if (bytes === undefined) return undefined;
    let value: unknown;
    try { value = JSON.parse(decoder.decode(bytes)); }
    catch { throw new Error('Persisted room message security state is corrupted.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persisted room message security state is invalid.');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join('\0') !== ['minimumWrapperVersion', 'remoteIdentityReference', 'roomId', 'version'].sort().join('\0') ||
        item.version !== 1 || item.roomId !== expected.roomId || item.remoteIdentityReference !== expected.remoteIdentityReference ||
        !Number.isSafeInteger(item.minimumWrapperVersion) || Number(item.minimumWrapperVersion) < 0 || Number(item.minimumWrapperVersion) > 255) {
        throw new Error('Persisted room message security state is invalid.');
    }
    return {
        version: 1,
        roomId: item.roomId as string,
        remoteIdentityReference: item.remoteIdentityReference as string,
        minimumWrapperVersion: item.minimumWrapperVersion as number,
    };
};

export const encodeRoomMessageVersionFloor = (value: RoomMessageVersionFloor): ArrayBuffer => {
    const bytes = encoder.encode(JSON.stringify(value));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * Prepare an optimistic, monotonic update for a caller-owned acceptance CAS.
 * Concurrent updates conflict instead of allowing a stale value to overwrite a
 * higher floor; the enclosing receive transaction remains unaccepted on conflict.
 */
export const prepareRoomMessageVersionFloorRaise = async (
    storage: SecureStorage,
    roomId: string,
    remoteIdentityReference: string,
    authenticatedVersion: number,
): Promise<{ floor: number; update?: SecureRecordUpdate }> => {
    if (!Number.isSafeInteger(authenticatedVersion) || authenticatedVersion < 1 || authenticatedVersion > 255) {
        throw new Error('Authenticated room message version is invalid.');
    }
    const recordId = await roomMessageVersionFloorRecordId(roomId, remoteIdentityReference);
    const expected = await storage.read(ROOM_MESSAGE_VERSION_FLOOR_RECORD, recordId);
    const current = parseRoomMessageVersionFloor(expected, { roomId, remoteIdentityReference });
    const floor = Math.max(current?.minimumWrapperVersion ?? 0, authenticatedVersion);
    if (current && floor === current.minimumWrapperVersion) return { floor, update: { recordType: ROOM_MESSAGE_VERSION_FLOOR_RECORD, recordId, expected, next: expected!.slice(0) } };
    const next: RoomMessageVersionFloor = { version: 1, roomId, remoteIdentityReference, minimumWrapperVersion: floor };
    return { floor, update: { recordType: ROOM_MESSAGE_VERSION_FLOOR_RECORD, recordId, expected, next: encodeRoomMessageVersionFloor(next) } };
};

/** Prepare a CAS guard for a legacy send/receive decision without raising the floor. */
export const prepareRoomMessageVersionFloorGuard = async (
    storage: SecureStorage,
    roomId: string,
    remoteIdentityReference: string,
): Promise<{ floor: number; update: SecureRecordUpdate }> => {
    const recordId = await roomMessageVersionFloorRecordId(roomId, remoteIdentityReference);
    const expected = await storage.read(ROOM_MESSAGE_VERSION_FLOOR_RECORD, recordId);
    const current = parseRoomMessageVersionFloor(expected, { roomId, remoteIdentityReference });
    const floor = current?.minimumWrapperVersion ?? 0;
    const next = current ?? { version: 1 as const, roomId, remoteIdentityReference, minimumWrapperVersion: 0 };
    return {
        floor,
        update: {
            recordType: ROOM_MESSAGE_VERSION_FLOOR_RECORD,
            recordId,
            expected,
            next: expected?.slice(0) ?? encodeRoomMessageVersionFloor(next),
        },
    };
};

export const readRoomMessageVersionFloor = async (
    storage: SecureStorage,
    roomId: string,
    remoteIdentityReference: string,
): Promise<number> => {
    const recordId = await roomMessageVersionFloorRecordId(roomId, remoteIdentityReference);
    const parsed = parseRoomMessageVersionFloor(await storage.read(ROOM_MESSAGE_VERSION_FLOOR_RECORD, recordId), { roomId, remoteIdentityReference });
    return parsed?.minimumWrapperVersion ?? 0;
};
