import type { EncryptedEnvelope } from '../core/contracts';

export type DeliveryPathKind = 'relay' | 'lan' | 'direct';

/** Capability declarations describe transport mechanics, never authorization or trust. */
export interface DeliveryPathCapabilities {
    readonly path: DeliveryPathKind;
    readonly encryptedEnvelopes: boolean;
    readonly messageDelivery: boolean;
    readonly offlineMailbox: boolean;
}

/** An adapter receives an already encrypted application envelope and no crypto/session state. */
export interface DeliveryPathAdapter {
    readonly capabilities: DeliveryPathCapabilities;
    submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<DeliverySubmissionResult>;
}

/** Relay IDs remain attempt/mailbox correlation values, not stable envelope IDs or peer receipts. */
export interface DeliverySubmissionResult {
    readonly id?: string;
    readonly timestamp?: number;
}

export interface PendingDeliveryEnvelope {
    readonly envelope: EncryptedEnvelope;
    relayId?: string;
    sentAt?: number;
}

export interface DeliveryRetryWork<T extends PendingDeliveryEnvelope> {
    readonly pending: T[];
    readonly recipientRoutingId?: string;
    readonly skip: (item: T) => boolean;
    readonly beforeSubmit: () => Promise<void>;
    readonly persist: (pending: T[]) => Promise<void>;
}
