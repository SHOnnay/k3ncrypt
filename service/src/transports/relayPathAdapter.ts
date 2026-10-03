import type { CryptoChannel, EncryptedEnvelope, Transport, TransportCapabilities, TransportConnectionState } from '../core/contracts';
import type { PathAdapter, PathSubmission, RelayMailboxCapability } from '../delivery/contracts';

/** Narrow structural view of the existing Socket.IO transport, including relay mailbox controls. */
export type RelayTransportPort = Pick<Transport, 'start' | 'stop' | 'join' | 'sendEnvelope' | 'connectionState' | 'capabilities'> & Partial<RelayMailboxCapability>;

/** Relay wrapper only: forwards the exact current transport arguments and return/error behavior. */
export class RelayPathAdapter implements PathAdapter, RelayMailboxCapability {
    public readonly pathId = 'relay';

    constructor(private readonly relay: RelayTransportPort) {}

    public start(): Promise<void> { return this.relay.start(); }
    public stop(): Promise<void> { return this.relay.stop(); }
    public connectionState(): TransportConnectionState { return this.relay.connectionState(); }
    public capabilities(): TransportCapabilities { return this.relay.capabilities(); }

    public join(conversationId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void> {
        return routingProof === undefined
            ? this.relay.join(conversationId, peerRoutingId, controlCapability)
            : this.relay.join(conversationId, peerRoutingId, controlCapability, routingProof);
    }

    public submit(work: PathSubmission): Promise<{ id?: string; timestamp?: number }> {
        return work.recipientRoutingId === undefined
            ? this.relay.sendEnvelope(work.channel, work.envelope, undefined, work.proofOperation)
            : this.relay.sendEnvelope(work.channel, work.envelope, work.recipientRoutingId, work.proofOperation);
    }

    public requestMailboxReplay(): Promise<void> {
        return this.relay.requestMailboxReplay
            ? this.relay.requestMailboxReplay()
            : Promise.reject(new Error('Relay mailbox replay is unavailable.'));
    }
}
