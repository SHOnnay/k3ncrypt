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

    public join(conversationId: string, peerRoutingId: string): void {
        this.transport.join(conversationId, peerRoutingId);
    }

    public sendEnvelope(
        channel: CryptoChannel,
        envelope: EncryptedEnvelope,
    ): Promise<{ id?: string; timestamp?: number }> {
        return this.transport.sendEnvelope(channel, envelope);
    }

    public activeTransport(): Transport {
        return this.transport;
    }
}
