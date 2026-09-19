import socketIOClient, { Socket } from 'socket.io-client';
import { configContext } from '../configContext';
import type {
    CryptoChannel,
    EncryptedEnvelope,
    Transport,
    TransportCapabilities,
    TransportConnectionState,
    TransportEnvelopeHandler,
} from '../core/contracts';
import type { chatJoinPayloadType } from '../public/types';
import { Logger } from '../utils/logger';

export type SocketListenerType = 'limit-reached' | 'delivered' | 'on-alice-join' | 'on-alice-disconnect' | 'chat-message';
export type SubscriptionType = Map<string, Set<Function>>;

export type RawChatMessage = {
    id: string;
    timestamp: number;
    sender: string;
    envelope: EncryptedEnvelope;
};
export type RawSignalMessage = { envelope: EncryptedEnvelope };

const WIRE_EVENTS = {
    LIMIT_REACHED: 'limit-reached',
    DELIVERED: 'delivered',
    ON_ALICE_JOIN: 'on-alice-join',
    ON_ALICE_DISCONNECT: 'on-alice-disconnect',
    CHAT_MESSAGE: 'chat-message',
    WEBRTC_SIGNAL: 'webrtc-session-description',
} as const;

type AckError = { error: string };

/** Socket.IO implementation of the opaque relay transport boundary. */
export class SocketIoRelayTransport implements Transport {
    private readonly socket: Socket;
    private readonly eventHandlerLogger: Logger;

    constructor(
        private readonly subscriptionContext: () => SubscriptionType,
        private readonly logger: Logger,
        private readonly onEnvelope: TransportEnvelopeHandler,
    ) {
        this.eventHandlerLogger = this.logger.createChild('eventHandler');
        this.socket = socketIOClient(`${configContext().baseUrl}/`);
        this.socket.on(WIRE_EVENTS.LIMIT_REACHED, (...args) => this.handleEvent('limit-reached', args));
        this.socket.on(WIRE_EVENTS.DELIVERED, (...args) => this.handleEvent('delivered', args));
        this.socket.on(WIRE_EVENTS.ON_ALICE_JOIN, (...args) => this.handleEvent('on-alice-join', args));
        this.socket.on(WIRE_EVENTS.ON_ALICE_DISCONNECT, (...args) => this.handleEvent('on-alice-disconnect', args));
        this.socket.on(WIRE_EVENTS.CHAT_MESSAGE, (message: RawChatMessage) => {
            void this.acceptChatEnvelope(message);
        });
        this.socket.on(WIRE_EVENTS.WEBRTC_SIGNAL, (message: RawSignalMessage) => {
            void this.onEnvelope({ channel: 'signaling', envelope: message.envelope }).catch(() => undefined);
        });
    }

    public async start(): Promise<void> {
        // socket.io-client starts connecting when constructed.
    }

    public async stop(): Promise<void> {
        this.socket.disconnect();
    }

    public join(conversationId: string, peerRoutingId: string, controlCapability: string): void {
        const payload: chatJoinPayloadType = { channelID: conversationId, userID: peerRoutingId, controlCapability };
        this.socket.emit('chat-join', payload);
    }

    public async sendEnvelope(
        channel: CryptoChannel,
        envelope: EncryptedEnvelope,
        recipientRoutingId?: string,
    ): Promise<{ id?: string; timestamp?: number }> {
        if (channel === 'message') {
            return await this.emitWithAck<{ id: string; timestamp: number }>('chat-message', { envelope, ...(recipientRoutingId ? { recipientRoutingId } : {}) });
        }
        await this.emitWithAck<{ status: string }>('webrtc-signal', { envelope });
        return {};
    }

    public connectionState(): TransportConnectionState {
        if (this.socket.connected) {
            return 'connected';
        }
        return this.socket.disconnected ? 'stopped' : 'connecting';
    }

    public capabilities(): TransportCapabilities {
        return { envelopes: true, blobs: false, localOnly: false };
    }

    private async acceptChatEnvelope(message: RawChatMessage): Promise<void> {
        try {
            const accepted = await this.onEnvelope({
                channel: 'message',
                envelope: message.envelope,
                messageId: message.id,
                senderRoutingId: message.sender,
                timestamp: message.timestamp,
            });
            if (accepted) {
                this.socket.emit('received', { id: message.id });
            }
        } catch {
            // Rejected/invalid envelopes are intentionally not acknowledged.
        }
    }

    private emitWithAck<T>(event: string, payload: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            this.socket.emit(event, payload, (response: (T & Partial<AckError>) | AckError) => {
                if (response && typeof response === 'object' && 'error' in response && response.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(response as T);
            });
        });
    }

    private handleEvent(listener: SocketListenerType, args: unknown[]): void {
        this.eventHandlerLogger.withInvocationId().log(`event: ${listener}`);
        this.subscriptionContext().get(listener)?.forEach((callback) => callback(...args));
    }
}
