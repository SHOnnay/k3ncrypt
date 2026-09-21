import { argon2id } from 'hash-wasm';

import type { SecureStorage, SecureRecordUpdate, UnlockSecretType } from '../core/contracts';
import { fromBase64Url, toBase64Url } from '../crypto/base64url';
import type { VaultPersistence } from './persistence';

export const PRODUCTION_ARGON2ID_PARAMETERS = Object.freeze({
    memoryKiB: 19_456,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
});

const STORAGE_VERSION = 1;
const ALGORITHM = 'AES-256-GCM';
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const HKDF_SALT = new TextEncoder().encode('k3ncrypt:storage-key-hierarchy:v1');
const STORAGE_INFO = new TextEncoder().encode('k3ncrypt:storage-record:v1');
const PICKLE_INFO = new TextEncoder().encode('k3ncrypt:vodozemac-pickle:v1');

type KdfMetadata = {
    name: 'Argon2id';
    version: 1;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    hashLength: 32;
    salt: string;
};

type VaultMetadata = {
    storageVersion: 1;
    algorithm: 'AES-256-GCM';
    unlockSecretType: UnlockSecretType;
    kdf: KdfMetadata;
    wrappedMasterKey: { nonce: string; ciphertext: string };
};

type RecordEnvelope = {
    version: 1;
    algorithm: 'AES-256-GCM';
    recordType: string;
    recordId: string;
    nonce: string;
    ciphertext: string;
};

const cryptoApi = (): Crypto => {
    if (!globalThis.crypto?.subtle) {
        throw new Error('WebCrypto is required for secure storage.');
    }
    return globalThis.crypto;
};

const randomBytes = (length: number): Uint8Array => cryptoApi().getRandomValues(new Uint8Array(length));
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean =>
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
const validLabel = (value: unknown): value is string =>
    typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);

const decodeFixed = (value: unknown, expectedLength?: number): Uint8Array => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error('Corrupted secure-storage encoding.');
    }
    const decoded = fromBase64Url(value);
    if (toBase64Url(decoded) !== value || (expectedLength !== undefined && decoded.byteLength !== expectedLength)) {
        throw new Error('Corrupted secure-storage encoding.');
    }
    return decoded;
};

const validateSecret = (secret: string, type: UnlockSecretType): void => {
    if (typeof secret !== 'string') {
        throw new Error('Unlock secret must be a string.');
    }
    if (type === 'pin') {
        if (!/^\d{8,64}$/.test(secret)) {
            throw new Error('A numeric PIN must contain between 8 and 64 digits.');
        }
        return;
    }
    if (secret.length < 12 || secret.length > 1024) {
        throw new Error('A passphrase or password must contain between 12 and 1024 characters.');
    }
};

const parseMetadata = (serialized: string): VaultMetadata => {
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        throw new Error('Corrupted secure-storage metadata.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !exactKeys(value as Record<string, unknown>, ['storageVersion', 'algorithm', 'unlockSecretType', 'kdf', 'wrappedMasterKey'])) {
        throw new Error('Corrupted secure-storage metadata.');
    }
    const metadata = value as VaultMetadata;
    if (metadata.storageVersion !== STORAGE_VERSION || metadata.algorithm !== ALGORITHM) {
        throw new Error('Unsupported secure-storage version or algorithm.');
    }
    if (!['passphrase', 'password', 'pin'].includes(metadata.unlockSecretType)) {
        throw new Error('Corrupted secure-storage metadata.');
    }
    const kdf = metadata.kdf;
    if (!kdf || typeof kdf !== 'object' || !exactKeys(kdf as unknown as Record<string, unknown>,
        ['name', 'version', 'memoryKiB', 'iterations', 'parallelism', 'hashLength', 'salt']) ||
        kdf.name !== 'Argon2id' || kdf.version !== 1 || kdf.hashLength !== 32 ||
        !Number.isInteger(kdf.memoryKiB) || kdf.memoryKiB < PRODUCTION_ARGON2ID_PARAMETERS.memoryKiB || kdf.memoryKiB > 262_144 ||
        !Number.isInteger(kdf.iterations) || kdf.iterations < 2 || kdf.iterations > 10 ||
        !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 4) {
        throw new Error('Unsupported or unsafe secure-storage KDF parameters.');
    }
    decodeFixed(kdf.salt, SALT_BYTES);
    const wrapped = metadata.wrappedMasterKey;
    if (!wrapped || typeof wrapped !== 'object' ||
        !exactKeys(wrapped as unknown as Record<string, unknown>, ['nonce', 'ciphertext'])) {
        throw new Error('Corrupted secure-storage metadata.');
    }
    decodeFixed(wrapped.nonce, NONCE_BYTES);
    const ciphertext = decodeFixed(wrapped.ciphertext);
    if (ciphertext.byteLength !== MASTER_KEY_BYTES + 16) {
        throw new Error('Corrupted secure-storage metadata.');
    }
    return metadata;
};

const wrapAad = (metadata: Omit<VaultMetadata, 'wrappedMasterKey'>): Uint8Array => encode(JSON.stringify(metadata));
const recordAad = (envelope: Omit<RecordEnvelope, 'nonce' | 'ciphertext'>): Uint8Array => encode(JSON.stringify(envelope));
const persistenceKey = (recordType: string, recordId: string): string => `${recordType}:${recordId}`;

const deriveKek = async (secret: string, kdf: KdfMetadata): Promise<CryptoKey> => {
    const material = await argon2id({
        password: encode(secret),
        salt: decodeFixed(kdf.salt, SALT_BYTES),
        memorySize: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
        hashLength: kdf.hashLength,
        outputType: 'binary',
    });
    try {
        return await cryptoApi().subtle.importKey('raw', material as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    } finally {
        material.fill(0);
    }
};

const deriveSubkey = async (masterKey: Uint8Array, info: Uint8Array, usage: 'key' | 'bits'): Promise<CryptoKey | Uint8Array> => {
    const key = await cryptoApi().subtle.importKey('raw', masterKey as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const parameters = { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT as BufferSource, info: info as BufferSource };
    if (usage === 'key') {
        return cryptoApi().subtle.deriveKey(parameters, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    return new Uint8Array(await cryptoApi().subtle.deriveBits(parameters, key, 256));
};

export class BrowserSecureStorage implements SecureStorage {
    private masterKey?: Uint8Array;
    private storageKey?: CryptoKey;

    constructor(private readonly persistence: VaultPersistence) {}

    public isLocked(): boolean {
        return !this.masterKey || !this.storageKey;
    }

    public async initializeWithPassphrase(secret: string, type: UnlockSecretType = 'passphrase'): Promise<void> {
        validateSecret(secret, type);
        if (await this.persistence.loadMetadata()) {
            throw new Error('Secure storage is already initialized.');
        }
        const masterKey = randomBytes(MASTER_KEY_BYTES);
        const kdf: KdfMetadata = {
            name: 'Argon2id',
            version: 1,
            ...PRODUCTION_ARGON2ID_PARAMETERS,
            salt: toBase64Url(randomBytes(SALT_BYTES)),
        };
        try {
            const metadata = await this.wrapMasterKey(masterKey, secret, type, kdf);
            await this.persistence.saveMetadata(JSON.stringify(metadata));
            await this.activate(masterKey);
        } catch (error) {
            masterKey.fill(0);
            throw error;
        }
    }

    public async unlock(secret: string): Promise<void> {
        const serialized = await this.persistence.loadMetadata();
        if (!serialized) {
            throw new Error('Secure storage is not initialized.');
        }
        const metadata = parseMetadata(serialized);
        validateSecret(secret, metadata.unlockSecretType);
        const masterKey = await this.unwrapMasterKey(metadata, secret);
        await this.activate(masterKey);
    }

    public lock(): void {
        this.masterKey?.fill(0);
        this.masterKey = undefined;
        this.storageKey = undefined;
    }

    public async changeUnlockSecret(currentSecret: string, nextSecret: string, nextType: UnlockSecretType): Promise<void> {
        validateSecret(nextSecret, nextType);
        const serialized = await this.persistence.loadMetadata();
        if (!serialized) {
            throw new Error('Secure storage is not initialized.');
        }
        const currentMetadata = parseMetadata(serialized);
        validateSecret(currentSecret, currentMetadata.unlockSecretType);
        const masterKey = await this.unwrapMasterKey(currentMetadata, currentSecret);
        try {
            const nextKdf: KdfMetadata = {
                name: 'Argon2id',
                version: 1,
                ...PRODUCTION_ARGON2ID_PARAMETERS,
                salt: toBase64Url(randomBytes(SALT_BYTES)),
            };
            const metadata = await this.wrapMasterKey(masterKey, nextSecret, nextType, nextKdf);
            await this.persistence.saveMetadata(JSON.stringify(metadata));
            await this.activate(masterKey);
        } catch (error) {
            masterKey.fill(0);
            throw error;
        }
    }

    public async read(recordType: string, recordId: string): Promise<ArrayBuffer | undefined> {
        const key = this.requireStorageKey();
        this.validateRecordAddress(recordType, recordId);
        const serialized = await this.persistence.readRecord(persistenceKey(recordType, recordId));
        if (serialized === undefined) {
            return undefined;
        }
        const envelope = this.parseRecord(serialized, recordType, recordId);
        try {
            return await cryptoApi().subtle.decrypt({
                name: 'AES-GCM',
                iv: decodeFixed(envelope.nonce, NONCE_BYTES) as BufferSource,
                additionalData: recordAad({ version: envelope.version, algorithm: envelope.algorithm, recordType, recordId }) as BufferSource,
                tagLength: 128,
            }, key, decodeFixed(envelope.ciphertext) as BufferSource);
        } catch {
            throw new Error('Secure record authentication failed.');
        }
    }

    public async write(recordType: string, recordId: string, plaintext: ArrayBuffer): Promise<void> {
        await this.persistence.writeRecord(persistenceKey(recordType, recordId), await this.encryptRecord(recordType, recordId, plaintext));
    }

    public async compareAndSwapRecords(updates: readonly SecureRecordUpdate[]): Promise<boolean> {
        if (!this.persistence.compareAndSwapRecords) throw new Error('Atomic secure storage is unavailable.');
        const prepared = [];
        for (const item of updates) {
            this.validateRecordAddress(item.recordType, item.recordId);
            const key = persistenceKey(item.recordType, item.recordId);
            const before = await this.persistence.readRecord(key);
            const plaintext = await this.read(item.recordType, item.recordId);
            if ((plaintext === undefined) !== (item.expected === undefined) || (plaintext && item.expected && (plaintext.byteLength !== item.expected.byteLength || !new Uint8Array(plaintext).every((byte, index) => byte === new Uint8Array(item.expected!)[index])))) return false;
            // A concurrent change between the two reads is a conflict, even if it decrypts to equal bytes.
            if (await this.persistence.readRecord(key) !== before) return false;
            prepared.push({ key, expected: before, next: await this.encryptRecord(item.recordType, item.recordId, item.next) });
        }
        this.requireStorageKey();
        return this.persistence.compareAndSwapRecords(prepared);
    }

    private async encryptRecord(recordType: string, recordId: string, plaintext: ArrayBuffer): Promise<string> {
        const key = this.requireStorageKey();
        this.validateRecordAddress(recordType, recordId);
        if (!(plaintext instanceof ArrayBuffer) || plaintext.byteLength > 4 * 1024 * 1024) {
            throw new Error('Secure records must be ArrayBuffers no larger than 4 MiB.');
        }
        const header = { version: STORAGE_VERSION, algorithm: ALGORITHM, recordType, recordId } as const;
        const nonce = randomBytes(NONCE_BYTES);
        const ciphertext = await cryptoApi().subtle.encrypt({
            name: 'AES-GCM',
            iv: nonce as BufferSource,
            additionalData: recordAad(header) as BufferSource,
            tagLength: 128,
        }, key, plaintext);
        const envelope: RecordEnvelope = {
            ...header,
            nonce: toBase64Url(nonce),
            ciphertext: toBase64Url(new Uint8Array(ciphertext)),
        };
        return JSON.stringify(envelope);
    }

    public async delete(recordType: string, recordId: string): Promise<void> {
        this.requireStorageKey();
        this.validateRecordAddress(recordType, recordId);
        await this.persistence.deleteRecord(persistenceKey(recordType, recordId));
    }

    /** Supplies a short-lived, domain-separated vodozemac pickle key and wipes the JS copy afterward. */
    public async withVodozemacPickleKey<T>(operation: (key: Uint8Array) => Promise<T>): Promise<T> {
        const masterKey = this.requireMasterKey();
        const pickleKey = await deriveSubkey(masterKey, PICKLE_INFO, 'bits') as Uint8Array;
        try {
            return await operation(pickleKey);
        } finally {
            pickleKey.fill(0);
        }
    }

    private async activate(masterKey: Uint8Array): Promise<void> {
        const storageKey = await deriveSubkey(masterKey, STORAGE_INFO, 'key') as CryptoKey;
        this.lock();
        this.masterKey = masterKey;
        this.storageKey = storageKey;
    }

    private async wrapMasterKey(masterKey: Uint8Array, secret: string, type: UnlockSecretType, kdf: KdfMetadata): Promise<VaultMetadata> {
        const header = { storageVersion: STORAGE_VERSION, algorithm: ALGORITHM, unlockSecretType: type, kdf } as const;
        const nonce = randomBytes(NONCE_BYTES);
        const kek = await deriveKek(secret, kdf);
        const ciphertext = await cryptoApi().subtle.encrypt({
            name: 'AES-GCM',
            iv: nonce as BufferSource,
            additionalData: wrapAad(header) as BufferSource,
            tagLength: 128,
        }, kek, masterKey as BufferSource);
        return {
            ...header,
            wrappedMasterKey: { nonce: toBase64Url(nonce), ciphertext: toBase64Url(new Uint8Array(ciphertext)) },
        };
    }

    private async unwrapMasterKey(metadata: VaultMetadata, secret: string): Promise<Uint8Array> {
        const kek = await deriveKek(secret, metadata.kdf);
        const header = {
            storageVersion: metadata.storageVersion,
            algorithm: metadata.algorithm,
            unlockSecretType: metadata.unlockSecretType,
            kdf: metadata.kdf,
        };
        try {
            const plaintext = await cryptoApi().subtle.decrypt({
                name: 'AES-GCM',
                iv: decodeFixed(metadata.wrappedMasterKey.nonce, NONCE_BYTES) as BufferSource,
                additionalData: wrapAad(header) as BufferSource,
                tagLength: 128,
            }, kek, decodeFixed(metadata.wrappedMasterKey.ciphertext) as BufferSource);
            const masterKey = new Uint8Array(plaintext);
            if (masterKey.byteLength !== MASTER_KEY_BYTES) {
                masterKey.fill(0);
                throw new Error('Invalid master key length.');
            }
            return masterKey;
        } catch {
            throw new Error('Invalid unlock secret or corrupted secure-storage metadata.');
        }
    }

    private parseRecord(serialized: string, expectedType: string, expectedId: string): RecordEnvelope {
        let value: unknown;
        try {
            value = JSON.parse(serialized);
        } catch {
            throw new Error('Corrupted secure-record envelope.');
        }
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            !exactKeys(value as Record<string, unknown>, ['version', 'algorithm', 'recordType', 'recordId', 'nonce', 'ciphertext'])) {
            throw new Error('Corrupted secure-record envelope.');
        }
        const envelope = value as RecordEnvelope;
        if (envelope.version !== STORAGE_VERSION || envelope.algorithm !== ALGORITHM) {
            throw new Error('Unsupported secure-record version or algorithm.');
        }
        if (envelope.recordType !== expectedType || envelope.recordId !== expectedId) {
            throw new Error('Secure-record metadata mismatch.');
        }
        decodeFixed(envelope.nonce, NONCE_BYTES);
        if (decodeFixed(envelope.ciphertext).byteLength < 16) {
            throw new Error('Corrupted secure-record envelope.');
        }
        return envelope;
    }

    private validateRecordAddress(recordType: string, recordId: string): void {
        if (!validLabel(recordType) || !validLabel(recordId)) {
            throw new Error('Invalid secure-record type or identifier.');
        }
    }

    private requireStorageKey(): CryptoKey {
        if (!this.storageKey) {
            throw new Error('Secure storage is locked.');
        }
        return this.storageKey;
    }

    private requireMasterKey(): Uint8Array {
        if (!this.masterKey) {
            throw new Error('Secure storage is locked.');
        }
        return this.masterKey;
    }
}
