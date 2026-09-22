/** Versioned, transport-independent wire container. Payload details belong to the selected crypto implementation. */
export interface EncryptedEnvelope {
    readonly version: number;
    readonly strategy: string;
    readonly data: unknown;
}

/** Logical encrypted channels. They are independent of any network transport. */
export type CryptoChannel = 'message' | 'signaling';

export interface InboundTransportEnvelope {
    readonly channel: CryptoChannel;
    readonly envelope: EncryptedEnvelope;
    readonly messageId?: string;
    readonly senderRoutingId?: string;
    readonly timestamp?: number;
}

export type TransportEnvelopeHandler = (message: InboundTransportEnvelope) => Promise<boolean>;

/**
 * Owns one conversation's cryptographic state and lifecycle.
 *
 * The current implementation is a legacy invite-secret adapter. Future
 * ratcheted implementations must be supplied by a reviewed library and can
 * satisfy this contract without exposing their private state to transports.
 */
export interface CryptoSession {
    readonly encrypted: boolean;
    readonly ready: boolean;
    initialize(secret: string): Promise<void>;
    encrypt(channel: CryptoChannel, plaintext: ArrayBuffer): Promise<EncryptedEnvelope>;
    decrypt(channel: CryptoChannel, envelope: EncryptedEnvelope): Promise<ArrayBuffer>;
    destroy(): void;
}

/** Current IDs are routing-scoped only; they are not cryptographic identities. */
export interface LegacyRoutingIdentity {
    readonly kind: 'legacy-ephemeral-routing';
    readonly routingId: string;
}

/** Port for the future local cryptographic identity implementation. */
/** A device-local identity is distinct from room, socket, and transport peer IDs. */
export interface MessagingIdentity {
    readonly identityId: string;
    readonly publicKey: Uint8Array;
    readonly algorithm: string;
}

/** Local record that will own one messaging identity without becoming a server account. */
export interface AppLocalIdentity {
    readonly localId: string;
    readonly messagingIdentity: MessagingIdentity;
    readonly createdAt: number;
}

/** A verified or unverified public identity belonging to another person/device. */
export interface ContactIdentity extends MessagingIdentity {
    readonly displayName?: string;
    readonly verification: 'unknown' | 'unverified' | 'verified';
}

/** Ephemeral address used by a transport. It is never an identity key. */
export interface TransportPeer {
    readonly transport: string;
    readonly routingId: string;
}

export interface IdentityManager<TIdentity = MessagingIdentity> {
    getOrCreate(): Promise<TIdentity>;
    lock(): void;
}

export type TransportConnectionState = 'stopped' | 'connecting' | 'connected' | 'degraded';

export interface TransportCapabilities {
    readonly envelopes: boolean;
    readonly blobs: boolean;
    readonly localOnly: boolean;
}

/** A transport handles opaque envelopes and never receives plaintext or keys. */
export interface Transport {
    start(): Promise<void>;
    stop(): Promise<void>;
    join(conversationId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void>;
    sendEnvelope(channel: CryptoChannel, envelope: EncryptedEnvelope, recipientRoutingId?: string, proofOperation?: string): Promise<{ id?: string; timestamp?: number }>;
    sendBlob?(ciphertext: ArrayBuffer): Promise<void>;
    connectionState(): TransportConnectionState;
    capabilities(): TransportCapabilities;
}

/** Chooses among transports without creating or resetting cryptographic state. */
export interface TransportManager {
    start(): Promise<void>;
    stop(): Promise<void>;
    join(conversationId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void>;
    sendEnvelope(channel: CryptoChannel, envelope: EncryptedEnvelope, recipientRoutingId?: string, proofOperation?: string): Promise<{ id?: string; timestamp?: number }>;
    activeTransport(): Transport | undefined;
}

/**
 * Storage port for encrypted-at-rest records. Implementations must not accept
 * plaintext secret records unless their encryption boundary is explicit.
 */
export type UnlockSecretType = 'passphrase' | 'password' | 'pin';
export interface SecureRecordUpdate { recordType: string; recordId: string; expected: ArrayBuffer | undefined; next: ArrayBuffer; }

export interface SecureStorage {
    compareAndSwapRecords?(updates: readonly SecureRecordUpdate[]): Promise<boolean>;
    initializeWithPassphrase(secret: string, type?: UnlockSecretType): Promise<void>;
    unlock(secret: string): Promise<void>;
    lock(): void;
    changeUnlockSecret(currentSecret: string, nextSecret: string, nextType: UnlockSecretType): Promise<void>;
    isLocked(): boolean;
    read(recordType: string, recordId: string): Promise<ArrayBuffer | undefined>;
    write(recordType: string, recordId: string, plaintext: ArrayBuffer): Promise<void>;
    delete(recordType: string, recordId: string): Promise<void>;
    withVodozemacPickleKey<T>(operation: (key: Uint8Array) => Promise<T>): Promise<T>;
}

/** Non-secret preferences have a separate port so they cannot be mistaken for encrypted records. */
export interface PublicPreferences {
    read(key: string): Promise<string | undefined>;
    write(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}

/** Stores only locally encrypted attachment bytes and opaque metadata. */
export interface AttachmentStore {
    readCiphertext(id: string): Promise<ArrayBuffer | undefined>;
    writeCiphertext(id: string, value: ArrayBuffer): Promise<void>;
    delete(id: string): Promise<void>;
}
