export type PlatformName = 'android' | 'ios' | 'windows' | 'macos' | 'linux';
export type PermissionName = 'microphone' | 'camera' | 'files';

export interface SecureStorageAdapter {
    readonly platform: PlatformName;
    read(key: string): Promise<Uint8Array | undefined>;
    write(key: string, value: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
    lock(): Promise<void>;
}

export interface PermissionAdapter { request(permission: PermissionName): Promise<boolean>; release(permission: PermissionName): Promise<void>; }
export interface LocalEncryptionAdapter { encrypt(plaintext: Uint8Array): Promise<Uint8Array>; decrypt(ciphertext: Uint8Array): Promise<Uint8Array>; }
export interface DeviceLifecycleAdapter { onSuspend(handler: () => Promise<void>): () => void; onResume(handler: () => Promise<void>): () => void; }

export interface PlatformSecurityBoundary {
    readonly storage: SecureStorageAdapter;
    readonly permissions: PermissionAdapter;
    readonly encryption: LocalEncryptionAdapter;
    readonly lifecycle: DeviceLifecycleAdapter;
}
