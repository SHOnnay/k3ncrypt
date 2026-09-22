import type { SyncCheckpoint } from './contracts';

export type SyncRecordKind = 'conversation' | 'contact' | 'device' | 'settings';
export interface SyncRecord {
    readonly version: 1;
    readonly scope: string;
    readonly recordId: string;
    readonly kind: SyncRecordKind;
    readonly epoch: number;
    readonly commitment: string;
    readonly payload: unknown;
}

export interface SyncRecordStore {
    importAtomically(scope: string, checkpoint: SyncCheckpoint, records: readonly SyncRecord[]): Promise<void>;
    exportSelected(scope: string, checkpoint: SyncCheckpoint, kinds: readonly SyncRecordKind[]): Promise<readonly SyncRecord[]>;
}

export interface SyncEventDelivery {
    publish(scope: string, frame: ArrayBuffer, recipientDeviceId: string): Promise<void>;
    subscribe(scope: string, handler: (frame: ArrayBuffer, senderDeviceId: string) => Promise<void>): () => void;
}

export interface SyncRetryPolicy {
    retry(scope: string, operationId: string, operation: () => Promise<void>): Promise<void>;
}

const id = /^[A-Za-z0-9_-]{16,128}$/;
const hash = /^[0-9a-f]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const requiredString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

const validatePayload = (kind: SyncRecordKind, payload: unknown, scope: string): void => {
    if (!object(payload)) throw new Error('Sync record rejected.');
    if ('owner' in payload && payload.owner !== scope) throw new Error('Sync record owner rejected.');
    if (kind === 'conversation' && (!requiredString(payload.contact) || !requiredString(payload.fingerprint) || !['modern', 'legacy'].includes(String(payload.protocol)) || typeof payload.label !== 'string')) throw new Error('Sync record rejected.');
    if (kind === 'contact' && (!requiredString(payload.contact) || !requiredString(payload.fingerprint) || !['unconfirmed', 'changed'].includes(String(payload.status)))) throw new Error('Sync record rejected.');
    if (kind === 'device' && (!requiredString(payload.deviceId) || !requiredString(payload.identityReference) || !['pending', 'active', 'revoked'].includes(String(payload.state)))) throw new Error('Sync record rejected.');
    if (kind === 'settings' && (!['paper-ink', 'slate-dusk'].includes(String(payload.theme)))) throw new Error('Sync record rejected.');
};

export const validateSyncRecord = (record: SyncRecord, checkpoint: SyncCheckpoint): void => {
    if (record.version !== 1 || !record.scope || !id.test(record.recordId) || !['conversation', 'contact', 'device', 'settings'].includes(record.kind) || record.epoch !== checkpoint.epoch || record.commitment !== checkpoint.commitment || !hash.test(record.commitment)) throw new Error('Sync record rejected.');
    validatePayload(record.kind, record.payload, record.scope);
};

export const validateSyncRecords = (scope: string, checkpoint: SyncCheckpoint, records: readonly SyncRecord[]): void => {
    if (!scope || records.length === 0) throw new Error('Sync records rejected.');
    const seen = new Set<string>();
    for (const record of records) {
        if (record.scope !== scope || seen.has(record.recordId)) throw new Error('Sync record rejected.');
        seen.add(record.recordId);
        validateSyncRecord(record, checkpoint);
    }
};
