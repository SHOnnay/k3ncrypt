import type { SecureStorage } from '../core/contracts';
import type { LifecycleStateSnapshot } from '../devices/lifecycle';

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
        deviceId: priorDevice?.[0]?.deviceId ?? crypto.randomUUID(),
        identityReference,
    };
    const stored = await storage.compareAndSwapRecords([{ recordType: 'device-account-binding', recordId: 'local', expected: undefined, next: new TextEncoder().encode(JSON.stringify(binding)).buffer as ArrayBuffer }]);
    if (!stored) { const winner = await read(); if (!winner) throw new Error('Account binding unavailable.'); return winner; }
    return Object.freeze(binding);
};

/**
 * Installs membership for a newly approved device. The caller must already
 * have completed the target-side lifecycle ceremony; this helper only binds
 * the local public identity to the existing account namespace and never copies
 * key material.
 */
export const adoptApprovedAccountBinding = async (storage: SecureStorage, identityReference: string, userScope: string, deviceId: string): Promise<LocalAccountBinding> => {
    if (!identityReference || !userScope || !deviceId) throw new Error('Account membership is unavailable.');
    if (!storage.compareAndSwapRecords) throw new Error('Atomic account binding storage unavailable.');
    const value: LocalAccountBinding = { version: 1, userScope, deviceId, identityReference };
    const next = new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
    const existing = await storage.read('device-account-binding', 'local');
    if (!existing) {
        if (await storage.compareAndSwapRecords([{ recordType: 'device-account-binding', recordId: 'local', expected: undefined, next }])) return Object.freeze(value);
        throw new Error('Account membership conflict.');
    }
    const winner = JSON.parse(new TextDecoder().decode(existing)) as LocalAccountBinding;
    if (winner.version !== 1 || winner.identityReference !== identityReference) throw new Error('Account membership conflict.');
    if (winner.userScope === userScope && winner.deviceId === deviceId) return Object.freeze(winner);
    // A target device creates an isolated bootstrap account before pairing. It
    // may replace that binding exactly once, while retaining its independent
    // cryptographic identity and the approved target device identifier.
    if (!winner.userScope.startsWith('account-') || !/^[0-9a-f-]{36}$/i.test(winner.deviceId) ||
        !await storage.compareAndSwapRecords([{ recordType: 'device-account-binding', recordId: 'local', expected: existing, next }])) {
        throw new Error('Account membership conflict.');
    }
    return Object.freeze(value);
};
