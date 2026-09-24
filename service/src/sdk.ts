import { configContext, setConfig } from './configContext';
import { resolveEncryptionStrategyFactory } from './crypto/registry';
import type { CryptoSession, InboundTransportEnvelope, TransportManager } from './core/contracts';
import { LegacyInviteCryptoSession } from './core/legacyInviteCryptoSession';
import { ReplayGuard } from './utils/replayGuard';
import { deleteLink, getLink } from './api/links';
import { getUsersInChannel } from './api/messages';
import { configType, type IChatE2EE, type ISendMessageReturn, type LinkObjType, type TypeUsersInChannel } from './public/types';
import { SocketIoRelayTransport, type SubscriptionType } from './transports/socketIoRelayTransport';
import { DefaultTransportManager } from './transports/transportManager';
import { Logger } from './utils/logger';
export { setConfig } from './configContext';
export { BrowserSecureStorage, PRODUCTION_ARGON2ID_PARAMETERS } from './storage/secureVault';
export { IndexedDbVaultPersistence, MemoryVaultPersistence } from './storage/persistence';
export { IndexedDbPublicPreferences } from './storage/publicPreferences';
export { VodozemacCryptoSession, VODOZEMAC_ENVELOPE_VERSION, VODOZEMAC_STRATEGY_ID } from './core/vodozemacCryptoSession';
export type { VodozemacSessionHandle } from './core/vodozemacCryptoSession';
export { PersistentVodozemacIdentity, fingerprintVodozemacIdentity } from './identity/vodozemacIdentity';
export type { VodozemacAccountFactory, VodozemacAccountHandle, VodozemacInboundSessionResult, VodozemacPublicIdentity } from './identity/vodozemacIdentity';
export { createVodozemacPublicBundle, validateVodozemacPublicBundle, VODOZEMAC_BUNDLE_PROTOCOL, VODOZEMAC_BUNDLE_VERSION } from './identity/vodozemacBundle';
export type { VodozemacPublicBundle, VodozemacPublicKeyMaterial } from './identity/vodozemacBundle';
export { ContactIdentityRegistry } from './identity/contactIdentityRegistry';
export type { ContactIdentityEvent, IdentityChangeStatus, StoredContactIdentity } from './identity/contactIdentityRegistry';
export { VodozemacSessionStore } from './identity/vodozemacSessionStore';
export type { VodozemacSessionFactory } from './identity/vodozemacSessionStore';
export { VodozemacSessionRepository } from './identity/vodozemacSessionRepository';
export { VodozemacRuntime } from './crypto/vodozemacRuntime';
export { ModernConversation } from './crypto/modernConversation';
export type { ModernConnectionDetails, DeviceControlEvent } from './crypto/modernConversation';
export type { EnrollmentRequest, LifecycleStateSnapshot } from './devices/lifecycle';
export { ConversationModeStore } from './crypto/conversationMode';
export type { ConversationProtocolMode, ModernConversationRecord } from './crypto/conversationMode';
export { conversationCreationPolicy, modeForNewConversation, resolveConversationMode } from './crypto/conversationPolicy';
export * from './calls';
export * from './privateNetwork';
export type { ConversationCreationPolicy, PersistedConversationMode } from './crypto/conversationPolicy';
export { encodeVerificationQrPayload, decodeVerificationQrPayload, verificationStateForContact } from './identity/verificationFoundation';
export type { CanonicalVerificationQrPayload, VerificationState } from './identity/verificationFoundation';
export type {
    VodozemacBindings,
    VodozemacBindingsLoader,
    VodozemacLifecycleState,
} from './crypto/vodozemacRuntime';
export { VodozemacBoundaryError } from './crypto/vodozemacErrors';
export type { VodozemacErrorCode } from './crypto/vodozemacErrors';
export { loadLocalVodozemacBindings } from './crypto/vodozemacWasm';
export type { VodozemacGeneratedModule } from './crypto/vodozemacWasm';
export { publishVodozemacBundle, fetchVodozemacBundle, claimVodozemacOneTimeKey } from './api/prekeys';
export { ATTACHMENT_LIMITS, decryptAttachment, encryptAttachment, generateAttachmentKey, MemoryAttachmentStorage } from './attachments';
export type { AttachmentId, AttachmentReference, AttachmentStorage, AttachmentUpload, EncryptedAttachmentChunk, EncryptedAttachmentMetadata } from './attachments';
export { BrowserVoiceRecorder, createEncryptedVoiceMessage } from './voice';
export type { VoiceMessageReference, VoiceRecorder, VoiceRecordingState } from './voice';
export { prepareEncryptedFile, prepareEncryptedMedia, MEDIA_LIMITS } from './media';
export type { MediaKind, PreparedMedia } from './media';
export { createEncryptedMediaMessage, parseEncryptedMediaMessage, serializeEncryptedMediaMessage } from './media';
export { MediaMessageWorkflow } from './media';
export type { MediaAttachmentGateway, MediaConversationContext, MediaReceiveResult, MediaSendResult } from './media';
export type { EncryptedMediaMessage } from './media';
export { MemoryAttachmentDeliveryStore } from './attachments';
export { PersistentAttachmentDeliveryStore } from './attachments';
export type { AttachmentMetadataPersistence, AttachmentChunkPersistence, PersistentAttachmentPersistence, PersistentAttachmentRecord } from './attachments';
export type { AttachmentDeliveryRecord, AttachmentDeliveryStore, AttachmentMetadataStore, AttachmentStatus, AttachmentStatusView, CiphertextChunkStore } from './attachments';
export { AttachmentService } from './attachments';
export type { AttachmentConversationContext, CreateAttachmentUpload, CreatedAttachmentUpload } from './attachments';
export { MediaPermissionTracker } from './permissions';
export type { MediaPermissionKind, MediaPermissionState } from './permissions';
import { generateUUID } from './utils/uuid';
import {
    WebRTCCall,
    E2ECall,
    peerConnectionEvents,
    CallSignalRouter,
    type PeerConnectionEventType,
    type WebRtcSignalPayload,
} from './webrtc/webrtcCall';
import { type CallControlSignal, type CallEndReason, type CallLifecycleState, type CallLifecycleUpdate } from './webrtc/types';
export type { IE2ECall } from './webrtc/webrtcCall';

export const utils = {
    generateUUID
}

const logger = new Logger();
export const createChatInstance = (config?: Partial<configType>): IChatE2EE => {
    logger.log('Creating new instance');
    return new ChatE2EE(config);
}

/** Shape of a decrypted chat payload (see `handleRawChatMessage`). */
type ChatPlaintext = { seq: number, timestamp: number, text: string, image?: string };

/** JSON-serialize an arbitrary payload into raw bytes — the wire format `EncryptionStrategy.encrypt()` expects. */
const encodePayload = (payload: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;

/** Deserialize raw bytes produced by `EncryptionStrategy.decrypt()` back into JSON. */
const decodePayload = <T>(bytes: ArrayBuffer): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

/** Test-only call receive marker. It records a fixed stage label and no signal fields. */
const testOnlyCallSignalStage = (stage: 'signal-received'): void => {
    const diagnostic = globalThis as typeof globalThis & {
        __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean;
        __k3ncryptCallSignalStages?: string[];
    };
    if (diagnostic.__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ !== true) return;
    const stages = diagnostic.__k3ncryptCallSignalStages ??= [];
    stages.push(stage);
    if (stages.length > 32) stages.shift();
};

class ChatE2EE implements IChatE2EE {
    private roomId?: string;
    private userId?: string;
    private controlCapability?: string;

    /** Transport-independent crypto lifecycle; currently backed by the explicitly legacy invite adapter. */
    private cryptoSession: CryptoSession;

    //To Do: Fix types
    private subscriptions: Map<string, Set<Function>> = new Map();
    private callSubscriptions: Map<string, Set<Function>> = new Map();
    private transportManager!: TransportManager;

    private subscriptionLogger = logger.createChild('Subscription');
    private callLogger = logger.createChild('Call');
    private chatLogger = logger.createChild('Chat');
    private signalSeq = 0;
    private chatSeq = 0;
    private activeCallId?: string;
    private callMediaKind: 'audio' | 'video' = 'audio';
    private outgoingInviteTimeout?: ReturnType<typeof setTimeout>;
    private callLifecycleState: CallLifecycleState = 'idle';
    private lastSignalSeqByCall: Map<string, number> = new Map();
    private chatReplayGuard: ReplayGuard = new ReplayGuard();

    private initialized = false;


    private callSignalRouter: CallSignalRouter = new CallSignalRouter(
        () => this.createWebRtcCall(this.activeCallId || this.callSignalRouter.pendingCallId, this.callMediaKind),
        () => {
            this.callSubscriptions.get("call-added")?.forEach((cb) => cb(this.activeCall));
        },
        (callId) => {
            this.activeCallId = callId;
            if (this.callLifecycleState !== 'incoming') {
                this.updateCallLifecycle('incoming');
                this.callSubscriptions.get("call-invite")?.forEach((cb) => cb({ callId, mediaKind: this.callMediaKind }));
            }
        },
        this.callLogger,
    );

    private setupCallSubs(call: WebRTCCall): void {
        call.on('state-changed', (state) => {
            if (state === 'connecting') {
                this.updateCallLifecycle('connecting');
            }
            if (state === 'connected') {
                this.clearOutgoingInviteTimeout();
                this.updateCallLifecycle('connected');
            }
            if(state === 'failed' || state === 'closed') {
                this.callLogger.log(`Ending call, RTCPeerConnectionState: ${state}`);
                const reason: CallEndReason = state === 'failed' ? 'failed' : 'remote-end';
                this.endCall(reason);
            } else if (state === 'disconnected') {
                this.updateCallLifecycle('ice-failed');
            }
        })
    }
    constructor(config?: Partial<configType>) {
        config && setConfig(config);
        // Resolved once per instance (not persisted to the shared global
        // config) so multiple ChatE2EE instances can run different
        // strategies concurrently. Throws immediately for an unknown
        // strategy id — no lazy/deferred failure at setChannel() time.
        // The factory is called twice so the chat and signaling strategy
        // instances are always genuinely distinct, even though they share
        // the same underlying implementation.
        const strategyFactory = resolveEncryptionStrategyFactory(config?.encryption?.strategy, {
            developmentAllowInsecurePlaintextStrategy: config?.encryption?.developmentAllowInsecurePlaintextStrategy,
            environment: typeof process === 'undefined' ? 'production' : process.env.NODE_ENV,
        });
        this.cryptoSession = new LegacyInviteCryptoSession(strategyFactory);
    }

    public async init(): Promise<void> {
        const initLogger = logger.createChild('Init');
        initLogger.log(`Started.`);

        this.createTransport();
        await this.transportManager.start();

        initLogger.log(`Finished.`);
        this.initialized = true;
    }

    public get activeCall(): E2ECall | null {
        const call = this.callSignalRouter.activeCall;
        if(!call) {
            return null;
        }
        return new E2ECall(call);
    }

    public async getLink(): Promise<LinkObjType> {
        logger.log('getLink()');
        return getLink();
    }

    /**
     * Establishes the per-room encryption session via the configured
     * strategy (HKDF-SHA256/AES-GCM by default) and joins the room.
     * `secret` never leaves this device — only `roomId` and `userId` are
     * sent to the server.
     */
    public async setChannel(roomId: string, secret: string, userId: string, controlCapability: string, _userName?: string): Promise<void> {
        this.checkInitialized();
        logger.log('setChannel()');
        if (!roomId || !secret || !controlCapability) {
            throw new Error('setChannel() requires a roomId, invitation secret, and control capability.');
        }
        // The crypto-session boundary owns key derivation and strategy state;
        // this application façade only supplies the legacy invite secret.
        await this.cryptoSession.initialize(secret);
        this.roomId = roomId;
        this.userId = userId;
        this.controlCapability = controlCapability;
        // A fresh room join starts a fresh sequence-number space: forget any
        // sequence numbers remembered from a previous setChannel() call on
        // this instance, otherwise a peer restarting their own counter would
        // have every message rejected as a replay.
        this.chatSeq = 0;
        this.chatReplayGuard.clear();
        this.transportManager.join(this.roomId, this.userId, this.controlCapability);
        return;
    }

    /**
     * True once the configured strategy's session is ready (i.e. as soon as
     * setChannel() has resolved) *and* the strategy actually provides
     * confidentiality. Always `false` for an explicitly disabled/no-op
     * strategy, even once its session is ready.
     */
    public isEncrypted(): boolean {
        this.checkInitialized();
        logger.log(`isEncrypted()`);
        return this.cryptoSession.ready && this.cryptoSession.encrypted;
    }

    public async delete(): Promise<void> {
        logger.log(`delete()`);
        this.checkInitialized();
        await deleteLink({ channelID: this.roomId, controlCapability: this.controlCapability });
        this.clearChannelSecrets();
    }

    public async getUsersInChannel(): Promise<TypeUsersInChannel> {
        logger.log(`getUsersInChannel()`);
        this.checkInitialized();
        return getUsersInChannel({ channelID: this.roomId, controlCapability: this.controlCapability });
    }

    public encrypt({ image, text }: { image: string, text: string }): { send: () => Promise<ISendMessageReturn> } {
        logger.log(`encrypt()`);
        this.checkInitialized();

        return ({
            send: async () => {
                this.assertChannelReady();
                const seq = ++this.chatSeq;
                const payload: ChatPlaintext = {
                    seq,
                    timestamp: Date.now(),
                    text,
                    image,
                };
                const envelope = await this.cryptoSession.encrypt('message', encodePayload(payload));
                const { id, timestamp } = await this.transportManager.sendEnvelope('message', envelope);
                return { id: String(id), timestamp: String(timestamp) };
            }
        })
    }

    public on(listener: string, callback: (...args: any[]) => void): void {
        const loggerWithInvocationId = this.subscriptionLogger.withInvocationId();
        let subscriptions = this.subscriptions;
        
        if(peerConnectionEvents.includes(listener as PeerConnectionEventType)) {
            subscriptions = this.callSubscriptions;
        }
        
        const sub = subscriptions.get(listener);
        if (sub) {
            if (sub.has(callback)) {
                loggerWithInvocationId.log(`Skipping, subscription: ${listener}`);
                return;
            }
            loggerWithInvocationId.log(`Created +1 : ${listener}`);
            sub.add(callback);
        } else {
            loggerWithInvocationId.log(`Created: ${listener}`);
            subscriptions.set(listener, new Set([callback]));
        }
    }

    public dispose(): void {
        this.checkInitialized();
        logger.log('dispose()');
        void this.transportManager.stop();
        this.subscriptions.clear();
        this.clearChannelSecrets();
        this.initialized = false;
    }

    public async startCall(): Promise<E2ECall> {
        return this.startMediaCall('audio');
    }

    public async startVideoCall(): Promise<E2ECall> {
        return this.startMediaCall('video');
    }

    private async startMediaCall(mediaKind: 'audio' | 'video'): Promise<E2ECall> {
        // isSupported() is a basic RTCPeerConnection feature-detection check
        // (see WebRTCCall.isSupported) — there is no encoded-transform
        // capability gate any more, since media relies solely on WebRTC's
        // standard DTLS-SRTP transport encryption.
        if(!WebRTCCall.isSupported()) {
            throw new Error('WebRTC is not supported in this environment.');
        }
        if(this.callSignalRouter.activeCall) {
            throw new Error('Call already active');
        }
        await this.assertCallPreconditions();
        this.activeCallId = generateUUID();
        this.callMediaKind = mediaKind;
        this.signalSeq = 0;
        const webrtcCall = this.createWebRtcCall(this.activeCallId, mediaKind);
        this.callSignalRouter.attachCall(webrtcCall, this.activeCallId);
        this.updateCallLifecycle('initiating');
        await this.sendControlSignal('call-invite', undefined, mediaKind);
        this.updateCallLifecycle('ringing');
        this.scheduleOutgoingInviteTimeout();
        const call = new E2ECall(webrtcCall);
        return call;
    }

    public async acceptCall(): Promise<void> {
        if (!this.activeCallId) {
            throw new Error('Missing call identifier for incoming call.');
        }
        await this.sendControlSignal('call-accept');
        const call = this.callSignalRouter.acceptPendingOffer(this.activeCallId);
        if (call) {
            this.callSubscriptions.get("call-added")?.forEach((cb) => cb(this.activeCall));
        }
        this.updateCallLifecycle('connecting');
    }

    public async rejectCall(): Promise<void> {
        const pendingCallId = this.callSignalRouter.pendingCallId;
        if (!pendingCallId) {
            return;
        }
        this.activeCallId = pendingCallId;
        await this.sendControlSignal('call-reject', 'rejected');
        this.callSignalRouter.rejectPendingOffer();
        this.endLocalCall('rejected', 'rejected');
    }

    public async cancelCall(): Promise<void> {
        if (!this.activeCallId) {
            return;
        }
        await this.sendControlSignal('call-cancel', 'cancelled');
        this.endLocalCall('cancelled', 'cancelled');
    }

    public async endCall(reason: CallEndReason = 'local-end'): Promise<void> {
        if (this.activeCallId) {
            await this.sendControlSignal('call-end', reason);
        }
        this.endLocalCall(reason);
    }

    /**
     * Decrypts an incoming chat envelope and fans it out to `chat-message`
     * subscribers. Any failure (unknown version, wrong room, bad auth tag)
     * or replayed/duplicate sequence number drops the message outright —
     * there is no plaintext fallback and no partial delivery.
     */
    private async handleRawChatMessage(msg: InboundTransportEnvelope): Promise<void> {
        this.assertChannelReady();
        const payload = decodePayload<ChatPlaintext>(await this.cryptoSession.decrypt('message', msg.envelope));
        if (!this.chatReplayGuard.accept('chat', payload.seq)) {
            this.chatLogger.log(`Dropping replayed/duplicate chat message, seq=${payload.seq}`);
            return;
        }
        this.subscriptions.get('chat-message')?.forEach((cb) => cb({
            sender: msg.senderRoutingId,
            message: payload.text,
            image: payload.image,
            id: msg.messageId,
            timestamp: msg.timestamp,
        }));
    }

    /**
     * Decrypts an incoming WebRTC signaling envelope before handing it to
     * the existing call-lifecycle/signal-routing logic. Any decryption
     * failure is treated as a signaling failure — the payload is dropped,
     * never interpreted as plaintext.
     */
    private async handleRawWebrtcSignal(msg: InboundTransportEnvelope): Promise<void> {
        this.assertChannelReady();
        const payload = decodePayload<WebRtcSignalPayload>(await this.cryptoSession.decrypt('signaling', msg.envelope));
        testOnlyCallSignalStage('signal-received');
        await this.handleCallSignal(payload);
    }

    private async handleCallSignal(data: WebRtcSignalPayload): Promise<void> {
        if (this.isStaleSignal(data)) {
            return;
        }
        if (data.type === 'call-invite') {
            if (data.mediaKind !== undefined && data.mediaKind !== 'audio' && data.mediaKind !== 'video') return;
            if (this.callSignalRouter.activeCall || this.callSignalRouter.pendingCallId) {
                this.activeCallId = data.callId;
                await this.sendControlSignal('call-reject', 'rejected');
                return;
            }
            this.activeCallId = data.callId;
            this.callMediaKind = data.mediaKind ?? 'audio';
            this.updateCallLifecycle('incoming');
            this.scheduleIncomingInviteTimeout(data.callId);
            this.callSubscriptions.get("call-invite")?.forEach((cb) => cb({ callId: data.callId, mediaKind: this.callMediaKind }));
            return;
        }

        if (data.type === 'call-accept') {
            if (!this.activeCallId || data.callId !== this.activeCallId) {
                return;
            }
            this.clearOutgoingInviteTimeout();
            this.updateCallLifecycle('connecting');
            await this.callSignalRouter.activeCall?.startCall();
            return;
        }

        if (data.type === 'call-reject') {
            if (this.activeCallId && data.callId === this.activeCallId) {
                this.callSubscriptions.get("call-rejected")?.forEach((cb) => cb({ callId: data.callId }));
                this.endLocalCall('rejected', 'rejected');
            }
            return;
        }

        if (data.type === 'call-cancel') {
            if (this.activeCallId && data.callId === this.activeCallId) {
                this.callSubscriptions.get("call-cancelled")?.forEach((cb) => cb({ callId: data.callId }));
                this.endLocalCall('cancelled', 'cancelled');
            }
            return;
        }

        if (data.type === 'call-timeout') {
            if (this.activeCallId && data.callId === this.activeCallId) {
                this.callSubscriptions.get("call-timeout")?.forEach((cb) => cb({ callId: data.callId }));
                this.endLocalCall('timeout', 'timeout');
            }
            return;
        }

        if (data.type === 'call-end') {
            if (this.activeCallId && data.callId === this.activeCallId) {
                this.callSubscriptions.get("call-ended")?.forEach((cb) => cb({ callId: data.callId, reason: data.reason }));
                this.endLocalCall('remote-end');
            }
            return;
        }

        this.callSignalRouter.handleSignal(data);
    }

    private async assertCallPreconditions(): Promise<void> {
        const users = await this.getUsersInChannel();
        if (!users || users.length < 2) {
            this.updateCallLifecycle('no-peer');
            throw new Error('No user available to accept call');
        }
        this.assertChannelReady();
    }

    private async sendControlSignal(type: CallControlSignal['type'], reason?: CallEndReason, mediaKind?: 'audio' | 'video'): Promise<void> {
        if (!this.activeCallId) {
            throw new Error('Cannot send control signal without active call ID.');
        }
        const signal: CallControlSignal = {
            type,
            callId: this.activeCallId,
            seq: ++this.signalSeq,
            timestamp: Date.now(),
            ...(reason ? { reason } : {}),
            ...(mediaKind ? { mediaKind } : {}),
        };
        await this.sendSignal(signal);
    }

    /** Seals a signaling payload through the configured strategy's signaling instance and relays it over the socket. */
    private async sendSignal(payload: WebRtcSignalPayload): Promise<void> {
        this.assertChannelReady();
        const envelope = await this.cryptoSession.encrypt('signaling', encodePayload(payload));
        await this.transportManager.sendEnvelope('signaling', envelope);
    }

    private scheduleOutgoingInviteTimeout(): void {
        this.clearOutgoingInviteTimeout();
        this.outgoingInviteTimeout = setTimeout(async () => {
            if (this.callLifecycleState !== 'ringing' || !this.activeCallId) {
                return;
            }
            try {
                await this.sendControlSignal('call-timeout', 'timeout');
            } catch (error) {
                this.callLogger.log('Unable to send timeout signal', error);
            }
            this.callSubscriptions.get("call-timeout")?.forEach((cb) => cb({ callId: this.activeCallId }));
            this.endLocalCall('timeout', 'timeout');
        }, 30_000);
    }

    private scheduleIncomingInviteTimeout(callId: string): void {
        this.clearOutgoingInviteTimeout();
        this.outgoingInviteTimeout = setTimeout(async () => {
            if (this.callLifecycleState !== 'incoming' || this.activeCallId !== callId) return;
            try { await this.sendControlSignal('call-timeout', 'timeout'); } catch (error) { this.callLogger.log('Unable to send incoming timeout signal', error); }
            this.callSubscriptions.get("call-timeout")?.forEach((cb) => cb({ callId }));
            this.endLocalCall('timeout', 'timeout');
        }, 30_000);
    }

    private clearOutgoingInviteTimeout(): void {
        if (this.outgoingInviteTimeout) {
            clearTimeout(this.outgoingInviteTimeout);
            this.outgoingInviteTimeout = undefined;
        }
    }

    private updateCallLifecycle(state: CallLifecycleState, reason?: CallEndReason): void {
        this.callLifecycleState = state;
        const payload: CallLifecycleUpdate = {
            state,
            callId: this.activeCallId,
            ...(reason ? { reason } : {}),
        };
        this.callSubscriptions.get("call-state-changed")?.forEach((cb) => cb(payload));
    }

    private endLocalCall(reason: CallEndReason, terminalState: CallLifecycleState = 'ended'): void {
        if (['ended', 'rejected', 'cancelled', 'timeout'].includes(this.callLifecycleState) && !this.activeCallId) return;
        this.clearOutgoingInviteTimeout();
        this.updateCallLifecycle('ending', reason);
        this.callSignalRouter.activeCall?.endCall();
        this.callSignalRouter.reset();
        this.callSubscriptions.get("call-removed")?.forEach((cb) => cb());
        if (this.activeCallId) {
            this.lastSignalSeqByCall.delete(this.activeCallId);
        }
        if (terminalState !== 'ended') {
            this.updateCallLifecycle(terminalState, reason);
        }
        this.activeCallId = undefined;
        this.callMediaKind = 'audio';
        this.updateCallLifecycle('ended', reason);
    }

    private isStaleSignal(signal: WebRtcSignalPayload): boolean {
        const last = this.lastSignalSeqByCall.get(signal.callId);
        if (typeof last === 'number' && signal.seq <= last) {
            this.callLogger.log(`Skipping stale signal ${signal.type} for call=${signal.callId}, seq=${signal.seq}`);
            return true;
        }
        this.lastSignalSeqByCall.set(signal.callId, signal.seq);
        return false;
    }

    private createTransport(): void {
        const subscriptionContext = () => this.subscriptions as SubscriptionType;
        const transport = new SocketIoRelayTransport(
            subscriptionContext,
            logger.createChild('Transport'),
            async (message) => {
                if (message.channel === 'message') {
                    try {
                        await this.handleRawChatMessage(message);
                        return true;
                    } catch (error) {
                        this.chatLogger.log('Rejected chat message (dropped, no fallback):', error);
                        return false;
                    }
                }
                try {
                    await this.handleRawWebrtcSignal(message);
                    return true;
                } catch (error) {
                    this.callLogger.log('Rejected signaling message (dropped, no fallback):', error);
                    this.updateCallLifecycle('signaling-failed');
                    return false;
                }
            },
        );
        this.transportManager = new DefaultTransportManager(transport);
    }

    private checkInitialized(): void {
        if(!this.initialized) {
            throw new Error('ChatE2EE is not initialized, call init()');
        }
    }

    /** Throws unless setChannel() has established a ready encryption session for an active room. */
    private assertChannelReady(): void {
        if (!this.roomId || !this.cryptoSession.ready) {
            throw new Error('Channel is not ready: call setChannel() with a valid invite secret first.');
        }
    }

    private clearChannelSecrets(): void {
        // destroy() is synchronous, but a custom strategy's implementation
        // throwing must still not prevent local state from being cleared or
        // the sibling strategy from being torn down.
        try {
            this.cryptoSession.destroy();
        } catch {
            // ignore: best-effort teardown, see comment above.
        }
        this.roomId = undefined;
        this.userId = undefined;
        this.controlCapability = undefined;
        this.chatSeq = 0;
        this.signalSeq = 0;
        this.chatReplayGuard.clear();
        this.lastSignalSeqByCall.clear();
    }

    private createWebRtcCall(callId?: string, mediaKind: 'audio' | 'video' = 'audio'): WebRTCCall {
        this.checkInitialized();
        const resolvedCallId = callId || generateUUID();
        const call = new WebRTCCall(
            (payload) => this.sendSignal(payload),
            this.callLogger,
            () => ({
                callId: resolvedCallId,
                seq: ++this.signalSeq,
                timestamp: Date.now(),
            }),
            configContext().webrtc,
            mediaKind,
        );
        this.setupCallSubs(call)
        return call;
    }
}

export * from './public/types';
export type { CallLifecycleState, CallEndReason, CallLifecycleUpdate } from './webrtc/types';

// ---------------------------------------------------------------------------
// Encryption strategy public API
// ---------------------------------------------------------------------------
// The SDK does not couple to any specific encryption primitive. Every
// strategy (the AES-256-GCM secure default, the explicit "disabled" no-op,
// or a custom one) is registered/selected through this factory-style API,
// in keeping with the `createChatInstance()` factory pattern above.
export {
    registerEncryptionStrategy,
    unregisterEncryptionStrategy,
    hasEncryptionStrategy,
    listEncryptionStrategyIds,
    getEncryptionStrategy,
    DEFAULT_ENCRYPTION_STRATEGY_ID,
    NO_ENCRYPTION_STRATEGY_ID,
} from './crypto/registry';
export type { EncryptionStrategy, EncryptionStrategyFactory, EncryptionEnvelope } from './crypto/strategy';
export * from './devices';
export * from './sync';
export * from './recovery';
export * from './groups';
export type {
    AttachmentStore,
    AppLocalIdentity,
    CryptoChannel,
    CryptoSession,
    EncryptedEnvelope,
    IdentityManager,
    LegacyRoutingIdentity,
    MessagingIdentity,
    ContactIdentity,
    TransportPeer,
    PublicPreferences,
    SecureStorage,
    Transport,
    TransportCapabilities,
    TransportConnectionState,
    TransportManager,
} from './core/contracts';
