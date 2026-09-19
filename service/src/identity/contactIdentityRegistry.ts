import type { ContactIdentity, SecureStorage } from '../core/contracts';
import { fromBase64Url, toBase64Url } from '../crypto/base64url';

const RECORD_TYPE = 'contact-identity';

export type IdentityChangeStatus = 'unchanged' | 'changed-pending-review';

export interface StoredContactIdentity {
    contactId: string;
    identityId: string;
    algorithm: string;
    publicKey: string;
    verification: ContactIdentity['verification'];
    changeStatus: IdentityChangeStatus;
    identityChangedAt?: number;
    pendingIdentity?: {
        identityId: string;
        algorithm: string;
        publicKey: string;
    };
}

export type ContactIdentityEvent =
    | { kind: 'first-seen'; current: StoredContactIdentity }
    | { kind: 'unchanged'; current: StoredContactIdentity }
    | { kind: 'identity-changed'; current: StoredContactIdentity; presented: StoredContactIdentity['pendingIdentity']; verifiedIdentityPreserved: boolean };

const parseStored = (bytes: ArrayBuffer): StoredContactIdentity => {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StoredContactIdentity;
    const allowed = ['algorithm', 'changeStatus', 'contactId', 'identityChangedAt', 'identityId', 'pendingIdentity', 'publicKey', 'verification'];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        Object.keys(parsed).some((key) => !allowed.includes(key)) ||
        typeof parsed.contactId !== 'string' || typeof parsed.identityId !== 'string' ||
        typeof parsed.algorithm !== 'string' || typeof parsed.publicKey !== 'string' ||
        !['unknown', 'unverified', 'verified'].includes(parsed.verification) ||
        !['unchanged', 'changed-pending-review'].includes(parsed.changeStatus)) {
        throw new Error('Corrupted contact identity record.');
    }
    fromBase64Url(parsed.publicKey);
    return parsed;
};

const encodeStored = (value: StoredContactIdentity): ArrayBuffer =>
    new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;

/** Detects key changes and requires explicit acceptance before replacing any known identity. */
export class ContactIdentityRegistry {
    constructor(private readonly storage: SecureStorage, private readonly now: () => number = Date.now) {}

    public async observe(contactId: string, presented: ContactIdentity): Promise<ContactIdentityEvent> {
        const storedBytes = await this.storage.read(RECORD_TYPE, contactId);
        const presentedRecord = {
            identityId: presented.identityId,
            algorithm: presented.algorithm,
            publicKey: toBase64Url(presented.publicKey),
        };
        if (!storedBytes) {
            const current: StoredContactIdentity = {
                contactId,
                ...presentedRecord,
                verification: presented.verification,
                changeStatus: 'unchanged',
            };
            await this.storage.write(RECORD_TYPE, contactId, encodeStored(current));
            return { kind: 'first-seen', current };
        }
        const current = parseStored(storedBytes);
        if (current.identityId === presentedRecord.identityId &&
            current.algorithm === presentedRecord.algorithm && current.publicKey === presentedRecord.publicKey) {
            return { kind: 'unchanged', current };
        }
        const changed: StoredContactIdentity = {
            ...current,
            // A changed key can never inherit a previous verification. The
            // old verified state remains observable through the event, while
            // the pending key requires a fresh explicit verification.
            verification: current.verification === 'verified' ? 'unverified' : current.verification,
            changeStatus: 'changed-pending-review',
            identityChangedAt: this.now(),
            pendingIdentity: presentedRecord,
        };
        await this.storage.write(RECORD_TYPE, contactId, encodeStored(changed));
        return {
            kind: 'identity-changed',
            current: changed,
            presented: presentedRecord,
            verifiedIdentityPreserved: current.verification === 'verified',
        };
    }

    public async markVerified(contactId: string): Promise<void> {
        const bytes = await this.storage.read(RECORD_TYPE, contactId);
        if (!bytes) throw new Error('Unknown contact identity.');
        const current = parseStored(bytes);
        await this.storage.write(RECORD_TYPE, contactId, encodeStored({ ...current, verification: 'verified' }));
    }

    public async acceptPendingChange(contactId: string): Promise<void> {
        const bytes = await this.storage.read(RECORD_TYPE, contactId);
        if (!bytes) throw new Error('Unknown contact identity.');
        const current = parseStored(bytes);
        if (!current.pendingIdentity) throw new Error('No pending identity change.');
        const { pendingIdentity } = current;
        await this.storage.write(RECORD_TYPE, contactId, encodeStored({
            contactId,
            ...pendingIdentity,
            verification: 'unverified',
            changeStatus: 'unchanged',
        }));
    }
}
