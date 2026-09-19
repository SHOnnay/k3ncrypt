import type {
    CryptoChannel,
    EncryptedEnvelope,
    Transport,
    TransportManager,
} from '../core/contracts';

/**
 * Owns transport lifecycle and routing without owning conversation crypto.
 * Switching transports later must not recreate or reset a CryptoSession.
 */
export class DefaultTransportManager implements TransportManager {
    constructor(private readonly transport: Transport) {}

    public start(): Promise<void> {
        return this.transport.start();
    }

    public stop(): Promise<void> {
        return this.transport.stop();
    }

    public join(conversationId: string, peerRoutingId: string, controlCapability: string): void {
        this.transport.join(conversationId, peerRoutingId, controlCapability);
    }

    public sendEnvelope(
        channel: CryptoChannel,
        envelope: EncryptedEnvelope,
        recipientRoutingId?: string,
    ): Promise<{ id?: string; timestamp?: number }> {
        return recipientRoutingId === undefined
            ? this.transport.sendEnvelope(channel, envelope)
            : this.transport.sendEnvelope(channel, envelope, recipientRoutingId);
    }

    public activeTransport(): Transport {
        return this.transport;
    }
}
