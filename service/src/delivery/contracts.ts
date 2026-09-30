import type { EncryptedEnvelope } from '../core/contracts';

export type DeliveryPathKind = 'relay' | 'lan' | 'direct';

/**
 * Describes encrypted-message transport support only. These capabilities do
 * not represent authorization, receiver acceptance, or peer persistence.
 */
export interface DeliveryTransportCapabilities {
    readonly path: DeliveryPathKind;
    readonly encryptedEnvelopes: boolean;
    readonly messageDelivery: boolean;
    readonly offlineMailbox: boolean;
}

export interface DeliverySubmissionResult {
    /** Existing relay correlation ID; it is not a stable envelope identity. */
    readonly id?: string;
    readonly timestamp?: number;
}

/** A path adapter receives opaque encrypted envelopes, never plaintext or keys. */
export interface DeliveryPathAdapter {
    readonly capabilities: DeliveryTransportCapabilities;
    submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<DeliverySubmissionResult>;
}
