import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { deviceListCommitment } from './canonicalEncoding';
import { createDeviceList } from './deviceList';
import type { DeviceList } from './deviceIdentity';
import type { AuthorizationRecord, DeviceLifecyclePersistence, LifecycleStateSnapshot } from './lifecycle';
import { AsyncMutex } from '../utils/asyncMutex';

const RECORD_TYPE = 'device-lifecycle';
const HIGHWATER_RECORD_TYPE = 'device-lifecycle-highwater';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONTROL_PREFIX = 'k3ncrypt-device-control-v1:';

export type DeviceControlMessage = {
    readonly type: 'enrollment-request' | 'enrollment-approval' | 'enrollment-rejection' | 'revocation';
    readonly payload: unknown;
};

const bytes = (value: unknown): ArrayBuffer => encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer;
const parse = (value: ArrayBuffer): DeviceControlMessage | undefined => {
    const text = decoder.decode(value);
    if (!text.startsWith(CONTROL_PREFIX)) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(text.slice(CONTROL_PREFIX.length)); } catch { throw new Error('Invalid device control message.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid device control message.');
    const record = parsed as Record<string, unknown>;
    if (!['enrollment-request', 'enrollment-approval', 'enrollment-rejection', 'revocation'].includes(record.type as string) || !('payload' in record)) throw new Error('Invalid device control message.');
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

/** Single encrypted record with process-local CAS serialization; deployment stores must provide cross-instance atomic claims. */
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
        const stored = await this.storage.read(HIGHWATER_RECORD_TYPE, scope);
        if (!stored) return undefined;
        let value: LifecycleHighwater;
        try { value = JSON.parse(decoder.decode(stored)) as LifecycleHighwater; } catch { throw new Error('Device lifecycle high-water mark is invalid.'); }
        if (value.version !== 1 || !Number.isSafeInteger(value.highestEpoch) || value.highestEpoch < 0 || typeof value.commitment !== 'string') throw new Error('Device lifecycle high-water mark is invalid.');
        return value;
    }
    private async readRecord(scope: string): Promise<LifecycleRecord | undefined> {
        const stored = await this.storage.read(RECORD_TYPE, scope);
        if (!stored) return undefined;
        let value: Partial<LifecycleRecord>;
        try { value = JSON.parse(decoder.decode(stored)) as Partial<LifecycleRecord>; } catch { throw new Error('Device lifecycle state is invalid.'); }
        if (!value?.state?.list || !Array.isArray(value.authorizations) || !Number.isSafeInteger(value.state.list.epoch)) throw new Error('Device lifecycle state is invalid.');
        const list = createDeviceList(value.state.list);
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
    public async initialize(scope: string, list: DeviceList): Promise<LifecycleStateSnapshot> {
        const existing = await this.readRecord(scope);
        if (existing) {
            if (!(await this.readHighwater(scope))) await this.storage.write(HIGHWATER_RECORD_TYPE, scope, bytes({ version: 1, highestEpoch: existing.state.list.epoch, commitment: existing.state.commitment }));
            return existing.state;
        }
        const normalized = createDeviceList(list);
        const state = { list: normalized, commitment: await deviceListCommitment(normalized) };
        await this.storage.write(RECORD_TYPE, scope, bytes({ version: 2, state, authorizations: [], highestEpoch: normalized.epoch, commitmentHistory: [{ epoch: normalized.epoch, commitment: state.commitment }] }));
        await this.storage.write(HIGHWATER_RECORD_TYPE, scope, bytes({ version: 1, highestEpoch: normalized.epoch, commitment: state.commitment }));
        return state;
    }
    private async commit(scope: string, expectedEpoch: number, previousCommitment: string, nextList: DeviceList, nextCommitment: string, authorization: AuthorizationRecord): Promise<void> {
        await this.lock(scope).runExclusive(async () => {
            const current = await this.readRecord(scope);
            const normalized = createDeviceList(nextList);
            const computedNextCommitment = await deviceListCommitment(normalized);
            if (!current || current.state.list.epoch !== expectedEpoch || current.highestEpoch !== expectedEpoch || current.state.commitment !== previousCommitment || normalized.epoch !== expectedEpoch + 1 || normalized.previousCommitment !== previousCommitment || computedNextCommitment !== nextCommitment || current.authorizations.some((item) => item.transactionNonce === authorization.transactionNonce)) throw new Error('Device lifecycle state conflict.');
            const state = { list: normalized, commitment: computedNextCommitment };
            const history = [...current.commitmentHistory, { epoch: normalized.epoch, commitment: computedNextCommitment }].slice(-256);
            await this.storage.write(RECORD_TYPE, scope, bytes({ version: 2, state, authorizations: [...current.authorizations, authorization], highestEpoch: normalized.epoch, commitmentHistory: history }));
            await this.storage.write(HIGHWATER_RECORD_TYPE, scope, bytes({ version: 1, highestEpoch: normalized.epoch, commitment: computedNextCommitment }));
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
        await this.transport.sendEnvelope('signaling', await this.session.encrypt('signaling', bytes(`${CONTROL_PREFIX}${JSON.stringify(message)}`)));
    }
    public async receive(envelope: EncryptedEnvelope): Promise<DeviceControlMessage | undefined> {
        if (!this.session.encrypted || !this.session.ready) throw new Error('Authenticated device control is unavailable.');
        return this.decode(await this.session.decrypt('signaling', envelope));
    }
    public decode(plaintext: ArrayBuffer): DeviceControlMessage | undefined { return parse(plaintext); }
}
