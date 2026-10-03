import type {
    CryptoChannel,
    EncryptedEnvelope,
    TransportCapabilities,
    TransportConnectionState,
} from '../core/contracts';

/** Already encrypted local work. envelopeId is local metadata and is never sent by a path adapter. */
export interface EncryptedDeliveryWork {
    readonly conversationId: string;
    readonly envelopeId: string;
    readonly channel: CryptoChannel;
    readonly envelope: EncryptedEnvelope;
    readonly recipientRoutingId?: string;
    readonly proofOperation?: string;
}

/** ConversationOwner remains the only authority that creates/decrypts envelopes and decides acceptance. */
export interface ConversationOwner {
    send(plaintext: string): Promise<EncryptedDeliveryWork>;
    acceptInbound(envelope: EncryptedEnvelope, senderRoutingId?: string): Promise<'accepted' | 'duplicate' | 'rejected'>;
}

/** Additive local queue boundary. Relay IDs/ACK semantics stay owned by the existing caller. */
export interface DeliveryStore {
    readPending(conversationId: string): Promise<readonly EncryptedDeliveryWork[]>;
    writePending(work: EncryptedDeliveryWork): Promise<void>;
    removePending(conversationId: string, envelopeId: string): Promise<void>;
}

/** Opaque already-encrypted envelope operation supported by any later path adapter. */
export interface PathSubmission {
    readonly conversationId: string;
    readonly envelopeId: string;
    readonly channel: CryptoChannel;
    readonly envelope: EncryptedEnvelope;
    readonly recipientRoutingId?: string;
    readonly proofOperation?: string;
}

export interface PathAdapter {
    readonly pathId: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    connectionState(): TransportConnectionState;
    capabilities(): TransportCapabilities;
    submit(work: PathSubmission): Promise<{ id?: string; timestamp?: number }>;
}

/** Relay-only control plane that remains separate from generic path submission. */
export interface RelayMailboxCapability {
    join(conversationId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void>;
    requestMailboxReplay(): Promise<void>;
}

/** Pure policy contract. It cannot establish peer trust or mutate conversation state. */
export interface ConnectivityPolicy {
    select(work: EncryptedDeliveryWork, candidates: readonly PathAdapter[]): readonly PathAdapter[];
}

/** Coordinator schedules only persisted encrypted work; it never accepts plaintext or changes trust. */
export interface DeliveryCoordinator {
    submit(work: EncryptedDeliveryWork): Promise<{ id?: string; timestamp?: number }>;
    retry(conversationId: string): Promise<void>;
}
