export type RecoveryCeremonyState = 'idle' | 'staged' | 'replacement-pending' | 'confirmed' | 'rejected' | 'completed';

export interface RecoveryArchiveManifest {
    readonly version: 1;
    readonly archiveId: string;
    readonly sourceScope: string;
    readonly sourceEpoch: number;
    readonly sourceCommitment: string;
    readonly createdAt: number;
    readonly expiresAt?: number;
    readonly included: readonly ('contacts' | 'history' | 'preferences')[];
}

export interface RecoveryArchive {
    readonly manifest: RecoveryArchiveManifest;
    /** Opaque ciphertext. Recovery code never interprets or persists plaintext. */
    readonly ciphertext: Uint8Array;
    readonly integrity: string;
}

export interface RecoveryMaterialVerifier {
    verify(archive: RecoveryArchive, secret: Uint8Array): Promise<void>;
}

export interface RecoveryArchiveCrypto {
    seal(manifest: RecoveryArchiveManifest, plaintext: Uint8Array, secret: Uint8Array): Promise<RecoveryArchive>;
    open(archive: RecoveryArchive, secret: Uint8Array): Promise<Uint8Array>;
}

export interface RecoveryReplacementContext {
    readonly oldFingerprint: string;
    readonly newFingerprint: string;
    readonly replacementId: string;
}

export interface RecoveryPersistence {
    claim(archiveId: string): Promise<boolean>;
    stage(archive: RecoveryArchive, context: RecoveryReplacementContext): Promise<void>;
    complete(replacementId: string): Promise<void>;
    reject(replacementId: string): Promise<void>;
}

export interface RecoveryTrustReplacementBoundary {
    replaceIdentity(context: RecoveryReplacementContext, userConfirmed: true): Promise<{ readonly newScope: string; readonly invalidatedDeviceIds: readonly string[] }>;
    resetContactTrust(newScope: string): Promise<void>;
}
