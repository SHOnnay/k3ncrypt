import type { SecureRecordUpdate, SecureStorage } from '../core/contracts';
import { canonicalIdentityRecordId } from '../identity/machineIdentity';
import type { LocalAccountBinding } from '../identity/accountBinding';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { createDeviceList } from '../devices/deviceList';
import { deviceListCommitment } from '../devices/canonicalEncoding';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import type { LifecycleStateSnapshot } from '../devices/lifecycle';
import type { AuthenticatedRecoveryAuthority } from './runtime';
import { RecoveryRuntime } from './runtime';
import type { RecoveryArchive, RecoveryPersistence, RecoveryReplacementContext, RecoveryTrustReplacementBoundary } from './contracts';

interface DurableRecoveryState {
    readonly version: 1;
    readonly claims: readonly string[];
    readonly pending?: { readonly archiveId: string; readonly integrity: string; readonly context: RecoveryReplacementContext };
    readonly completed: readonly string[];
}
interface PreparedReplacement {
    readonly context: RecoveryReplacementContext;
    readonly newScope: string;
    readonly newDeviceId: string;
    readonly invalidatedDeviceIds: readonly string[];
    readonly bindingRaw: ArrayBuffer;
    readonly oldState: LifecycleStateSnapshot;
    trustReset: boolean;
}
const encode = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const parse = <T>(bytes: ArrayBuffer): T => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
const initial = (): DurableRecoveryState => ({ version: 1, claims: [], completed: [] });

/** Production recovery composition. Mutations are prepared in memory and become visible only in the final vault CAS. */
export class SecureStorageRecoveryAdapter implements RecoveryPersistence, RecoveryTrustReplacementBoundary, AuthenticatedRecoveryAuthority {
    private prepared?: PreparedReplacement;
    public constructor(private readonly storage: SecureStorage) {
        if (!storage.compareAndSwapRecords) throw new Error('Atomic recovery persistence unavailable.');
    }
    public async authorize(archive: RecoveryArchive, replacement: RecoveryReplacementContext): Promise<void> {
        const binding = await this.binding();
        const lifecycle = await new SecureStorageDeviceLifecyclePersistence(this.storage).read(binding.userScope);
        if (!lifecycle || archive.manifest.sourceScope !== binding.userScope || archive.manifest.sourceEpoch !== lifecycle.list.epoch ||
            archive.manifest.sourceCommitment !== lifecycle.commitment || replacement.oldFingerprint !== binding.identityReference ||
            replacement.oldFingerprint === replacement.newFingerprint) throw new Error('Recovery authority rejected.');
    }
    public async claim(archiveId: string): Promise<boolean> {
        const { raw, state } = await this.load();
        if (state.claims.includes(archiveId)) return false;
        return this.commit(raw, { ...state, claims: [...state.claims, archiveId] });
    }
    public async release(archiveId: string): Promise<void> {
        const { raw, state } = await this.load();
        if (state.pending?.archiveId === archiveId) return;
        await this.commit(raw, { ...state, claims: state.claims.filter((entry) => entry !== archiveId) });
    }
    public async stage(): Promise<void> { throw new Error('Verified atomic recovery staging is required.'); }
    public async stageVerified(archive: RecoveryArchive, context: RecoveryReplacementContext): Promise<boolean> {
        const { raw, state } = await this.load();
        if (state.claims.includes(archive.manifest.archiveId) || state.pending) return false;
        return this.commit(raw, { ...state, claims: [...state.claims, archive.manifest.archiveId], pending: { archiveId: archive.manifest.archiveId, integrity: archive.integrity, context: { ...context } } });
    }
    public async readPending(): Promise<RecoveryReplacementContext | undefined> { return (await this.load()).state.pending?.context; }
    public async reject(replacementId: string): Promise<void> {
        const { raw, state } = await this.load();
        if (state.pending?.context.replacementId !== replacementId) throw new Error('Recovery rejection unavailable.');
        await this.commit(raw, { ...state, pending: undefined });
        this.prepared = undefined;
    }
    public async replaceIdentity(context: RecoveryReplacementContext, userConfirmed: true): Promise<{ newScope: string; invalidatedDeviceIds: readonly string[] }> {
        if (!userConfirmed) throw new Error('Identity replacement rejected.');
        const pending = await this.readPending();
        const bindingRaw = await this.storage.read('device-account-binding', 'local');
        if (!pending || JSON.stringify(pending) !== JSON.stringify(context) || !bindingRaw) throw new Error('Identity replacement rejected.');
        const binding = parse<LocalAccountBinding>(bindingRaw);
        const oldState = await new SecureStorageDeviceLifecyclePersistence(this.storage).read(binding.userScope);
        if (!oldState || binding.identityReference !== context.oldFingerprint) throw new Error('Identity replacement rejected.');
        const invalidatedDeviceIds = oldState.list.devices.filter((entry) => entry.state !== 'revoked').map((entry) => entry.deviceId);
        if (invalidatedDeviceIds.length === 0) throw new Error('Identity replacement rejected.');
        const newScope = `recovery-${context.replacementId}`;
        const newDeviceId = `device-${(await canonicalIdentityRecordId(context.newFingerprint)).slice(9)}`;
        this.prepared = { context: { ...context }, newScope, newDeviceId, invalidatedDeviceIds, bindingRaw, oldState, trustReset: false };
        return { newScope, invalidatedDeviceIds };
    }
    public async resetContactTrust(newScope: string): Promise<void> {
        if (!this.prepared || this.prepared.newScope !== newScope) throw new Error('Contact trust reset rejected.');
        this.prepared.trustReset = true;
    }
    public async complete(replacementId: string): Promise<void> {
        const prepared = this.prepared;
        const loaded = await this.load();
        if (!prepared || !prepared.trustReset || prepared.context.replacementId !== replacementId || loaded.state.pending?.context.replacementId !== replacementId) throw new Error('Recovery completion unavailable.');
        const now = Date.now();
        const revokedDevices = prepared.oldState.list.devices.map((entry) => entry.state === 'revoked' ? entry : createDeviceEntry({ ...entry, state: 'revoked', revokedAt: now }));
        const revokedList = createDeviceList({ version: 1, identityReference: prepared.oldState.list.identityReference, epoch: prepared.oldState.list.epoch + 1, previousCommitment: prepared.oldState.commitment, devices: revokedDevices });
        const revokedCommitment = await deviceListCommitment(revokedList);
        const newList = createDeviceList({ version: 1, identityReference: prepared.newScope, epoch: 0, previousCommitment: null, devices: [createDeviceEntry({ deviceId: prepared.newDeviceId, publicIdentityReference: prepared.context.newFingerprint, algorithm: 'Olm-Curve25519+Ed25519', state: 'active', createdAt: now })] });
        const newCommitment = await deviceListCommitment(newList);
        const oldId = await canonicalIdentityRecordId(prepared.oldState.list.identityReference);
        const newId = await canonicalIdentityRecordId(prepared.newScope);
        const oldLifecycleRaw = await this.storage.read('device-lifecycle', oldId);
        const oldHighwaterRaw = await this.storage.read('device-lifecycle-highwater', oldId);
        const resetRaw = await this.storage.read('contact-trust-reset', 'local');
        const updates: SecureRecordUpdate[] = [
            { recordType: 'recovery-runtime', recordId: 'local', expected: loaded.raw, next: encode({ ...loaded.state, pending: undefined, completed: [...loaded.state.completed, replacementId] }) },
            { recordType: 'device-account-binding', recordId: 'local', expected: prepared.bindingRaw, next: encode({ version: 1, userScope: prepared.newScope, deviceId: prepared.newDeviceId, identityReference: prepared.context.newFingerprint }) },
            { recordType: 'device-lifecycle', recordId: oldId, expected: oldLifecycleRaw, next: encode({ version: 2, state: { list: revokedList, commitment: revokedCommitment }, authorizations: [], highestEpoch: revokedList.epoch, commitmentHistory: [{ epoch: revokedList.epoch, commitment: revokedCommitment }] }) },
            { recordType: 'device-lifecycle-highwater', recordId: oldId, expected: oldHighwaterRaw, next: encode({ version: 1, highestEpoch: revokedList.epoch, commitment: revokedCommitment }) },
            { recordType: 'device-lifecycle', recordId: newId, expected: await this.storage.read('device-lifecycle', newId), next: encode({ version: 2, state: { list: newList, commitment: newCommitment }, authorizations: [], highestEpoch: 0, commitmentHistory: [{ epoch: 0, commitment: newCommitment }] }) },
            { recordType: 'device-lifecycle-highwater', recordId: newId, expected: await this.storage.read('device-lifecycle-highwater', newId), next: encode({ version: 1, highestEpoch: 0, commitment: newCommitment }) },
            { recordType: 'contact-trust-reset', recordId: 'local', expected: resetRaw, next: encode({ version: 1, scope: prepared.newScope, resetAt: now }) },
        ];
        if (!await this.storage.compareAndSwapRecords!(updates)) throw new Error('Recovery transaction conflict.');
        this.prepared = undefined;
    }
    private async binding(): Promise<LocalAccountBinding> {
        const raw = await this.storage.read('device-account-binding', 'local');
        if (!raw) throw new Error('Recovery authority rejected.');
        return parse<LocalAccountBinding>(raw);
    }
    private async load(): Promise<{ raw?: ArrayBuffer; state: DurableRecoveryState }> {
        const raw = await this.storage.read('recovery-runtime', 'local');
        const state = raw ? parse<DurableRecoveryState>(raw) : initial();
        if (state.version !== 1 || !Array.isArray(state.claims) || !Array.isArray(state.completed)) throw new Error('Recovery persistence corrupted.');
        return { raw, state };
    }
    private async commit(expected: ArrayBuffer | undefined, state: DurableRecoveryState): Promise<boolean> {
        return this.storage.compareAndSwapRecords!([{ recordType: 'recovery-runtime', recordId: 'local', expected, next: encode(state) }]);
    }
}

export const createProductionRecoveryRuntime = (storage: SecureStorage): RecoveryRuntime => {
    const adapter = new SecureStorageRecoveryAdapter(storage);
    return new RecoveryRuntime(adapter, adapter, adapter);
};
