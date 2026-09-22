import io, { type Socket } from 'socket.io-client';
import type { EncryptedEnvelope } from '../core/contracts';

export interface SyncEnvelopeRelay { send(envelope: EncryptedEnvelope): Promise<void>; }
export const MAX_SYNC_ENVELOPE_BYTES = 192 * 1024;
export const assertSyncEnvelopeSize = (envelope: EncryptedEnvelope): void => {
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_SYNC_ENVELOPE_BYTES) throw new Error('Sync envelope is too large.');
};

/** Opaque transport only. Its receiver MUST await authenticated validation and durable acceptance. */
export class SocketSyncRelay implements SyncEnvelopeRelay {
    private readonly socket: Socket;
    private ready = false;
    public constructor(baseUrl: string, room: string, routingId: string, capability: string, private readonly peerRoutingId: string,
        receive: (envelope: EncryptedEnvelope) => Promise<void>) {
        this.socket = io(baseUrl, { path: '/sync/socket.io', autoConnect: false, reconnection: false,
            auth: { room, routingId, capability } });
        this.socket.on('sync-ready', () => { this.ready = true; });
        this.socket.on('disconnect', () => { this.ready = false; });
        this.socket.on('sync-envelope', async (message: { senderRoutingId?: string; envelope: EncryptedEnvelope }, ack: (value: unknown) => void) => {
            try {
                if (message?.senderRoutingId !== this.peerRoutingId || typeof ack !== 'function') throw new Error('unavailable');
                assertSyncEnvelopeSize(message.envelope);
                await receive(message.envelope);
                ack({ status: 'accepted' });
            } catch { if (typeof ack === 'function') ack({ error: 'Synchronization unavailable.' }); }
        });
        this.socket.connect();
    }
    public async send(envelope: EncryptedEnvelope): Promise<void> {
        if (!this.socket.connected || !this.ready) throw new Error('Synchronization unavailable.');
        assertSyncEnvelopeSize(envelope);
        const response = await this.socket.timeout(12_000).emitWithAck('sync-envelope', { recipientRoutingId: this.peerRoutingId, envelope });
        if (response?.status !== 'accepted') throw new Error('Synchronization unavailable.');
    }
    public close(): void { this.socket.disconnect(); }
}
