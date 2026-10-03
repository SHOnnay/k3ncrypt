import type { EncryptedEnvelope, TransportManager } from '../core/contracts';
import type { DeliveryPathAdapter, DeliverySubmissionResult } from '../delivery/contracts';

/** Relay adapter for the delivery boundary; it preserves the existing relay operation and ACK. */
export class RelayPathAdapter implements DeliveryPathAdapter {
    public readonly capabilities = {
        path: 'relay',
        encryptedEnvelopes: true,
        messageDelivery: true,
        offlineMailbox: true,
    } as const;

    constructor(private readonly transport: Pick<TransportManager, 'sendEnvelope'>) {}

    public submit(envelope: EncryptedEnvelope, recipientRoutingId?: string): Promise<DeliverySubmissionResult> {
        return this.transport.sendEnvelope('message', envelope, recipientRoutingId);
    }
}
