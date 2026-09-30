import type { EncryptedEnvelope } from '../core/contracts';
import type { DeliveryPathAdapter, DeliverySubmissionResult } from './contracts';

/** Existing durable outbox item owned and persisted by the conversation owner. */
export interface PendingDeliveryEnvelope {
    envelope: EncryptedEnvelope;
    relayId?: string;
    sentAt?: number;
}

export interface DeliveryRetryWork<T extends PendingDeliveryEnvelope> {
    pending: T[];
    recipientRoutingId?: string;
    skip: (item: T) => boolean;
    beforeSubmit: () => Promise<void>;
    persist: (pending: T[]) => Promise<void>;
}

/**
 * Owns message-path selection while leaving encryption, trust checks, outbox
 * persistence and ACK handling with the conversation owner. Phase 2A selects
 * only the relay even when other path adapters are supplied.
 */
export class DeliveryCoordinator {
    private readonly relay: DeliveryPathAdapter;

    constructor(adapters: readonly DeliveryPathAdapter[]) {
        const relay = adapters.find(({ capabilities }) => capabilities.path === 'relay' &&
            capabilities.encryptedEnvelopes && capabilities.messageDelivery);
        if (!relay) throw new Error('An encrypted relay message path is required.');
        this.relay = relay;
    }

    /** Submit through the current relay path and preserve its exact result/errors. */
    public submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<DeliverySubmissionResult> {
        return this.relay.submit(envelope, recipientRoutingId);
    }

    /** Retry the same persisted ciphertext using the existing relay retry rules. */
    public async retry<T extends PendingDeliveryEnvelope>(work: DeliveryRetryWork<T>): Promise<void> {
        for (const item of work.pending) {
            if (work.skip(item)) continue;
            if (item.relayId && item.sentAt && Date.now() - item.sentAt < 5000) continue;
            try {
                await work.beforeSubmit();
                const sent = await this.submit(item.envelope, work.recipientRoutingId);
                item.relayId = sent.id;
                item.sentAt = Date.now();
                await work.persist(work.pending);
            } catch {
                // Existing pending record remains for the next timer/reconnect retry.
                return;
            }
        }
    }
}
