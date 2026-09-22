import type { DeviceList } from '../devices/deviceIdentity';
import type { SyncRecord } from './stateRecords';

export type DeviceSyncState = 'pending' | 'approved' | 'syncing' | 'suspended' | 'revoked';
export type TransferState = 'created' | 'authorized' | 'transferring' | 'verified' | 'completed' | 'failed';

export interface SyncCheckpoint { readonly epoch: number; readonly commitment: string; }
export interface SyncAuthorization {
    readonly version: 1;
    readonly authorizationId: string;
    readonly scope: string;
    readonly sourceDeviceId: string;
    readonly targetDeviceId: string;
    readonly sourceIdentityReference: string;
    readonly targetIdentityReference: string;
    readonly checkpoint: SyncCheckpoint;
    readonly transferId: string;
    readonly expiresAt: number;
    readonly activeMemberDeviceIds?: readonly string[];
    readonly freshnessRequired?: boolean;
    readonly freshnessEvidence?: readonly { readonly version: 1; readonly deviceId: string; readonly identityReference: string; readonly epoch: number; readonly commitment: string; readonly evidenceId: string }[];
}
export interface SyncPackage {
    readonly version: 1;
    readonly purpose: 'sync-manifest' | 'sync-chunk' | 'sync-delta' | 'sync-ack' | 'sync-reconcile';
    readonly scope: string;
    readonly sender: string;
    readonly senderIdentity: string;
    readonly receiver: string;
    readonly receiverIdentity: string;
    readonly checkpoint: SyncCheckpoint;
    readonly streamId: string;
    readonly sequence: number;
    readonly messageId: string;
    readonly transferId?: string;
    readonly payload: unknown;
}
export interface SyncAcknowledgement { readonly transferId: string; readonly checkpoint: SyncCheckpoint; readonly sequence: number; readonly digest: string; }
export interface FenceRecord { readonly attemptId: string; readonly scope: string; readonly checkpoint: SyncCheckpoint; readonly deviceId: string; readonly ledgerDigest: string; readonly createdAt: number; }
export interface ConflictRecord { readonly attemptId: string; readonly scope: string; readonly checkpoint: SyncCheckpoint; readonly proposals: readonly string[]; readonly reason: 'fork' | 'stale' | 'missing-member' | 'uncertain'; }

export interface SyncTrustBoundary {
    assertTrustedAt(epoch: number): Promise<void>;
    snapshot(): Promise<{ list: DeviceList; commitment: string }>;
}

export interface SyncPersistence {
    claim(scope: string, key: string): Promise<boolean>;
    read(scope: string): Promise<SyncCheckpoint | undefined>;
    write(scope: string, checkpoint: SyncCheckpoint): Promise<void>;
    readonly durable: true;
    transaction<T>(scope: string, expected: SyncCheckpoint | undefined, operation: (tx: SyncPersistenceTransaction) => Promise<T>): Promise<T>;
    readState(scope: string): Promise<SyncDurableState | undefined>;
    writeState(scope: string, state: SyncDurableState): Promise<void>;
}

export type SyncAdmissionState = 'idle' | 'prepare' | 'prepared' | 'ready' | 'transfer';

export interface SyncDurableState {
    readonly scope: string;
    readonly version: number;
    readonly checkpoint: SyncCheckpoint;
    readonly admission: SyncAdmissionState;
    readonly authorizationId?: string;
    readonly transferId?: string;
    readonly receivedSequences: readonly number[];
    readonly preparedMembers?: readonly string[];
    readonly readyMembers?: readonly string[];
    readonly terminal?: 'completed' | 'failed';
}

export interface SyncPersistenceTransaction {
    claim(scope: string, key: string): Promise<boolean>;
    write(scope: string, checkpoint: SyncCheckpoint): Promise<void>;
    writeState(scope: string, state: SyncDurableState): Promise<void>;
    /** Imports validated records in the same CAS as replay/checkpoint state. */
    importRecords?(scope: string, checkpoint: SyncCheckpoint, records: readonly SyncRecord[]): Promise<void>;
}
