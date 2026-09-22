import type { DeviceLifecycleAdapter, LocalEncryptionAdapter, PermissionAdapter, PlatformName, PlatformSecurityBoundary, PlatformSecureStorageProvider, SecureStorageAdapter } from './contracts';
import { IsolatedSecureStore } from './secureStore';

const profileFor = (platform: PlatformName) => ({ platform, keyIsolationRequired: true as const, encryptedAppPrivateStateRequired: true as const, backupExclusionRequired: true as const, secureDeletionBoundaryRequired: true as const });

/**
 * Native OS adapters remain the only place allowed to unwrap platform keys.
 * The application receives an encrypted-record port, never a keystore key.
 */
export class NativeSecureStorageBoundary {
    public constructor(private readonly provider: PlatformSecureStorageProvider, private readonly platform: PlatformName, private readonly encryption: LocalEncryptionAdapter) {}
    public async open(namespace: string): Promise<IsolatedSecureStore> {
        const adapter = await this.provider.open(profileFor(this.platform));
        if (!adapter || adapter.platform !== this.platform) throw new Error('Native secure storage profile rejected.');
        return new IsolatedSecureStore(namespace, adapter, this.encryption);
    }
}

export const createPlatformSecurityBoundary = async (input: { platform: PlatformName; provider: PlatformSecureStorageProvider; encryption: LocalEncryptionAdapter; permissions: PermissionAdapter; lifecycle: DeviceLifecycleAdapter; namespace: string }): Promise<PlatformSecurityBoundary & { readonly secureStore: IsolatedSecureStore }> => {
    const native = new NativeSecureStorageBoundary(input.provider, input.platform, input.encryption);
    const secureStore = await native.open(input.namespace);
    return Object.freeze({ storage: Object.freeze({ platform: input.platform, read: (key: string) => secureStore.read(key), write: async (key: string, value: Uint8Array) => secureStore.write(key, value), delete: (key: string) => secureStore.delete(key), lock: async () => input.provider.open(profileFor(input.platform)).then((adapter: SecureStorageAdapter) => adapter.lock()) }), permissions: input.permissions, encryption: input.encryption, lifecycle: input.lifecycle, secureStore });
};
