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
import type { DeviceProofCarrier, DeviceResourceContext } from '../devices/trustProtocol';
import type { DeviceProofOperation } from '../devices/deviceProofClient';
import { Logger } from '../utils/logger';
import { testDiagnosticsEnabled } from '../utils/testDiagnostics';

export type SocketListenerType = 'limit-reached' | 'delivered' | 'on-alice-join' | 'on-alice-disconnect' | 'chat-message';
export type SubscriptionType = Map<string, Set<Function>>;

export type RawChatMessage = {
    id: string;
    timestamp: number;
    sender: string;
    envelope: EncryptedEnvelope;
};
export type RawSignalMessage = { envelope: EncryptedEnvelope };

export const JOIN_INTRODUCTION_FEATURE = 'join-introduction-v1';
const SUPPORTED_PROTOCOL_FEATURES = [JOIN_INTRODUCTION_FEATURE] as const;

const WIRE_EVENTS = {
    LIMIT_REACHED: 'limit-reached',
    DELIVERED: 'delivered',
    ON_ALICE_JOIN: 'on-alice-join',
    ON_ALICE_DISCONNECT: 'on-alice-disconnect',
    CHAT_MESSAGE: 'chat-message',
    WEBRTC_SIGNAL: 'webrtc-session-description',
} as const;

type AckError = { error: string };
export type DeviceProofProvider = { acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> };

/** Socket.IO implementation of the opaque relay transport boundary. */
export class SocketIoRelayTransport implements Transport {
    private readonly socket: Socket;
    private readonly eventHandlerLogger: Logger;
    private proofProvider?: DeviceProofProvider;
    private activeConversationId?: string;
    private desiredConversation?: { conversationId: string; peerRoutingId: string; controlCapability: string; routingProof?: string };
    private hasJoinedOnce = false;
    private connectionGeneration = 0;
    private joinedGeneration = -1;
    private joinedConversationId?: string;
    private peerProtocolFeatures = new Set<string>();
    private advertisedProtocolFeatures = new Set<string>();
    private joinInFlight?: { generation: number; conversationId: string; promise: Promise<void> };

    constructor(
        private readonly subscriptionContext: () => SubscriptionType,
        private readonly logger: Logger,
        private readonly onEnvelope: TransportEnvelopeHandler,
    ) {
        this.eventHandlerLogger = this.logger.createChild('eventHandler');
        this.socket = socketIOClient(`${configContext().baseUrl}/`);
        this.socket.on('connect', () => {
            this.connectionGeneration += 1;
            this.joinedGeneration = -1;
            this.joinedConversationId = undefined;
            void this.restoreChannelPresence();
        });
        this.socket.on('disconnect', () => {
            this.joinedGeneration = -1;
            this.joinedConversationId = undefined;
            this.peerProtocolFeatures.clear();
        });
        this.socket.on(WIRE_EVENTS.LIMIT_REACHED, (...args) => this.handleEvent('limit-reached', args));
        this.socket.on(WIRE_EVENTS.DELIVERED, (...args) => this.handleEvent('delivered', args));
        this.socket.on(WIRE_EVENTS.ON_ALICE_JOIN, (payload: unknown) => {
            const features = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? (payload as { protocolFeatures?: unknown }).protocolFeatures : payload;
            this.peerProtocolFeatures = new Set(this.parsePeerFeatures(features));
            this.handleEvent('on-alice-join', [payload]);
        });
        this.socket.on(WIRE_EVENTS.ON_ALICE_DISCONNECT, (...args) => this.handleEvent('on-alice-disconnect', args));
        this.socket.on(WIRE_EVENTS.CHAT_MESSAGE, (message: RawChatMessage, ack?: (response: { accepted: boolean }) => void) => {
            void this.acceptChatEnvelope(message, ack);
        });
        this.socket.on(WIRE_EVENTS.WEBRTC_SIGNAL, (message: RawSignalMessage) => {
            void this.onEnvelope({ channel: 'signaling', envelope: message.envelope }).catch(() => undefined);
        });
    }

    public async start(): Promise<void> {
        // socket.io-client starts connecting when constructed.
    }

    public async stop(): Promise<void> {
        this.desiredConversation = undefined;
        this.hasJoinedOnce = false;
        this.joinedGeneration = -1;
        this.joinedConversationId = undefined;
        this.activeConversationId = undefined;
        this.peerProtocolFeatures.clear();
        this.socket.disconnect();
    }

    public setDeviceProofProvider(provider: DeviceProofProvider | undefined): void { this.proofProvider = provider; }

    public async join(conversationId: string, peerRoutingId: string, controlCapability: string, routingProof?: string): Promise<void> {
        if (this.desiredConversation?.conversationId !== conversationId) this.peerProtocolFeatures.clear();
        this.activeConversationId = conversationId;
        const desired = { conversationId, peerRoutingId, controlCapability, routingProof };
        this.desiredConversation = desired;
        await this.ensureChannelPresence(desired);
    }

    public peerSupportsFeature(feature: string): boolean {
        return this.peerProtocolFeatures.has(feature);
    }

    public setProtocolFeatures(features: readonly string[]): void {
        if (features.some((feature) => !SUPPORTED_PROTOCOL_FEATURES.includes(feature as typeof SUPPORTED_PROTOCOL_FEATURES[number])) ||
            new Set(features).size !== features.length) throw new Error('Unsupported relay protocol feature.');
        this.advertisedProtocolFeatures = new Set(features);
    }

    /** Called only after the conversation transition has released its local lock. */
    public async requestMailboxReplay(): Promise<void> {
        if (!this.isCurrentChannelJoined()) throw new Error('Authenticated relay channel join is required before mailbox replay.');
        await this.emitWithAck<{ status: 'accepted' }>('mailbox-replay', {});
    }

    public async sendEnvelope(
        channel: CryptoChannel,
        envelope: EncryptedEnvelope,
        recipientRoutingId?: string,
        proofOperation?: DeviceProofOperation,
    ): Promise<{ id?: string; timestamp?: number }> {
        const desired = this.desiredConversation;
        if (!desired) throw new Error('Join a conversation before sending relay operations.');
        await this.ensureChannelPresence(desired);
        if (channel === 'message') {
            const operation = proofOperation ?? 'relay:message';
            const carrier = this.proofProvider ? await this.proofProvider.acquire(operation, this.activeConversationId ? { conversationId: this.activeConversationId } : undefined) : undefined;
            return await this.emitWithAck<{ id: string; timestamp: number }>('chat-message', { envelope, ...(recipientRoutingId ? { recipientRoutingId } : {}), ...(carrier ? { ...carrier, proofOperation: operation } : {}) });
        }
        const operation = proofOperation ?? 'relay:signal';
        const carrier = this.proofProvider ? await this.proofProvider.acquire(operation, this.activeConversationId ? { conversationId: this.activeConversationId } : undefined) : undefined;
        await this.emitWithAck<{ status: string }>('webrtc-signal', { envelope, ...(carrier ? { ...carrier, proofOperation: operation } : {}) });
        return {};
    }

    public connectionState(): TransportConnectionState {
        if (this.socket.connected) {
            return 'connected';
        }
        return this.socket.disconnected ? 'stopped' : 'connecting';
    }

    /** Safe local diagnostics for development call-routing checks. */
    public async testOnlyRelayRegistration(): Promise<{ connected: boolean; joinAcknowledged: boolean; channelHash?: string }> {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        const conversationId = this.desiredConversation?.conversationId;
        let channelHash: string | undefined;
        if (conversationId && globalThis.crypto?.subtle) {
            const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(conversationId)));
            channelHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }
        return {
            connected: this.connectionState() === 'connected',
            joinAcknowledged: Boolean(conversationId && this.activeConversationId === conversationId && this.isCurrentChannelJoined()),
            ...(channelHash ? { channelHash } : {}),
        };
    }

    private isCurrentChannelJoined(): boolean {
        return this.socket.connected !== false && !!this.desiredConversation &&
            this.joinedGeneration === this.connectionGeneration &&
            this.joinedConversationId === this.desiredConversation.conversationId;
    }

    /**
     * Socket.IO presence is scoped to one connection. Re-authenticate every
     * new connection generation with a fresh device proof before replay or
     * protected transport operations can proceed.
     */
    private async restoreChannelPresence(): Promise<void> {
        const desired = this.desiredConversation;
        // On first boot, the explicit join below owns registration. This
        // handler is for restoring presence after an already-joined socket
        // loses its connection; persisted conversations call join() again
        // after page reload through the normal vault restore path.
        if (!desired || !this.hasJoinedOnce) return;
        try {
            await this.ensureChannelPresence(desired);
            await this.requestMailboxReplay();
        } catch {
            // Keep the desired channel so a subsequent Socket.IO reconnect can
            // retry with a fresh proof. Protected sends also retry the join.
        }
    }

    private async ensureChannelPresence(desired: { conversationId: string; peerRoutingId: string; controlCapability: string; routingProof?: string }): Promise<void> {
        if (this.desiredConversation !== desired && this.desiredConversation?.conversationId !== desired.conversationId) {
            throw new Error('Conversation changed before relay registration.');
        }
        const generation = this.connectionGeneration;
        if (this.isCurrentChannelJoined()) return;
        const existing = this.joinInFlight;
        if (existing?.generation === generation && existing.conversationId === desired.conversationId) {
            await existing.promise;
            return;
        }
        const promise = (async () => {
            await this.waitForSocketConnection();
            if (generation !== this.connectionGeneration) {
                await this.ensureChannelPresence(this.desiredConversation ?? desired);
                return;
            }
            const carrier = this.proofProvider ? await this.proofProvider.acquire('relay:message', { conversationId: desired.conversationId }) : undefined;
            const payload: chatJoinPayloadType = {
                channelID: desired.conversationId,
                userID: desired.peerRoutingId,
                controlCapability: desired.controlCapability,
                ...(desired.routingProof ? { routingProof: desired.routingProof } : {}),
                ...(carrier ? carrier : {}),
                ...(this.advertisedProtocolFeatures.size ? { protocolFeatures: [...this.advertisedProtocolFeatures] } : {}),
            };
            const response = await this.emitWithAck<{ status: 'accepted'; peerFeatures?: unknown }>('chat-join', payload);
            this.peerProtocolFeatures = new Set(this.parsePeerFeatures(response?.peerFeatures));
            if (this.desiredConversation?.conversationId !== desired.conversationId) {
                throw new Error('Conversation changed before relay registration completed.');
            }
            if (generation === this.connectionGeneration) {
                this.joinedGeneration = generation;
                this.joinedConversationId = desired.conversationId;
                this.hasJoinedOnce = true;
            }
            else await this.ensureChannelPresence(this.desiredConversation);
        })();
        this.joinInFlight = { generation, conversationId: desired.conversationId, promise };
        try {
            await promise;
        } finally {
            if (this.joinInFlight?.promise === promise) this.joinInFlight = undefined;
        }
    }

    private async waitForSocketConnection(): Promise<void> {
        // Socket.IO buffers emits while disconnected, but an authorization
        // proof could expire before that buffered join is sent. Wait for the
        // actual transport connection before acquiring and emitting the proof.
        if (this.socket.connected !== false) return;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('Relay connection timed out.')), 15_000);
            const onConnect = (): void => finish();
            const onConnectError = (): void => finish(new Error('Relay connection failed.'));
            const finish = (error?: Error): void => {
                clearTimeout(timeout);
                this.socket.off('connect', onConnect);
                this.socket.off('connect_error', onConnectError);
                if (error) reject(error); else resolve();
            };
            this.socket.on('connect', onConnect);
            this.socket.on('connect_error', onConnectError);
            if (this.socket.connected) finish();
        });
    }

    private parsePeerFeatures(value: unknown): string[] {
        if (!Array.isArray(value) || value.length > SUPPORTED_PROTOCOL_FEATURES.length ||
            value.some((feature) => typeof feature !== 'string' || !SUPPORTED_PROTOCOL_FEATURES.includes(feature as typeof SUPPORTED_PROTOCOL_FEATURES[number])) ||
            new Set(value).size !== value.length) return [];
        return value as string[];
    }

    public capabilities(): TransportCapabilities {
        return { envelopes: true, blobs: false, localOnly: false };
    }

    private async acceptChatEnvelope(message: RawChatMessage, ack?: (response: { accepted: boolean }) => void): Promise<void> {
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
            ack?.({ accepted });
        } catch {
            // Rejected/invalid envelopes are intentionally not acknowledged.
            ack?.({ accepted: false });
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
