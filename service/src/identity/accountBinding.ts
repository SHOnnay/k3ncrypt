import type { SecureStorage } from '../core/contracts';
import type { LifecycleStateSnapshot } from '../devices/lifecycle';
import { canonicalIdentityRecordId } from './machineIdentity';

export interface LocalAccountBinding {
    readonly version: 1;
    readonly userScope: string;
    readonly deviceId: string;
    readonly identityReference: string;
}

/** Local account namespace, independent from conversation routing and device public keys. */
export const loadAccountBinding = async (storage: SecureStorage, identityReference: string, legacy?: LifecycleStateSnapshot): Promise<LocalAccountBinding> => {
    const read = async (): Promise<LocalAccountBinding | undefined> => {
        const bytes = await storage.read('device-account-binding', 'local');
        if (!bytes) return undefined;
        const value: LocalAccountBinding = JSON.parse(new TextDecoder().decode(bytes));
        if (value.version !== 1 || value.identityReference !== identityReference || !value.userScope || !value.deviceId) throw new Error('Account identity binding rejected.');
        return Object.freeze(value);
    };
    const existing = await read();
    if (existing) return existing;
    if (!storage.compareAndSwapRecords) throw new Error('Atomic account binding storage unavailable.');
    const priorDevice = legacy?.list.devices.filter((entry) => entry.publicIdentityReference === identityReference);
    if (legacy && priorDevice?.length !== 1) throw new Error('Legacy device binding requires review.');
    // Preserve existing commitment chains; never recreate a revoked entry during migration.
    const binding: LocalAccountBinding = {
        version: 1, userScope: legacy?.list.identityReference ?? `account-${crypto.randomUUID()}`,
        deviceId: priorDevice?.[0]?.deviceId ?? `device-${await canonicalIdentityRecordId(identityReference)}`,
        identityReference,
    };
    const stored = await storage.compareAndSwapRecords([{ recordType: 'device-account-binding', recordId: 'local', expected: undefined, next: new TextEncoder().encode(JSON.stringify(binding)).buffer as ArrayBuffer }]);
    if (!stored) { const winner = await read(); if (!winner) throw new Error('Account binding unavailable.'); return winner; }
    return Object.freeze(binding);
};
