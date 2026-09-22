import type { CryptoSession } from '../core/contracts';
import { assertDeviceCanAuthorize, createDeviceEntry, type DeviceEntry, type DeviceList } from './deviceIdentity';
import { deviceListCommitment } from './canonicalEncoding';
import { assertNextEpoch } from './epoch';
import { createDeviceList, deviceEntryById } from './deviceList';
import { assertIssuedDeviceContext } from './authenticatedContext';

export type DeviceAuthorizationOperation = 'enroll' | 'revoke';

/** Identity asserted by the authenticated session boundary, never by a request/UI payload. */
export interface AuthenticatedSenderIdentity {
    readonly deviceId: string;
    readonly identityReference: string;
    readonly userScope: string;
    readonly verified: boolean;
}

export interface AuthenticatedDeviceContext {
    readonly cryptoSession: CryptoSession;
    readonly conversationId: string;
    readonly userScope: string;
    readonly authenticatedSender: AuthenticatedSenderIdentity;
}

export interface EnrollmentRequest {
    readonly version: 1;
    readonly userScope: string;
    readonly transactionNonce: string;
    readonly requestedDeviceId: string;
    readonly requestedPublicIdentityReference: string;
    readonly algorithm: string;
    readonly purpose: 'device-enrollment';
    readonly knownEpoch: number;
    readonly createdAt: number;
    readonly expiresAt: number;
}

export interface DeviceAuthorization {
    readonly version: 1;
    readonly operation: DeviceAuthorizationOperation;
    readonly userScope: string;
    readonly authorDeviceId: string;
    readonly authorIdentityReference: string;
    readonly targetDeviceId: string;
    readonly targetPublicIdentityReference?: string;
    readonly targetAlgorithm?: string;
    readonly previousEpoch: number;
    readonly previousCommitment: string;
    readonly transactionNonce: string;
    readonly sequence: number;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly authorizationDigest: string;
}

export interface EnrollmentConfirmation {
    readonly version: 1;
    readonly authorizationDigest: string;
    readonly targetDeviceId: string;
    readonly targetIdentityReference: string;
    readonly confirmationNonce: string;
    readonly confirmedAt: number;
    readonly expiresAt: number;
    readonly confirmationDigest: string;
}

export interface RevocationConfirmation {
    readonly version: 1;
    readonly authorizationDigest: string;
    readonly targetDeviceId: string;
    readonly confirmationNonce: string;
    readonly confirmedAt: number;
    readonly expiresAt: number;
    readonly confirmationDigest: string;
}

export interface LifecycleStateSnapshot {
    readonly list: DeviceList;
    readonly commitment: string;
}

export interface AuthorizationRecord {
    readonly operation: DeviceAuthorizationOperation;
    readonly transactionNonce: string;
    readonly authorDeviceId: string;
    readonly sequence: number;
    readonly digest: string;
    readonly expiresAt: number;
}

/** Production boundary: implementations must atomically claim and commit all fields. */
export interface DeviceLifecyclePersistence {
    initialize?(scope: string, list: DeviceList): Promise<LifecycleStateSnapshot>;
    readAuthorization?(scope: string, digest: string): Promise<AuthorizationRecord | undefined>;
    suspendTrust?(scope: string, epoch: number, commitment: string): Promise<void>;
    installEnrollmentApproval?(scope: string, state: LifecycleStateSnapshot, authorization: DeviceAuthorization): Promise<void>;
    installTrustUpdate?(scope: string, current: LifecycleStateSnapshot, next: LifecycleStateSnapshot, authenticatedPeer: { deviceId: string; identityReference: string }): Promise<void>;
    read(scope: string): Promise<LifecycleStateSnapshot | undefined>;
    commitEnrollment(input: {
        readonly scope: string;
        readonly expectedEpoch: number;
        readonly previousCommitment: string;
        readonly nextList: DeviceList;
        readonly nextCommitment: string;
        readonly authorization: AuthorizationRecord;
    }): Promise<void>;
    commitRevocation(input: {
        readonly scope: string;
        readonly expectedEpoch: number;
        readonly previousCommitment: string;
        readonly nextList: DeviceList;
        readonly nextCommitment: string;
        readonly authorization: AuthorizationRecord;
    }): Promise<void>;
}

/** Runtime must implement this with the authenticated CryptoSession context; there is no permissive default. */
export interface DeviceAuthorizationVerifier {
    verify(context: AuthenticatedDeviceContext, authorization: DeviceAuthorization): Promise<void>;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const fail = (message: string): never => { throw new Error(message); };
const nowOr = (now: number | undefined): number => now ?? Date.now();
const requireState = (state: LifecycleStateSnapshot | undefined): LifecycleStateSnapshot => state ?? fail('Device list unavailable.');
const requireEntry = (entry: DeviceEntry | undefined, message: string): DeviceEntry => entry ?? fail(message);

const assertContext = (context: AuthenticatedDeviceContext, payload?: unknown): void => {
    assertIssuedDeviceContext(context, payload);
    const sender = context.authenticatedSender;
    if (!context.cryptoSession.encrypted || !context.cryptoSession.ready || !sender?.verified) fail('Authenticated device context unavailable.');
    if (!context.conversationId || !context.userScope || context.userScope !== sender.userScope || !sender.deviceId || !sender.identityReference) fail('Authenticated device context unavailable.');
};

const assertWindow = (createdAt: number, expiresAt: number, now: number): void => {
    if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || createdAt > expiresAt || now < createdAt || now > expiresAt) fail('Device authorization expired.');
};
const assertAuthor = (state: LifecycleStateSnapshot, authorization: DeviceAuthorization): void => {
    const author = requireEntry(deviceEntryById(state.list, authorization.authorDeviceId), 'Authorization issuer unavailable.');
    assertDeviceCanAuthorize(author);
    if (author.publicIdentityReference !== authorization.authorIdentityReference || state.list.identityReference !== authorization.userScope || authorization.version !== 1 || !NONCE_PATTERN.test(authorization.transactionNonce) || authorization.sequence !== authorization.previousEpoch + 1) fail('Authorization issuer or scope rejected.');
};

const canonicalAuthorization = (authorization: Omit<DeviceAuthorization, 'authorizationDigest'>): Uint8Array => {
    const value: Record<string, unknown> = {
        version: 1,
        operation: authorization.operation,
        userScope: authorization.userScope,
        authorDeviceId: authorization.authorDeviceId,
        authorIdentityReference: authorization.authorIdentityReference,
        targetDeviceId: authorization.targetDeviceId,
    };
    if (authorization.targetPublicIdentityReference !== undefined) value.targetPublicIdentityReference = authorization.targetPublicIdentityReference;
    if (authorization.targetAlgorithm !== undefined) value.targetAlgorithm = authorization.targetAlgorithm;
    value.previousEpoch = authorization.previousEpoch;
    value.previousCommitment = authorization.previousCommitment;
    value.transactionNonce = authorization.transactionNonce;
    value.sequence = authorization.sequence;
    value.createdAt = authorization.createdAt;
    value.expiresAt = authorization.expiresAt;
    return new TextEncoder().encode(JSON.stringify(value));
};

const canonicalConfirmation = (confirmation: Omit<EnrollmentConfirmation | RevocationConfirmation, 'confirmationDigest'>): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(confirmation));
const bufferSource = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

const digestBytes = async (bytes: Uint8Array): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new Error('Device authorization is unavailable.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bufferSource(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const authorizationDigest = async (authorization: Omit<DeviceAuthorization, 'authorizationDigest'>): Promise<string> => digestBytes(canonicalAuthorization(authorization));

export const verifyAuthorizationDigest = async (authorization: DeviceAuthorization): Promise<boolean> => {
    if (!DIGEST_PATTERN.test(authorization.authorizationDigest)) return false;
    return (await authorizationDigest(authorization)).toLowerCase() === authorization.authorizationDigest;
};

export const confirmationDigest = async (confirmation: Omit<EnrollmentConfirmation | RevocationConfirmation, 'confirmationDigest'>): Promise<string> => digestBytes(canonicalConfirmation(confirmation));

const verifyConfirmationDigest = async (confirmation: EnrollmentConfirmation | RevocationConfirmation): Promise<boolean> => {
    const { confirmationDigest: digest, ...unsigned } = confirmation;
    return DIGEST_PATTERN.test(digest) && (await confirmationDigest(unsigned)) === digest;
};

export const createEnrollmentConfirmation = async (input: Omit<EnrollmentConfirmation, 'confirmationDigest'>): Promise<EnrollmentConfirmation> =>
    Object.freeze({ ...input, confirmationDigest: await confirmationDigest(input) });

export const createRevocationConfirmation = async (input: Omit<RevocationConfirmation, 'confirmationDigest'>): Promise<RevocationConfirmation> =>
    Object.freeze({ ...input, confirmationDigest: await confirmationDigest(input) });

const randomNonce = (): string => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Device enrollment is unavailable.');
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createEnrollmentRequest = (input: {
    readonly userScope: string;
    readonly requestedDeviceId: string;
    readonly requestedPublicIdentityReference: string;
    readonly algorithm: string;
    readonly knownEpoch: number;
    readonly now?: number;
    readonly ttlMs?: number;
    readonly transactionNonce?: string;
}): EnrollmentRequest => {
    const now = nowOr(input.now);
    const expiresAt = now + (input.ttlMs ?? 5 * 60_000);
    const transactionNonce = input.transactionNonce ?? randomNonce();
    if (!input.userScope || !input.requestedDeviceId || !input.requestedPublicIdentityReference || !input.algorithm || !NONCE_PATTERN.test(transactionNonce) || !Number.isSafeInteger(input.knownEpoch) || input.knownEpoch < 0 || !Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now) fail('Invalid enrollment request.');
    return Object.freeze({ version: 1, userScope: input.userScope, transactionNonce, requestedDeviceId: input.requestedDeviceId,
        requestedPublicIdentityReference: input.requestedPublicIdentityReference, algorithm: input.algorithm, purpose: 'device-enrollment',
        knownEpoch: input.knownEpoch, createdAt: now, expiresAt });
};

export class DeviceLifecycleService {
    public constructor(
        private readonly persistence: DeviceLifecyclePersistence,
        private readonly verifier: DeviceAuthorizationVerifier,
        private readonly now: () => number = Date.now,
    ) {}

    public async approveEnrollment(request: EnrollmentRequest, context: AuthenticatedDeviceContext, confirmedTarget: { deviceId: string; publicIdentityReference: string }): Promise<DeviceAuthorization> {
        assertContext(context);
        if (request.userScope !== context.userScope || request.purpose !== 'device-enrollment' || request.requestedDeviceId !== confirmedTarget.deviceId || request.requestedPublicIdentityReference !== confirmedTarget.publicIdentityReference) fail('Enrollment target mismatch.');
        assertWindow(request.createdAt, request.expiresAt, this.now());
        const sender = context.authenticatedSender;
        const state = requireState(await this.persistence.read(context.userScope));
        const author = requireEntry(deviceEntryById(state.list, sender.deviceId), 'Enrollment issuer unavailable.');
        if (author.publicIdentityReference !== sender.identityReference) fail('Enrollment issuer unavailable.');
        assertDeviceCanAuthorize(author);
        if (request.knownEpoch !== state.list.epoch) fail('Enrollment epoch mismatch.');
        if (deviceEntryById(state.list, request.requestedDeviceId)) fail('Device identifier already exists.');
        const unsigned: Omit<DeviceAuthorization, 'authorizationDigest'> = {
            version: 1, operation: 'enroll', userScope: context.userScope, authorDeviceId: sender.deviceId,
            authorIdentityReference: sender.identityReference, targetDeviceId: request.requestedDeviceId,
            targetPublicIdentityReference: request.requestedPublicIdentityReference, targetAlgorithm: request.algorithm,
            previousEpoch: state.list.epoch, previousCommitment: state.commitment, transactionNonce: request.transactionNonce,
            sequence: state.list.epoch + 1, createdAt: this.now(), expiresAt: request.expiresAt,
        };
        return Object.freeze({ ...unsigned, authorizationDigest: await authorizationDigest(unsigned) });
    }

    public async applyEnrollment(authorization: DeviceAuthorization, context: AuthenticatedDeviceContext): Promise<LifecycleStateSnapshot> {
        assertContext(context, authorization);
        await this.verifier.verify(context, authorization);
        const sender = context.authenticatedSender;
        if (authorization.operation !== 'enroll' || authorization.userScope !== context.userScope || authorization.authorDeviceId !== sender.deviceId || authorization.authorIdentityReference !== sender.identityReference) fail('Enrollment authorization rejected.');
        if (!(await verifyAuthorizationDigest(authorization))) fail('Enrollment authorization rejected.');
        assertWindow(authorization.createdAt, authorization.expiresAt, this.now());
        const state = requireState(await this.persistence.read(context.userScope));
        if (state.list.epoch !== authorization.previousEpoch || state.commitment !== authorization.previousCommitment) fail('Enrollment commitment mismatch.');
        assertAuthor(state, authorization);
        if (deviceEntryById(state.list, authorization.targetDeviceId)) fail('Device identifier already exists.');
        const entry = createDeviceEntry({ deviceId: authorization.targetDeviceId, publicIdentityReference: authorization.targetPublicIdentityReference!, algorithm: authorization.targetAlgorithm!, state: 'approved_pending_confirmation', createdAt: authorization.createdAt });
        const nextList = createDeviceList({ version: 1, identityReference: state.list.identityReference, epoch: state.list.epoch + 1,
            previousCommitment: state.commitment, devices: [...state.list.devices, entry] });
        assertNextEpoch(state.list, nextList);
        const nextCommitment = await deviceListCommitment(nextList);
        await this.persistence.commitEnrollment({ scope: context.userScope, expectedEpoch: state.list.epoch, previousCommitment: state.commitment, nextList, nextCommitment,
            authorization: { operation: 'enroll', transactionNonce: authorization.transactionNonce, authorDeviceId: authorization.authorDeviceId, sequence: authorization.sequence, digest: authorization.authorizationDigest, expiresAt: authorization.expiresAt } });
        return { list: nextList, commitment: nextCommitment };
    }

    public async confirmEnrollment(authorization: DeviceAuthorization, context: AuthenticatedDeviceContext, confirmation: EnrollmentConfirmation): Promise<LifecycleStateSnapshot> {
        assertContext(context, { authorization, confirmation });
        if (authorization.userScope !== context.userScope || confirmation.version !== 1 || !NONCE_PATTERN.test(confirmation.confirmationNonce)) fail('Enrollment confirmation rejected.');
        if (authorization.operation !== 'enroll' || confirmation.authorizationDigest !== authorization.authorizationDigest || confirmation.targetDeviceId !== authorization.targetDeviceId || confirmation.targetIdentityReference !== authorization.targetPublicIdentityReference || context.authenticatedSender.deviceId !== authorization.targetDeviceId || context.authenticatedSender.identityReference !== authorization.targetPublicIdentityReference) fail('Enrollment confirmation rejected.');
        if (!(await verifyAuthorizationDigest(authorization)) || !(await verifyConfirmationDigest(confirmation))) fail('Enrollment confirmation rejected.');
        assertWindow(authorization.createdAt, authorization.expiresAt, this.now());
        assertWindow(confirmation.confirmedAt, confirmation.expiresAt, this.now());
        const state = requireState(await this.persistence.read(context.userScope));
        if (state.list.epoch !== authorization.previousEpoch + 1 || state.commitment !== authorization.previousCommitment && state.list.previousCommitment !== authorization.previousCommitment) fail('Enrollment confirmation epoch mismatch.');
        const target = requireEntry(deviceEntryById(state.list, authorization.targetDeviceId), 'Enrollment target unavailable.');
        assertAuthor(state, authorization);
        const approved = await this.persistence.readAuthorization?.(context.userScope, authorization.authorizationDigest);
        if (!approved || approved.transactionNonce !== authorization.transactionNonce || target.publicIdentityReference !== confirmation.targetIdentityReference || target.algorithm !== authorization.targetAlgorithm) fail('Enrollment confirmation does not match stored approval.');
        if (target.state !== 'approved_pending_confirmation') fail('Enrollment confirmation state invalid.');
        const active = createDeviceEntry({ ...target, state: 'active' });
        const nextList = createDeviceList({ version: 1, identityReference: state.list.identityReference, epoch: state.list.epoch + 1,
            previousCommitment: state.commitment, devices: state.list.devices.map((entry) => entry.deviceId === target.deviceId ? active : entry) });
        assertNextEpoch(state.list, nextList);
        const nextCommitment = await deviceListCommitment(nextList);
        await this.persistence.commitEnrollment({ scope: context.userScope, expectedEpoch: state.list.epoch, previousCommitment: state.commitment, nextList, nextCommitment,
            authorization: { operation: 'enroll', transactionNonce: confirmation.confirmationNonce, authorDeviceId: context.authenticatedSender.deviceId, sequence: authorization.sequence + 1, digest: confirmation.confirmationDigest, expiresAt: confirmation.expiresAt } });
        return { list: nextList, commitment: nextCommitment };
    }

    public async approveRevocation(targetDeviceId: string, context: AuthenticatedDeviceContext, ttlMs = 5 * 60_000): Promise<DeviceAuthorization> {
        assertContext(context);
        const sender = context.authenticatedSender;
        const state = requireState(await this.persistence.read(context.userScope));
        const author = requireEntry(deviceEntryById(state.list, sender.deviceId), 'Revocation issuer unavailable.');
        const target = requireEntry(deviceEntryById(state.list, targetDeviceId), 'Device cannot be revoked.');
        if (author.publicIdentityReference !== sender.identityReference) fail('Revocation issuer unavailable.');
        assertDeviceCanAuthorize(author);
        if (target.state === 'revoked' || target.deviceId === author.deviceId) fail('Device cannot be revoked.');
        const createdAt = this.now();
        const unsigned: Omit<DeviceAuthorization, 'authorizationDigest'> = {
            version: 1, operation: 'revoke', userScope: context.userScope, authorDeviceId: sender.deviceId,
            authorIdentityReference: sender.identityReference, targetDeviceId, previousEpoch: state.list.epoch,
            previousCommitment: state.commitment, transactionNonce: randomNonce(), sequence: state.list.epoch + 1,
            createdAt, expiresAt: createdAt + ttlMs,
        };
        return Object.freeze({ ...unsigned, authorizationDigest: await authorizationDigest(unsigned) });
    }

    public async applyRevocation(authorization: DeviceAuthorization, context: AuthenticatedDeviceContext, confirmation?: RevocationConfirmation): Promise<LifecycleStateSnapshot> {
        if (!confirmation) throw new Error('Explicit revocation confirmation required.');
        assertContext(context, { authorization, confirmation });
        await this.verifier.verify(context, authorization);
        const sender = context.authenticatedSender;
        if (authorization.operation !== 'revoke' || authorization.userScope !== context.userScope || authorization.authorDeviceId !== sender.deviceId || authorization.authorIdentityReference !== sender.identityReference || confirmation.authorizationDigest !== authorization.authorizationDigest || confirmation.targetDeviceId !== authorization.targetDeviceId) fail('Revocation authorization rejected.');
        if (!(await verifyConfirmationDigest(confirmation))) fail('Revocation confirmation rejected.');
        if (!(await verifyAuthorizationDigest(authorization))) fail('Revocation authorization rejected.');
        assertWindow(authorization.createdAt, authorization.expiresAt, this.now());
        const state = requireState(await this.persistence.read(context.userScope));
        if (state.list.epoch !== authorization.previousEpoch || state.commitment !== authorization.previousCommitment) fail('Revocation commitment mismatch.');
        assertAuthor(state, authorization);
        assertWindow(confirmation.confirmedAt, confirmation.expiresAt, this.now());
        if (confirmation.version !== 1 || !NONCE_PATTERN.test(confirmation.confirmationNonce)) fail('Revocation confirmation rejected.');
        const target = requireEntry(deviceEntryById(state.list, authorization.targetDeviceId), 'Device cannot be revoked.');
        if (target.state === 'revoked' || target.deviceId === authorization.authorDeviceId) fail('Device cannot be revoked.');
        const revoked = createDeviceEntry({ ...target, state: 'revoked', revokedAt: this.now() });
        const nextList = createDeviceList({ version: 1, identityReference: state.list.identityReference, epoch: state.list.epoch + 1,
            previousCommitment: state.commitment, devices: state.list.devices.map((entry) => entry.deviceId === target.deviceId ? revoked : entry) });
        assertNextEpoch(state.list, nextList);
        const nextCommitment = await deviceListCommitment(nextList);
        await this.persistence.commitRevocation({ scope: context.userScope, expectedEpoch: state.list.epoch, previousCommitment: state.commitment, nextList, nextCommitment,
            authorization: { operation: 'revoke', transactionNonce: authorization.transactionNonce, authorDeviceId: authorization.authorDeviceId, sequence: authorization.sequence, digest: authorization.authorizationDigest, expiresAt: authorization.expiresAt } });
        return { list: nextList, commitment: nextCommitment };
    }
}
