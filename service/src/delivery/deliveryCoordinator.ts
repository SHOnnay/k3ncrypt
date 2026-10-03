import type { EncryptedEnvelope } from '../core/contracts';
import type { DeliveryPathAdapter, DeliveryRetryWork, DeliverySubmissionResult, PendingDeliveryEnvelope } from './contracts';

/**
 * Production message-delivery coordinator. It intentionally submits through
 * the relay only; optional adapters are not accepted by this constructor.
 * Crypto, outbox ownership, inbound acceptance, and delivery state stay with
 * ModernConversation.
 */
export class DeliveryCoordinator {
    constructor(private readonly relay: DeliveryPathAdapter, private readonly now: () => number = () => Date.now()) {
        if (relay.capabilities.path !== 'relay' || !relay.capabilities.encryptedEnvelopes || !relay.capabilities.messageDelivery) {
            throw new Error('An encrypted relay message path is required.');
        }
    }

    /** Submits the exact already-encrypted envelope and preserves relay result/errors. */
    public submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<DeliverySubmissionResult> {
        return this.relay.submit(envelope, recipientRoutingId);
    }

    /**
     * Preserves the existing five-second retry throttle and pending-outbox
     * behavior. No alternate path or fallback is attempted here.
     */
    public async retry<T extends PendingDeliveryEnvelope>(work: DeliveryRetryWork<T>): Promise<void> {
        for (const item of work.pending) {
            if (work.skip(item)) continue;
            if (item.relayId && item.sentAt && this.now() - item.sentAt < 5000) continue;
            try {
                await work.beforeSubmit();
                const sent = await this.submit(item.envelope, work.recipientRoutingId);
                item.relayId = sent.id;
                item.sentAt = this.now();
                await work.persist(work.pending);
            } catch {
                // Keep the current item and later items pending for the next
                // timer/reconnect attempt, matching the existing relay path.
                return;
            }
        }
    }
}
