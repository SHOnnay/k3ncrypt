import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { deviceListCommitment } from './canonicalEncoding';
import { createDeviceList } from './deviceList';
import type { DeviceList } from './deviceIdentity';
import type { AuthorizationRecord, DeviceLifecyclePersistence, LifecycleStateSnapshot } from './lifecycle';

const RECORD_TYPE = 'device-lifecycle';
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

/** Single-record local persistence boundary; production multi-device stores must add CAS/atomic claims. */
export class SecureStorageDeviceLifecyclePersistence implements DeviceLifecyclePersistence {
    public constructor(private readonly storage: SecureStorage) {}
    private async readRecord(scope: string): Promise<{ state: LifecycleStateSnapshot; authorizations: AuthorizationRecord[] } | undefined> {
        const stored = await this.storage.read(RECORD_TYPE, scope);
        if (!stored) return undefined;
        const value = JSON.parse(decoder.decode(stored)) as { state: LifecycleStateSnapshot; authorizations: AuthorizationRecord[] };
        if (!value?.state?.list || !Array.isArray(value.authorizations)) throw new Error('Device lifecycle state is invalid.');
        return value;
    }
    public async read(scope: string): Promise<LifecycleStateSnapshot | undefined> { return (await this.readRecord(scope))?.state; }
    public async initialize(scope: string, list: DeviceList): Promise<LifecycleStateSnapshot> {
        const existing = await this.readRecord(scope);
        if (existing) return existing.state;
        const state = { list: createDeviceList(list), commitment: await deviceListCommitment(list) };
        await this.storage.write(RECORD_TYPE, scope, bytes({ state, authorizations: [] }));
        return state;
    }
    private async commit(scope: string, expectedEpoch: number, previousCommitment: string, nextList: DeviceList, nextCommitment: string, authorization: AuthorizationRecord): Promise<void> {
        const current = await this.readRecord(scope);
        if (!current || current.state.list.epoch !== expectedEpoch || current.state.commitment !== previousCommitment || current.authorizations.some((item) => item.transactionNonce === authorization.transactionNonce)) throw new Error('Device lifecycle state conflict.');
        const state = { list: createDeviceList(nextList), commitment: nextCommitment };
        await this.storage.write(RECORD_TYPE, scope, bytes({ state, authorizations: [...current.authorizations, authorization] }));
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
