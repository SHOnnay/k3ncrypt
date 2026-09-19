import type { IdentityManager, MessagingIdentity, SecureStorage } from '../core/contracts';
import { toBase64Url } from '../crypto/base64url';

const ACCOUNT_RECORD_TYPE = 'vodozemac-account';
const LOCAL_ACCOUNT_ID = 'local';

export interface VodozemacPublicIdentity {
    curve25519: string;
    ed25519: string;
}

export interface VodozemacAccountHandle {
    identityKeys(): string;
    generateOneTimeKeys(count: number): void;
    generateFallbackKey(): void;
    saveAccount(pickleKey: Uint8Array): string;
    /** High-level protocol entry points; raw WASM handles remain internal. */
    createOutboundSession?(recipientIdentityKey: string, recipientOneTimeKey: string): import('../core/vodozemacCryptoSession').VodozemacSessionHandle;
    createInboundSession?(senderIdentityKey: string, preKeyMessage: string): VodozemacInboundSessionResult;
    free?(): void;
}

export interface VodozemacInboundSessionResult {
    takeSession(): import('../core/vodozemacCryptoSession').VodozemacSessionHandle;
    plaintext(): Uint8Array;
}

export interface VodozemacAccountFactory {
    createAccount(): VodozemacAccountHandle;
    loadAccount(encryptedPickle: string, pickleKey: Uint8Array): VodozemacAccountHandle;
}

const parsePublicIdentity = (value: string): VodozemacPublicIdentity => {
    if (value.length > 1024) {
        throw new Error('Vodozemac public identity is too large.');
    }
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'curve25519,ed25519' ||
        typeof parsed.curve25519 !== 'string' || typeof parsed.ed25519 !== 'string' ||
        parsed.curve25519.length < 40 || parsed.curve25519.length > 128 ||
        parsed.ed25519.length < 40 || parsed.ed25519.length > 128) {
        throw new Error('Malformed vodozemac public identity.');
    }
    return { curve25519: parsed.curve25519, ed25519: parsed.ed25519 };
};

export const fingerprintVodozemacIdentity = async (identity: VodozemacPublicIdentity): Promise<string> => {
    const canonical = new TextEncoder().encode(
        `k3ncrypt:vodozemac-identity:v1\0${identity.curve25519}\0${identity.ed25519}`,
    );
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', canonical));
    const grouped = toBase64Url(digest).toUpperCase().match(/.{1,4}/g)?.join(' ') ?? '';
    return `K3 ${grouped}`;
};

/** Owns the opaque account handle; React/UI callers receive public information only. */
export class PersistentVodozemacIdentity implements IdentityManager<MessagingIdentity> {
    private account?: VodozemacAccountHandle;
    private publicIdentity?: MessagingIdentity;

    constructor(
        private readonly storage: SecureStorage,
        private readonly factory: VodozemacAccountFactory,
    ) {}

    public async getOrCreate(): Promise<MessagingIdentity> {
        if (this.publicIdentity) {
            return this.publicIdentity;
        }
        const account = await this.storage.withVodozemacPickleKey(async (pickleKey) => {
            const stored = await this.storage.read(ACCOUNT_RECORD_TYPE, LOCAL_ACCOUNT_ID);
            if (stored) {
                return this.factory.loadAccount(new TextDecoder().decode(stored), pickleKey);
            }
            const created = this.factory.createAccount();
            created.generateOneTimeKeys(10);
            created.generateFallbackKey();
            const encryptedPickle = created.saveAccount(pickleKey);
            await this.storage.write(ACCOUNT_RECORD_TYPE, LOCAL_ACCOUNT_ID,
                new TextEncoder().encode(encryptedPickle).buffer as ArrayBuffer);
            return created;
        });
        try {
            const keys = parsePublicIdentity(account.identityKeys());
            const fingerprint = await fingerprintVodozemacIdentity(keys);
            this.account = account;
            this.publicIdentity = {
                identityId: fingerprint,
                publicKey: new TextEncoder().encode(JSON.stringify(keys)),
                algorithm: 'Olm-Curve25519+Ed25519',
            };
            return this.publicIdentity;
        } catch (error) {
            account.free?.();
            throw error;
        }
    }

    /** Crypto-core-only callback; the opaque account is never returned to UI code. */
    public async withAccount<T>(operation: (account: VodozemacAccountHandle) => Promise<T>): Promise<T> {
        await this.getOrCreate();
        return operation(this.account!);
    }

    /** Persists account mutations (for example consumed/generated pre-keys) through both encryption layers. */
    public async persistAccount(): Promise<void> {
        if (!this.account) {
            throw new Error('Messaging identity is locked.');
        }
        await this.storage.withVodozemacPickleKey(async (pickleKey) => {
            const encryptedPickle = this.account!.saveAccount(pickleKey);
            await this.storage.write(ACCOUNT_RECORD_TYPE, LOCAL_ACCOUNT_ID,
                new TextEncoder().encode(encryptedPickle).buffer as ArrayBuffer);
        });
    }

    public lock(): void {
        this.account?.free?.();
        this.account = undefined;
        this.publicIdentity = undefined;
    }
}
