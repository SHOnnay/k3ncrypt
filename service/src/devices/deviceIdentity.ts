/** Public-only device identity records. Private keys remain in the existing identity/vault boundary. */

export type DeviceLifecycleState = 'pending_enrollment' | 'approved_pending_confirmation' | 'active' | 'revoked';

export interface DeviceEntry {
    readonly deviceId: string;
    readonly publicIdentityReference: string;
    readonly algorithm: string;
    readonly state: DeviceLifecycleState;
    readonly createdAt: number;
    readonly revokedAt?: number;
    readonly label?: string;
}

export interface DeviceList {
    readonly version: 1;
    readonly identityReference: string;
    readonly epoch: number;
    readonly previousCommitment: string | null;
    readonly devices: readonly DeviceEntry[];
}

const MAX_ID_LENGTH = 256;
const MAX_ALGORITHM_LENGTH = 128;
const MAX_LABEL_LENGTH = 128;
const COMMITMENT_PATTERN = /^[0-9a-f]{64}$/;

const fail = (message = 'Invalid device identity record.'): never => { throw new Error(message); };

const assertString: (value: unknown, field: string, maxLength?: number) => asserts value is string = (value, field, maxLength = MAX_ID_LENGTH) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value) || value.normalize('NFC') !== value) {
        fail(`Invalid device identity ${field}.`);
    }
};

const assertTimestamp: (value: unknown, field: string) => asserts value is number = (value, field) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`Invalid device identity ${field}.`);
};

const assertRecordKeys = (value: Record<string, unknown>, allowed: readonly string[]): void => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
};

const freezeEntry = (entry: DeviceEntry): DeviceEntry => Object.freeze({ ...entry });

/** Validates and deep-freezes a public device entry. */
export const createDeviceEntry = (input: DeviceEntry): DeviceEntry => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
    const value = input as unknown as Record<string, unknown>;
    assertRecordKeys(value, ['algorithm', 'createdAt', 'deviceId', 'label', 'publicIdentityReference', 'revokedAt', 'state']);
    assertString(value.deviceId, 'deviceId');
    assertString(value.publicIdentityReference, 'publicIdentityReference');
    assertString(value.algorithm, 'algorithm', MAX_ALGORITHM_LENGTH);
    if (value.state !== 'pending_enrollment' && value.state !== 'approved_pending_confirmation' && value.state !== 'active' && value.state !== 'revoked') fail('Invalid device lifecycle state.');
    assertTimestamp(value.createdAt, 'createdAt');
    if (value.revokedAt !== undefined) assertTimestamp(value.revokedAt, 'revokedAt');
    if (value.label !== undefined) assertString(value.label, 'label', MAX_LABEL_LENGTH);
    if (value.state === 'revoked' && value.revokedAt === undefined) fail('Revoked devices require revokedAt.');
    if (value.state !== 'revoked' && value.revokedAt !== undefined) fail('Only revoked devices may have revokedAt.');
    if (value.revokedAt !== undefined && (value.revokedAt as number) < (value.createdAt as number)) fail('Device revocation precedes creation.');
    return freezeEntry({
        deviceId: value.deviceId,
        publicIdentityReference: value.publicIdentityReference,
        algorithm: value.algorithm,
        state: value.state,
        createdAt: value.createdAt,
        ...(value.revokedAt === undefined ? {} : { revokedAt: value.revokedAt }),
        ...(value.label === undefined ? {} : { label: value.label }),
    } as DeviceEntry);
};

/** Returns whether a lifecycle transition is permitted by the Phase 6B.1 model. */
export const isValidDeviceLifecycleTransition = (from: DeviceLifecycleState, to: DeviceLifecycleState): boolean =>
    from === to || (from === 'pending_enrollment' && (to === 'approved_pending_confirmation' || to === 'revoked')) ||
    (from === 'approved_pending_confirmation' && (to === 'active' || to === 'revoked')) || (from === 'active' && to === 'revoked');

export const assertDeviceCanAuthorize = (entry: DeviceEntry): void => {
    if (entry.state !== 'active') fail('Only active devices may authorize operations.');
};

export const assertDeviceEntryTransition = (from: DeviceEntry, to: DeviceEntry): void => {
    if (from.deviceId !== to.deviceId || from.publicIdentityReference !== to.publicIdentityReference) {
        fail('Device identity cannot change through a lifecycle transition.');
    }
    if (!isValidDeviceLifecycleTransition(from.state, to.state)) fail('Invalid device lifecycle transition.');
    createDeviceEntry(to);
};

export const isCommitment = (value: unknown): value is string => typeof value === 'string' && COMMITMENT_PATTERN.test(value);

export { COMMITMENT_PATTERN };
