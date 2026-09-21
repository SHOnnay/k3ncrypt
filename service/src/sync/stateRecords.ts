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

export const validateSyncRecord = (record: SyncRecord, checkpoint: SyncCheckpoint): void => {
    if (record.version !== 1 || !record.scope || !id.test(record.recordId) || !['conversation', 'contact', 'device', 'settings'].includes(record.kind) || record.epoch !== checkpoint.epoch || record.commitment !== checkpoint.commitment || !hash.test(record.commitment) || record.payload === undefined) throw new Error('Sync record rejected.');
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
