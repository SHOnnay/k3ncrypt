import type { EncryptedEnvelope, TransportManager } from '../core/contracts';

/** Relay submission only. The conversation owner retains encryption, admission and outbox persistence. */
export interface PendingRelayEnvelope {
    envelope: EncryptedEnvelope;
    relayId?: string;
    sentAt?: number;
}

export interface RelayRetryWork<T extends PendingRelayEnvelope> {
    pending: T[];
    recipientRoutingId?: string;
    skip: (item: T) => boolean;
    beforeSubmit: () => Promise<void>;
    persist: (pending: T[]) => Promise<void>;
}

export class RelayDeliveryBoundary {
    constructor(private readonly transport: Pick<TransportManager, 'sendEnvelope'>) {}

    /** Direct submissions keep the transport's existing rejection and result semantics. */
    public submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<{ id?: string; timestamp?: number }> {
        return this.transport.sendEnvelope('message', envelope, recipientRoutingId);
    }

    /** Retry uses the same saved envelope; the owner supplies authorization and persistence. */
    public async retry<T extends PendingRelayEnvelope>(work: RelayRetryWork<T>): Promise<void> {
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
