import type { StoredContactIdentity } from './contactIdentityRegistry';

export type VerificationState = 'unknown' | 'unverified' | 'verified' | 'changed-pending-review';

export interface CanonicalVerificationQrPayload {
    version: 1;
    algorithm: 'vodozemac';
    fingerprint: string;
}

const FINGERPRINT_PATTERN = /^K3 [A-Z0-9_-]+(?: [A-Z0-9_-]+)*$/;

const assertFingerprint = (fingerprint: string): void => {
    if (typeof fingerprint !== 'string' || fingerprint.length < 7 || fingerprint.length > 160 ||
        !FINGERPRINT_PATTERN.test(fingerprint)) {
        throw new Error('Invalid verification fingerprint.');
    }
};

/** 96 comparison bits from both complete public fingerprints; never a trust decision. */
export const deriveHumanVerificationCode = async (left: string, right: string): Promise<string> => {
    assertFingerprint(left); assertFingerprint(right);
    const ordered = [left, right].sort();
    const input = new TextEncoder().encode(`k3ncrypt:relationship-comparison:v1\0${JSON.stringify(ordered)}`);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    return Array.from({ length: 6 }, (_, index) => String((digest[index * 2] << 8) | digest[index * 2 + 1]).padStart(5, '0')).join(' · ');
};

export const verificationQrMatches = (encoded: string, pinnedFingerprint: string): boolean => {
    try { return decodeVerificationQrPayload(encoded).fingerprint === pinnedFingerprint; } catch { return false; }
};

/**
 * Produces a deterministic, public-only QR payload. This is a data boundary,
 * not a verification decision: callers must still compare out of band and
 * explicitly mark the contact verified.
 */
export const encodeVerificationQrPayload = (fingerprint: string): string => {
    assertFingerprint(fingerprint);
    return JSON.stringify({ version: 1, algorithm: 'vodozemac', fingerprint });
};

export const decodeVerificationQrPayload = (encoded: string): CanonicalVerificationQrPayload => {
    if (typeof encoded !== 'string' || encoded.length > 512) throw new Error('Invalid verification payload.');
    let parsed: unknown;
    try { parsed = JSON.parse(encoded); } catch { throw new Error('Invalid verification payload.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid verification payload.');
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'algorithm,fingerprint,version' ||
        value.version !== 1 || value.algorithm !== 'vodozemac' || typeof value.fingerprint !== 'string') {
        throw new Error('Invalid verification payload.');
    }
    assertFingerprint(value.fingerprint);
    if (encoded !== JSON.stringify({ version: 1, algorithm: 'vodozemac', fingerprint: value.fingerprint })) {
        throw new Error('Invalid verification payload.');
    }
    return { version: 1, algorithm: 'vodozemac', fingerprint: value.fingerprint };
};

/** Maps persisted contact data into the externally visible trust state. */
export const verificationStateForContact = (contact: Pick<StoredContactIdentity, 'verification' | 'changeStatus'>): VerificationState =>
    contact.changeStatus === 'changed-pending-review' ? 'changed-pending-review' : contact.verification;
