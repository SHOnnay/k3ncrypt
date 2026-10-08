import type { SecureRecordUpdate, SecureStorage } from '../core/contracts';
import {
    prepareRoomMessageVersionFloorRaise,
    readRoomMessageVersionFloor,
    roomMessageVersionFloorRecordId,
} from './roomMessageVersionFloor';

class MemorySecureStorage {
    readonly records = new Map<string, ArrayBuffer>();
    async read(type: string, id: string): Promise<ArrayBuffer | undefined> { return this.records.get(`${type}:${id}`)?.slice(0); }
    async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
        if (updates.some((item) => {
            const current = this.records.get(`${item.recordType}:${item.recordId}`);
            return current === undefined ? item.expected !== undefined : item.expected === undefined || !Buffer.from(current).equals(Buffer.from(item.expected));
        })) return false;
        for (const item of updates) this.records.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
        return true;
    }
}

const asSecureStorage = (value: MemorySecureStorage): SecureStorage => value as unknown as SecureStorage;
const commitRaise = async (storage: MemorySecureStorage, version: number): Promise<boolean> => {
    const prepared = await prepareRoomMessageVersionFloorRaise(asSecureStorage(storage), 'room-a', 'K3 identity A', version);
    return prepared.update ? storage.compareAndSwapRecords([prepared.update]) : true;
};

it('scopes the persistent floor to both room and exact remote identity', async () => {
    const storage = new MemorySecureStorage();
    await expect(commitRaise(storage, 1)).resolves.toBe(true);
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-a', 'K3 identity A')).resolves.toBe(1);
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-a', 'K3 identity B')).resolves.toBe(0);
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-b', 'K3 identity A')).resolves.toBe(0);
    expect(await roomMessageVersionFloorRecordId('room-a', 'K3 identity A')).not.toBe(await roomMessageVersionFloorRecordId('room-a', 'K3 identity B'));
});

it('treats missing state as the pre-latch legacy floor and rejects corrupted or mismatched state', async () => {
    const storage = new MemorySecureStorage();
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-a', 'K3 identity A')).resolves.toBe(0);
    const key = await roomMessageVersionFloorRecordId('room-a', 'K3 identity A');
    storage.records.set(`room-message-version-floor:${key}`, new TextEncoder().encode('{').buffer as ArrayBuffer);
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-a', 'K3 identity A')).rejects.toThrow('corrupted');
});

it('allows concurrent raises without a stale lower write replacing a higher floor', async () => {
    const storage = new MemorySecureStorage();
    const [lower, higher] = await Promise.all([
        prepareRoomMessageVersionFloorRaise(asSecureStorage(storage), 'room-a', 'K3 identity A', 1),
        prepareRoomMessageVersionFloorRaise(asSecureStorage(storage), 'room-a', 'K3 identity A', 2),
    ]);
    expect(await storage.compareAndSwapRecords([higher.update!])).toBe(true);
    expect(await storage.compareAndSwapRecords([lower.update!])).toBe(false);
    await expect(readRoomMessageVersionFloor(asSecureStorage(storage), 'room-a', 'K3 identity A')).resolves.toBe(2);
});
