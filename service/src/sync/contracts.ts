import type { DeviceList } from '../devices/deviceIdentity';

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
}
