/**
 * P1-2 / M3d: hard caps so anonymous callers cannot fill MongoDB Atlas Free (512 MB).
 * Sized far above a family's use; at a cap the server refuses new writes (fails closed)
 * instead of failing for everyone once the database is full.
 *  - offlineGlobal: 4,000 waiting envelopes x 32 KB max = 128 MB worst case.
 *  - offlinePerDevice: 256 waiting envelopes from one sending device, across all rooms.
 *  - rooms / devices: new room and new device records.
 */
export const STORAGE_CAPS = Object.freeze({ offlineGlobal: 4_000, offlinePerDevice: 256, rooms: 10_000, devices: 2_000 });
export type StorageCap = 'offline-global' | 'offline-device' | 'rooms' | 'devices';
export class StorageFullError extends Error {
  constructor(readonly cap: StorageCap) { super('STORAGE_FULL'); }
}
export const STORAGE_FULL_MESSAGE = 'K3NCRYPT is full right now. Try again later.';
