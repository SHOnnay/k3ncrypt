import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { deviceListCommitment } from './canonicalEncoding';
import { createDeviceList } from './deviceList';
import type { DeviceList } from './deviceIdentity';
import { verifyAuthorizationDigest, type AuthorizationRecord, type DeviceAuthorization, type DeviceLifecyclePersistence, type LifecycleStateSnapshot } from './lifecycle';
import { AsyncMutex } from '../utils/asyncMutex';
import { canonicalIdentityRecordId } from '../identity/machineIdentity';

const RECORD_TYPE = 'device-lifecycle';
const HIGHWATER_RECORD_TYPE = 'device-lifecycle-highwater';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONTROL_PREFIX = 'k3ncrypt-device-control-v1:';

export type DeviceControlMessage = {
    readonly type: 'enrollment-request' | 'enrollment-approval' | 'enrollment-confirmation' | 'enrollment-rejection' | 'revocation' | 'trust-state' | 'trust-state-request' | 'trust-state-snapshot';
    readonly payload: unknown;
};

const bytes = (value: unknown): ArrayBuffer => encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer;
export const decodeDeviceControl = (value: ArrayBuffer): DeviceControlMessage | undefined => {
    if (value.byteLength > 65536) throw new Error('Invalid device control message.');
    const text = decoder.decode(value);
    if (!text.startsWith(CONTROL_PREFIX)) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(text.slice(CONTROL_PREFIX.length)); } catch { throw new Error('Invalid device control message.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid device control message.');
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['type', 'payload'].includes(key)) || !['enrollment-request', 'enrollment-approval', 'enrollment-confirmation', 'enrollment-rejection', 'revocation', 'trust-state', 'trust-state-request', 'trust-state-snapshot'].includes(record.type as string) || !('payload' in record)) throw new Error('Invalid device control message.');
    return { type: record.type as DeviceControlMessage['type'], payload: record.payload };
};

interface LifecycleRecord {
    readonly version: 2;
    readonly state: LifecycleStateSnapshot;
    readonly authorizations: AuthorizationRecord[];
    readonly highestEpoch: number;
    readonly commitmentHistory: readonly { epoch: number; commitment: string }[];
}
interface LifecycleHighwater { readonly version: 1; readonly highestEpoch: number; readonly commitment: string; }

/** Lifecycle, replay history and high-water records commit in one vault CAS transaction. */
export class SecureStorageDeviceLifecyclePersistence implements DeviceLifecyclePersistence {
    private static readonly locks = new Map<string, AsyncMutex>();
    public constructor(private readonly storage: SecureStorage) {}
    private lock(scope: string): AsyncMutex {
        const existing = SecureStorageDeviceLifecyclePersistence.locks.get(scope);
        if (existing) return existing;
        const created = new AsyncMutex();
        SecureStorageDeviceLifecyclePersistence.locks.set(scope, created);
        return created;
    }
    private async readHighwater(scope: string): Promise<LifecycleHighwater | undefined> {
        const stored = await this.storage.read(HIGHWATER_RECORD_TYPE, await canonicalIdentityRecordId(scope));
        if (!stored) return undefined;
        let value: LifecycleHighwater;
        try { value = JSON.parse(decoder.decode(stored)) as LifecycleHighwater; } catch { throw new Error('Device lifecycle high-water mark is invalid.'); }
        if (value.version !== 1 || !Number.isSafeInteger(value.highestEpoch) || value.highestEpoch < 0 || typeof value.commitment !== 'string') throw new Error('Device lifecycle high-water mark is invalid.');
        return value;
    }
    private async readRecord(scope: string): Promise<LifecycleRecord | undefined> {
        const stored = await this.storage.read(RECORD_TYPE, await canonicalIdentityRecordId(scope));
        if (!stored) {
            if (await this.readHighwater(scope)) throw new Error('Established lifecycle state is missing.');
            return undefined;
        }
        let value: Partial<LifecycleRecord>;
        try { value = JSON.parse(decoder.decode(stored)) as Partial<LifecycleRecord>; } catch { throw new Error('Device lifecycle state is invalid.'); }
        if (!value?.state?.list || !Array.isArray(value.authorizations) || !Number.isSafeInteger(value.state.list.epoch)) throw new Error('Device lifecycle state is invalid.');
        const list = createDeviceList(value.state.list);
        if (list.identityReference !== scope) throw new Error('Device lifecycle scope mismatch.');
        const commitment = await deviceListCommitment(list);
        if (value.state.commitment !== commitment) throw new Error('Device lifecycle commitment mismatch.');
        const highestEpoch = value.highestEpoch ?? list.epoch;
        if (highestEpoch !== list.epoch || !Number.isSafeInteger(highestEpoch) || highestEpoch < 0) throw new Error('Device lifecycle epoch rollback detected.');
        const commitmentHistory = value.commitmentHistory ?? [{ epoch: list.epoch, commitment }];
        if (!Array.isArray(commitmentHistory) || commitmentHistory.some((item) => !Number.isSafeInteger(item.epoch) || typeof item.commitment !== 'string')) throw new Error('Device lifecycle history is invalid.');
        const matching = commitmentHistory.find((item) => item.epoch === list.epoch);
        if (!matching || matching.commitment !== commitment) throw new Error('Device lifecycle commitment history mismatch.');
        const highwater = await this.readHighwater(scope);
        if (highwater && (highwater.highestEpoch > list.epoch || (highwater.highestEpoch === list.epoch && highwater.commitment !== commitment))) throw new Error('Device lifecycle rollback detected.');
        return { version: 2, state: { list, commitment }, authorizations: value.authorizations, highestEpoch, commitmentHistory };
    }
    public async read(scope: string): Promise<LifecycleStateSnapshot | undefined> { return (await this.readRecord(scope))?.state; }
    public async readAuthorization(scope: string, digest: string): Promise<AuthorizationRecord | undefined> { return (await this.readRecord(scope))?.authorizations.find((entry) => entry.digest === digest); }
    public async suspendTrust(scope: string, epoch: number, commitment: string): Promise<void> {
        await this.lock(scope).runExclusive(async () => {
            const id = await canonicalIdentityRecordId(scope);
            const expected = await this.storage.read(RECORD_TYPE, id);
            const highwater = await this.storage.read(HIGHWATER_RECORD_TYPE, id);
            if (!expected || !this.storage.compareAndSwapRecords) throw new Error('Trust suspension storage unavailable.');
            const previous = await this.readHighwater(scope);
            if (previous && previous.highestEpoch > epoch) return;
            await this.writeAtomic(id, expected, highwater, expected, bytes({ version: 1, highestEpoch: epoch, commitment }));
        });
    }
    public async initialize(scope: string, list: DeviceList): Promise<LifecycleStateSnapshot> {
        return this.lock(scope).runExclusive(async () => {
        const id = await canonicalIdentityRecordId(scope);
        const expected = await this.storage.read(RECORD_TYPE, id);
        const expectedHighwater = await this.storage.read(HIGHWATER_RECORD_TYPE, id);
        const existing = await this.readRecord(scope);
        if (existing) {
            return existing.state;
        }
        const normalized = createDeviceList(list);
        if (normalized.identityReference !== scope) throw new Error('Device lifecycle scope mismatch.');
        const state = { list: normalized, commitment: await deviceListCommitment(normalized) };
        await this.writeAtomic(id, expected, expectedHighwater,
            bytes({ version: 2, state, authorizations: [], highestEpoch: normalized.epoch, commitmentHistory: [{ epoch: normalized.epoch, commitment: state.commitment }] }),
            bytes({ version: 1, highestEpoch: normalized.epoch, commitment: state.commitment }));
        return state;
        });
    }
    public async installEnrollmentApproval(scope: string, state: LifecycleStateSnapshot, authorization: DeviceAuthorization): Promise<void> {
        await this.lock(scope).runExclusive(async () => {
            if (authorization.operation !== 'enroll' || authorization.userScope !== scope || authorization.previousEpoch + 1 !== state.list.epoch ||
                state.list.identityReference !== scope || state.list.previousCommitment !== authorization.previousCommitment ||
                state.commitment !== await deviceListCommitment(state.list) || !(await verifyAuthorizationDigest(authorization))) throw new Error('Enrollment approval rejected.');
            const author = state.list.devices.find((entry) => entry.deviceId === authorization.authorDeviceId && entry.publicIdentityReference === authorization.authorIdentityReference && entry.state === 'active');
            const target = state.list.devices.find((entry) => entry.deviceId === authorization.targetDeviceId && entry.publicIdentityReference === authorization.targetPublicIdentityReference && entry.state === 'approved_pending_confirmation');
            if (!author || !target || target.algorithm !== authorization.targetAlgorithm) throw new Error('Enrollment approval rejected.');
            const id = await canonicalIdentityRecordId(scope);
            const expected = await this.storage.read(RECORD_TYPE, id);
            const expectedHighwater = await this.storage.read(HIGHWATER_RECORD_TYPE, id);
            if (expected || expectedHighwater) throw new Error('Enrollment approval replayed.');
            const record: AuthorizationRecord = { operation: 'enroll', transactionNonce: authorization.transactionNonce, authorDeviceId: authorization.authorDeviceId, sequence: authorization.sequence, digest: authorization.authorizationDigest, expiresAt: authorization.expiresAt };
            await this.writeAtomic(id, undefined, undefined,
                bytes({ version: 2, state, authorizations: [record], highestEpoch: state.list.epoch, commitmentHistory: [{ epoch: state.list.epoch, commitment: state.commitment }] }),
                bytes({ version: 1, highestEpoch: state.list.epoch, commitment: state.commitment }));
        });
    }
    public async installTrustUpdate(scope: string, current: LifecycleStateSnapshot, next: LifecycleStateSnapshot, authenticatedPeer: { deviceId: string; identityReference: string }): Promise<void> {
        await this.lock(scope).runExclusive(async () => {
            const record = await this.readRecord(scope);
            if (!record || record.state.list.epoch !== current.list.epoch || record.state.commitment !== current.commitment ||
                next.list.identityReference !== scope || next.list.epoch !== current.list.epoch + 1 || next.list.previousCommitment !== current.commitment ||
                next.commitment !== await deviceListCommitment(next.list)) throw new Error('Trust update rejected.');
            const priorPeer = current.list.devices.find((entry) => entry.deviceId === authenticatedPeer.deviceId && entry.publicIdentityReference === authenticatedPeer.identityReference && entry.state === 'active');
            const nextPeer = next.list.devices.find((entry) => entry.deviceId === authenticatedPeer.deviceId && entry.publicIdentityReference === authenticatedPeer.identityReference && entry.state === 'active');
            if (!priorPeer || !nextPeer || current.list.devices.length !== next.list.devices.length) throw new Error('Trust update rejected.');
            for (const prior of current.list.devices) {
                const updated = next.list.devices.find((entry) => entry.deviceId === prior.deviceId);
                if (!updated || updated.publicIdentityReference !== prior.publicIdentityReference || updated.algorithm !== prior.algorithm ||
                    (prior.state !== updated.state && !(prior.state === 'active' && updated.state === 'revoked'))) throw new Error('Trust update rejected.');
            }
            const id = await canonicalIdentityRecordId(scope);
            const expected = await this.storage.read(RECORD_TYPE, id);
            const expectedHighwater = await this.storage.read(HIGHWATER_RECORD_TYPE, id);
            const history = [...record.commitmentHistory, { epoch: next.list.epoch, commitment: next.commitment }].slice(-256);
            await this.writeAtomic(id, expected, expectedHighwater,
                bytes({ ...record, state: next, highestEpoch: next.list.epoch, commitmentHistory: history }),
                bytes({ version: 1, highestEpoch: next.list.epoch, commitment: next.commitment }));
        });
    }
    private async writeAtomic(id: string, expected: ArrayBuffer | undefined, highwater: ArrayBuffer | undefined, next: ArrayBuffer, nextHighwater: ArrayBuffer): Promise<void> {
        if (!this.storage.compareAndSwapRecords) throw new Error('Atomic lifecycle persistence is unavailable.');
        if (!await this.storage.compareAndSwapRecords([
            { recordType: RECORD_TYPE, recordId: id, expected, next },
            { recordType: HIGHWATER_RECORD_TYPE, recordId: id, expected: highwater, next: nextHighwater },
        ])) throw new Error('Device lifecycle state conflict.');
    }
    private async commit(scope: string, expectedEpoch: number, previousCommitment: string, nextList: DeviceList, nextCommitment: string, authorization: AuthorizationRecord): Promise<void> {
        await this.lock(scope).runExclusive(async () => {
            const id = await canonicalIdentityRecordId(scope);
            const expected = await this.storage.read(RECORD_TYPE, id);
            const expectedHighwater = await this.storage.read(HIGHWATER_RECORD_TYPE, id);
            const current = await this.readRecord(scope);
            const normalized = createDeviceList(nextList);
            if (normalized.identityReference !== scope) throw new Error('Device lifecycle scope mismatch.');
            const computedNextCommitment = await deviceListCommitment(normalized);
            if (!current || current.state.list.epoch !== expectedEpoch || current.highestEpoch !== expectedEpoch || current.state.commitment !== previousCommitment || normalized.epoch !== expectedEpoch + 1 || normalized.previousCommitment !== previousCommitment || computedNextCommitment !== nextCommitment || current.authorizations.some((item) => item.transactionNonce === authorization.transactionNonce)) throw new Error('Device lifecycle state conflict.');
            const state = { list: normalized, commitment: computedNextCommitment };
            const history = [...current.commitmentHistory, { epoch: normalized.epoch, commitment: computedNextCommitment }].slice(-256);
            await this.writeAtomic(id, expected, expectedHighwater,
                bytes({ version: 2, state, authorizations: [...current.authorizations, authorization], highestEpoch: normalized.epoch, commitmentHistory: history }),
                bytes({ version: 1, highestEpoch: normalized.epoch, commitment: computedNextCommitment }));
            const persisted = await this.readRecord(scope);
            if (!persisted || persisted.state.commitment !== computedNextCommitment || persisted.highestEpoch !== normalized.epoch) throw new Error('Device lifecycle commit verification failed.');
        });
    }
    public async commitEnrollment(input: Parameters<DeviceLifecyclePersistence['commitEnrollment']>[0]): Promise<void> { return this.commit(input.scope, input.expectedEpoch, input.previousCommitment, input.nextList, input.nextCommitment, input.authorization); }
    public async commitRevocation(input: Parameters<DeviceLifecyclePersistence['commitRevocation']>[0]): Promise<void> { return this.commit(input.scope, input.expectedEpoch, input.previousCommitment, input.nextList, input.nextCommitment, input.authorization); }
}

/** Encrypts device-control messages through the existing signaling session; no raw send path is exposed. */
export class AuthenticatedDeviceControlChannel {
    public constructor(private readonly session: { encrypted: boolean; ready: boolean; encrypt(channel: 'signaling', plaintext: ArrayBuffer): Promise<EncryptedEnvelope>; decrypt(channel: 'signaling', envelope: EncryptedEnvelope): Promise<ArrayBuffer> }, private readonly transport: TransportManager) {}
    public async send(message: DeviceControlMessage): Promise<void> {
        if (!this.session.encrypted || !this.session.ready) throw new Error('Authenticated device control is unavailable.');
        const encoded = encoder.encode(`${CONTROL_PREFIX}${JSON.stringify(message)}`).buffer as ArrayBuffer;
        if (!decodeDeviceControl(encoded)) throw new Error('Invalid device control message.');
        await this.transport.sendEnvelope('signaling', await this.session.encrypt('signaling', encoded), undefined, 'device-control');
    }
    public async receive(envelope: EncryptedEnvelope): Promise<DeviceControlMessage | undefined> {
        if (!this.session.encrypted || !this.session.ready) throw new Error('Authenticated device control is unavailable.');
        return this.decode(await this.session.decrypt('signaling', envelope));
    }
    public decode(plaintext: ArrayBuffer): DeviceControlMessage | undefined { return decodeDeviceControl(plaintext); }
}
