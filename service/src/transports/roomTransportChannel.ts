import type { CryptoChannel, EncryptedEnvelope, RoomTransport, Transport, TransportManager, TransportSendResult } from '../core/contracts';

/** Immutable room-scoped facade over the current relay manager. */
export class RoomTransportChannel implements RoomTransport {
    private closed = false;

    constructor(readonly roomId: string, private readonly manager: TransportManager) {
        if (!roomId) throw new Error('Room transport requires a room ID.');
    }

    public start(): Promise<void> {
        if (this.closed) throw new Error('Room transport is closed.');
        return this.manager.start();
    }

    public async connect(peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void> {
        if (this.closed) throw new Error('Room transport is closed.');
        await this.manager.start();
        await this.manager.join(this.roomId, peerRoutingId, controlCapability, routingProof);
    }

    /** Compatibility guard for code that still speaks the unbound manager API. */
    public join(roomId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void> {
        if (roomId !== this.roomId) throw new Error('Room transport cannot join a different room.');
        if (this.closed) throw new Error('Room transport is closed.');
        return this.manager.join(this.roomId, peerRoutingId, controlCapability, routingProof);
    }

    public async stop(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        await this.manager.stop();
    }

    public close(): Promise<void> { return this.stop(); }

    public sendEnvelope(channel: CryptoChannel, envelope: EncryptedEnvelope, recipientRoutingId?: string, proofOperation?: string): Promise<TransportSendResult> {
        if (this.closed) throw new Error('Room transport is closed.');
        return this.manager.sendEnvelope(channel, envelope, recipientRoutingId, proofOperation);
    }

    public activeTransport(): Transport | undefined { return this.manager.activeTransport(); }
}
