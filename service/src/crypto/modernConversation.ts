import { parseFileReference, sameBinding } from '../files/protocol';
import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { EncryptedEnvelope, InboundTransportDecision, PermanentInboundRejectionReason, SecureRecordUpdate, SecureStorage, TransportManager } from '../core/contracts';
import { VODOZEMAC_ENVELOPE_VERSION, VODOZEMAC_STRATEGY_ID } from '../core/vodozemacCryptoSession';
import { claimVodozemacOneTimeKey, fetchVodozemacBundle, publishVodozemacBundle, renewVodozemacBundle } from '../api/prekeys';
import { deleteLink } from '../api/links';
import { ContactIdentityRegistry, type StoredContactIdentity } from '../identity/contactIdentityRegistry';
import { fingerprintVodozemacIdentity, type VodozemacPublicIdentity } from '../identity/vodozemacIdentity';
import { validateVodozemacPublicBundle } from '../identity/vodozemacBundle';
import { DefaultTransportManager } from '../transports/transportManager';
import { RoomTransportChannel } from '../transports/roomTransportChannel';
import { DeliveryCoordinator } from '../delivery/deliveryCoordinator';
import { RelayPathAdapter } from '../transports/relayPathAdapter';
import { JOIN_INTRODUCTION_FEATURE, SocketIoRelayTransport, type SubscriptionType } from '../transports/socketIoRelayTransport';
import { Logger } from '../utils/logger';
import { AsyncMutex } from '../utils/asyncMutex';
import { ConversationModeStore } from './conversationMode';
import { VodozemacRuntime, type OutboundSessionInitialization, type VodozemacBindingsLoader } from './vodozemacRuntime';
import { createAuthenticatedCallComposition, type AuthenticatedCallComposition } from '../calls/composition';
import { VerifiedCallIdentityVerifier } from '../calls/signalBinding';
import type { CallParticipant } from '../calls/contracts';
import { AuthenticatedDeviceControlChannel, SecureStorageDeviceLifecyclePersistence, type DeviceControlMessage } from '../devices/runtime';
import { DeviceTrustEnforcer, TrustStateEventCoordinator, type DeviceTrustDecision, type TrustStateEvent } from '../devices/trust';
import { DeviceLifecycleService, createEnrollmentRequest, createRevocationConfirmation, type AuthenticatedDeviceContext, type DeviceAuthorization, type EnrollmentRequest, type LifecycleStateSnapshot } from '../devices/lifecycle';
import { AuthenticatedDeviceJoinService, type EnrollmentApprovalPacket } from '../devices/join';
import { createDeviceList } from '../devices/deviceList';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { RuntimeSyncController } from '../sync/runtime';
import { envelopeIdForEnvelope, validatedOlmMessage } from '../delivery/envelopeIdentity';
import type { SyncPersistence, SyncAuthorization } from '../sync/contracts';
import { AuthenticatedSyncTransport, type SyncSessionBinding } from '../sync/authenticatedTransport';
import { adoptApprovedAccountBinding, loadAccountBinding } from '../identity/accountBinding';
import { DeviceContextAuthority } from '../devices/authenticatedContext';
import { SocketSyncRelay } from '../sync/relay';
import { configContext } from '../configContext';
import { SecureSyncPersistence } from '../sync/persistence';
import { GroupSecurityRuntime } from '../groups/runtime';
import { SecureStorageGroupRuntimeAdapter } from '../groups/persistence';
import { createProductionRecoveryRuntime } from '../recovery/production';
import type { RecoveryRuntime } from '../recovery/runtime';
import { DeviceProofClient } from '../devices/deviceProofClient';
import { bootstrapFirstDevice } from '../devices/bootstrap';
import { signEnrollmentEvent, type EnrollmentEvent } from '../devices/trustProtocol';
import makeRequest from '../api/client';
import { fromBase64Url, toBase64Url } from './base64url';
import { decodeRoomMessage, encodeRoomMessageV1, MAX_USER_MESSAGE_UTF8_BYTES, RoomMessageDecodeError, roomMessageCommitment, roomMessageEventId, ROOM_MESSAGE_V1_DOMAIN, ROOM_MESSAGE_V1_FEATURE, type RoomMessageKind } from './roomMessageV1';
import { prepareRoomMessageVersionFloorGuard, prepareRoomMessageVersionFloorRaise, readRoomMessageVersionFloor } from './roomMessageVersionFloor';

const OUTBOX_RECORD = 'modern-outbox';
const SEEN_RECORD = 'modern-seen';
const M1_SEEN_RECORD = 'modern-seen-m1-v1';
const ROOM_MESSAGE_SEEN_RECORD = 'modern-seen-room-message-v1';
const PUBLICATION_RECORD = 'modern-publication';
const SESSION_AUDIT_RECORD = 'conversation-session-audit';
const SESSION_RENEWAL_RECORD = 'conversation-session-renewal';
const JOIN_INTRODUCTION_RECORD = 'conversation-join-introduction';
const JOIN_INTRODUCTION_SEEN_RECORD = 'conversation-join-introduction-seen';
const JOIN_INTRODUCTION_MAGIC = new Uint8Array([0x00, 0x4b, 0x33, 0x4e, 0x43, 0x49, 0x01]);
const MAX_PENDING = 32;
const MAX_SEEN = 1024;
type SessionAudit = {
    version: 1;
    classification: 'unused-outbound' | 'retired-unused-outbound' | 'session-with-message-history' | 'active-established' | 'legacy-unclassified';
    direction?: 'outbound' | 'inbound';
    origin?: 'join' | 'first-message';
};
type SessionRenewal = { version: 1; previousSessionId: string; clientId?: string };
type JoinIntroduction = {
    version: 1;
    type: 'join-introduction';
    eventId: string;
    conversationId: string;
    senderAddress: string;
    identityCommitment: string;
    createdAt: number;
    signature: string;
};
type JoinIntroductionRecord = {
    version: 1;
    recipientAddress: string;
    recipientIdentityCommitment: string;
    envelope?: EncryptedEnvelope;
    clientId?: string;
    senderOrigin?: SenderOriginMetadata;
    roomMessageVersion?: 1;
};
const parseSessionRenewal = (bytes: ArrayBuffer | undefined): SessionRenewal | undefined => {
    if (!bytes) return undefined;
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Session renewal state is invalid.');
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || typeof item.previousSessionId !== 'string' || !item.previousSessionId ||
        (item.clientId !== undefined && (typeof item.clientId !== 'string' || !item.clientId))) throw new Error('Session renewal state is invalid.');
    return item as SessionRenewal;
};

const parseSessionAudit = (bytes: ArrayBuffer | undefined): SessionAudit | undefined => {
    if (!bytes) return undefined;
    const value = JSON.parse(decoder.decode(bytes)) as SessionAudit;
    if (!value || value.version !== 1 ||
        !['unused-outbound', 'retired-unused-outbound', 'session-with-message-history', 'active-established', 'legacy-unclassified'].includes(value.classification) ||
        (value.direction !== undefined && value.direction !== 'outbound' && value.direction !== 'inbound') ||
        (value.origin !== undefined && value.origin !== 'join' && value.origin !== 'first-message')) {
        throw new Error('Conversation session audit record is invalid.');
    }
    return value;
};
const TAB_LEASE_MS = 15_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const strictMessageDecoder = new TextDecoder('utf-8', { fatal: true });
const startsWithBytes = (value: Uint8Array, prefix: Uint8Array): boolean =>
    value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);

interface SenderOriginMetadata { version: 1; basis: 'durable-commit'; }
const SENDER_ORIGIN: SenderOriginMetadata = Object.freeze({ version: 1, basis: 'durable-commit' });
interface PendingEnvelope { envelope: EncryptedEnvelope; relayId?: string; sentAt?: number; clientId?: string; senderOrigin?: SenderOriginMetadata; roomMessageVersion?: 1; recipientIdentityReference?: string; terminallyRejected?: true; heldNotSentSecurely?: true; }
interface PublicationMarker { version: 1; roomId: string; address?: string; routingProof?: string; }
export interface ModernConnectionDetails {
    ownFingerprint: string;
    ownAddress: string;
    contact?: StoredContactIdentity;
}
export type DeviceControlEvent = DeviceControlMessage;

class PermanentInboundRejection extends Error {
    constructor(readonly reasonClass: PermanentInboundRejectionReason, detail = 'Inbound message is permanently not accepted.') { super(detail); this.name = 'PermanentInboundRejection'; }
}

type InboundDiagnosticStage = 'received' | 'parsed' | 'session-found' | 'decrypted' | 'frame-parsed' | 'persisted' | 'acknowledged';
type InboundDiagnosticEvent = {
    conversationId: string;
    stage: InboundDiagnosticStage;
    senderFingerprintHash?: string;
    receiverFingerprintHash?: string;
    failureCategory?: string;
};
type InboundMessageAcceptancePlan = {
    updates: readonly SecureRecordUpdate[];
    afterCommit?: () => void | Promise<void>;
};

const testOnlyDeliveryStage = (stage: string): void => {
    const diagnostic = globalThis as typeof globalThis & {
        __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean;
        __k3ncryptDeliveryStages?: Array<{ stage: string; reached: boolean }>;
    };
    if (!testDiagnosticsEnabled()) return;
    const events = diagnostic.__k3ncryptDeliveryStages ??= [];
    events.push({ stage, reached: true });
    if (events.length > 100) events.shift();
};

const testOnlyCallSignalStage = (stage: 'signal-received' | 'trust-check-passed' | 'signal-decrypt-started' | 'signal-decrypted' | 'call-signal-accepted' | 'call-listener-unavailable' | 'signal-handler-rejected'): void => {
    const diagnostic = globalThis as typeof globalThis & {
        __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean;
        __k3ncryptCallSignalStages?: string[];
    };
    if (!testDiagnosticsEnabled()) return;
    const stages = diagnostic.__k3ncryptCallSignalStages ??= [];
    stages.push(stage);
    if (stages.length > 32) stages.shift();
    console.info(`k3ncrypt-call-stage:${stage}`);
};

const asBytes = (value: unknown): ArrayBuffer => encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer;
const isSenderOriginMetadata = (value: unknown): value is SenderOriginMetadata => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return Object.keys(item).sort().join(',') === 'basis,version' && item.version === 1 && item.basis === 'durable-commit';
};
const parseList = <T>(bytes: ArrayBuffer | undefined): T[] => {
    if (!bytes) return [];
    const value = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(value)) throw new Error('Modern delivery state is invalid.');
    return value as T[];
};

const parseM1Seen = (bytes: ArrayBuffer | undefined): string[] => {
    if (!bytes) return [];
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'ids,version' ||
        (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { ids?: unknown }).ids) ||
        (value as { ids: unknown[] }).ids.some((item) => typeof item !== 'string' || !/^v1:[0-9a-f]{64}$/.test(item))) {
        throw new Error('Modern M1 replay state is invalid.');
    }
    return (value as { ids: string[] }).ids;
};

type RoomMessageSeenEvent = { id: string; commitment: string };
const parseRoomMessageSeen = (bytes: ArrayBuffer | undefined): RoomMessageSeenEvent[] => {
    if (!bytes) return [];
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'events,version' ||
        (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { events?: unknown }).events) ||
        (value as { events: unknown[] }).events.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
            Object.keys(item).sort().join(',') !== 'commitment,id' ||
            typeof (item as RoomMessageSeenEvent).id !== 'string' || !/^v1:[0-9a-f]{64}$/.test((item as RoomMessageSeenEvent).id) ||
            typeof (item as RoomMessageSeenEvent).commitment !== 'string' || !/^v1:[0-9a-f]{64}$/.test((item as RoomMessageSeenEvent).commitment))) {
        throw new Error('Modern room-message replay state is invalid.');
    }
    return (value as { events: RoomMessageSeenEvent[] }).events;
};

const firstMessage = (envelope: EncryptedEnvelope): string => {
    if (envelope.version !== VODOZEMAC_ENVELOPE_VERSION || envelope.strategy !== VODOZEMAC_STRATEGY_ID ||
        !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
        throw new Error('Unsupported modern message.');
    }
    return validatedOlmMessage(envelope);
};

const unframeFirstMessage = (bytes: ArrayBuffer): Uint8Array => {
    const value = new Uint8Array(bytes);
    try {
        if (value.length < 2 || value[0] !== 1 || value[1] !== 1) throw new Error('Modern message binding is invalid.');
        return value.slice(2);
    } finally { value.fill(0); }
};

const canonicalJoinIntroduction = (event: Omit<JoinIntroduction, 'signature'>): Uint8Array => encoder.encode(JSON.stringify(event));

const encodeJoinIntroduction = (event: JoinIntroduction): ArrayBuffer => {
    const body = encoder.encode(JSON.stringify(event));
    const result = new Uint8Array(JOIN_INTRODUCTION_MAGIC.length + body.length);
    result.set(JOIN_INTRODUCTION_MAGIC);
    result.set(body, JOIN_INTRODUCTION_MAGIC.length);
    body.fill(0);
    return result.buffer;
};

const parseJoinIntroduction = (payload: Uint8Array): JoinIntroduction | undefined => {
    if (payload.length < JOIN_INTRODUCTION_MAGIC.length ||
        !JOIN_INTRODUCTION_MAGIC.every((byte, index) => payload[index] === byte)) return undefined;
    const bytes = payload.subarray(JOIN_INTRODUCTION_MAGIC.length);
    if (bytes.length > 2048) throw new Error('Join introduction is invalid.');
    let value: unknown;
    try { value = JSON.parse(strictMessageDecoder.decode(bytes)); }
    catch { throw new Error('Join introduction is invalid.'); }
    const expected = ['conversationId', 'createdAt', 'eventId', 'identityCommitment', 'senderAddress', 'signature', 'type', 'version'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== expected.join(',') ) throw new Error('Join introduction is invalid.');
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || item.type !== 'join-introduction' ||
        typeof item.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.eventId) ||
        typeof item.conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.conversationId) ||
        typeof item.senderAddress !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.senderAddress) ||
        typeof item.identityCommitment !== 'string' || item.identityCommitment.length < 8 || item.identityCommitment.length > 128 ||
        !Number.isSafeInteger(item.createdAt) ||
        typeof item.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(item.signature)) {
        throw new Error('Join introduction is invalid.');
    }
    return item as JoinIntroduction;
};

const parseJoinIntroductionRecord = (bytes: ArrayBuffer | undefined): JoinIntroductionRecord | undefined => {
    if (!bytes) return undefined;
    let value: unknown;
    try { value = JSON.parse(decoder.decode(bytes)); } catch { throw new Error('Saved join introduction is invalid.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved join introduction is invalid.');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['version', 'recipientAddress', 'recipientIdentityCommitment', 'envelope', 'clientId', 'senderOrigin', 'roomMessageVersion'].includes(key)) ||
        item.version !== 1 || typeof item.recipientAddress !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.recipientAddress) ||
        typeof item.recipientIdentityCommitment !== 'string' || item.recipientIdentityCommitment.length < 8 || item.recipientIdentityCommitment.length > 128 ||
        (item.envelope !== undefined && firstMessage(item.envelope as EncryptedEnvelope) === undefined) ||
        (item.clientId !== undefined && (typeof item.clientId !== 'string' || !item.clientId)) ||
        (item.roomMessageVersion !== undefined && item.roomMessageVersion !== 1) ||
        (item.senderOrigin !== undefined && !isSenderOriginMetadata(item.senderOrigin))) {
        throw new Error('Saved join introduction is invalid.');
    }
    return item as JoinIntroductionRecord;
};

/** Application-facing modern path; it uses the same relay transport and ACK callback as legacy chat. */
export class ModernConversation {
    private readonly runtime: VodozemacRuntime;
    private readonly registry: ContactIdentityRegistry;
    private readonly modes: ConversationModeStore;
    private readonly subscriptions: SubscriptionType = new Map();
    private readonly transportManager: TransportManager;
    private roomTransport?: RoomTransportChannel;
    private deliveryCoordinator?: DeliveryCoordinator;
    private readonly deliveryMutex = new AsyncMutex();
    private readonly receiveMutex = new AsyncMutex();
    private roomId?: string;
    private capability?: string;
    private remoteAddress?: string;
    private remoteIdentityCommitment?: string;
    private joinIntroductionPending = false;
    private lastInboundFailureCategory?: string;
    private lastConnectionFailureCategory?: string;
    private sessionHealth: 'healthy' | 'unhealthy' | 'renewal-pending' = 'healthy';
    private sessionHealthObserver?: (health: 'healthy' | 'unhealthy' | 'renewal-pending') => void;
    private inboundDiagnosticEvents: InboundDiagnosticEvent[] = [];
    /** A replay can arrive while connect() owns the conversation tab lock. */
    private connecting = false;
    private readonly inboundLockAbort = new AbortController();
    private localAddress?: string;
    private localIdentityId?: string;
    private userScope?: string;
    private localDeviceId?: string;
    private callComposition?: AuthenticatedCallComposition;
    private callSignalTransport?: AuthenticatedCallComposition['signalTransport'];
    private deviceControlChannel?: AuthenticatedDeviceControlChannel;
    private deviceLifecycle?: DeviceLifecycleService;
    private deviceLifecyclePersistence?: SecureStorageDeviceLifecyclePersistence;
    private deviceTrust?: DeviceTrustEnforcer;
    private trustEvents?: TrustStateEventCoordinator;
    private trustEpoch?: number;
    private syncController?: RuntimeSyncController;
    private deliveryObserver?: (clientId: string, state: 'accepted' | 'rejected' | 'held') => void;
    private syncRelay?: SocketSyncRelay;
    private groupAdapter?: SecureStorageGroupRuntimeAdapter;
    private groupRuntime?: GroupSecurityRuntime;
    private recoveryRuntime?: RecoveryRuntime;
    private durableProofs?: DeviceProofClient;
    private retryTimer?: ReturnType<typeof setInterval>;
    private onMessage?: (text: string, envelopeId: string) => InboundMessageAcceptancePlan | Promise<InboundMessageAcceptancePlan>;
    private onContactChange?: (contact: StoredContactIdentity) => void | Promise<void>;
    private onDeviceControl?: (message: DeviceControlEvent) => void;
    private readonly tabOwnerId = `${Math.random().toString(36).slice(2)}-${Date.now()}`;
    private fallbackLeaseKey?: string;
    private fallbackLeaseTimer?: ReturnType<typeof setInterval>;
    private unloadHandler?: () => void;

    constructor(private readonly storage: SecureStorage, loader: VodozemacBindingsLoader, transportManager?: TransportManager) {
        this.runtime = new VodozemacRuntime(storage, loader);
        this.registry = new ContactIdentityRegistry(storage);
        this.modes = new ConversationModeStore(storage);
        const relay = transportManager ? undefined : new SocketIoRelayTransport(() => this.subscriptions, new Logger('ModernConversation'),
            async (message) => {
                if (!this.roomId || message.conversationId !== this.roomId) throw new Error('Inbound relay event is not bound to this room.');
                if (message.channel === 'signaling') {
                    testOnlyCallSignalStage('signal-received');
                    try {
                        if (this.sessionHealth === 'unhealthy') throw new Error('signaling_session_unhealthy');
                        await this.assertCurrentDeviceTrust();
                        testOnlyCallSignalStage('trust-check-passed');
                        this.prepareDeviceControl();
                        if (this.deviceControlChannel) {
                            testOnlyCallSignalStage('signal-decrypt-started');
                            const plaintext = await this.runtime.decrypt('signaling', message.envelope);
                            testOnlyCallSignalStage('signal-decrypted');
                            const control = this.deviceControlChannel.decode(plaintext);
                            if (control) await this.handleDeviceControl(control);
                            else if (this.callSignalTransport) {
                                await this.callSignalTransport.receivePlaintext(plaintext);
                                testOnlyCallSignalStage('call-signal-accepted');
                            } else testOnlyCallSignalStage('call-listener-unavailable');
                        } else if (this.callSignalTransport) {
                            testOnlyCallSignalStage('signal-decrypt-started');
                            await this.callSignalTransport.receive(message.envelope);
                            testOnlyCallSignalStage('signal-decrypted');
                            testOnlyCallSignalStage('call-signal-accepted');
                        } else testOnlyCallSignalStage('call-listener-unavailable');
                    } catch {
                        testOnlyCallSignalStage('signal-handler-rejected');
                        throw new Error('Authenticated signaling receive failed.');
                    }
                    return false;
                }
                return this.decideInbound(message.envelope, message.senderRoutingId);
            });
        this.transportManager = transportManager ?? new DefaultTransportManager(relay!);
        this.subscriptions.set('on-alice-join', new Set([() => {
            void this.retryPending();
            void this.retryJoinIntroduction();
        }]));
        this.subscriptions.set('delivered', new Set([(id: string) => { void this.acceptDelivery(id); }]));
        this.subscriptions.set('not-accepted', new Set([(id: string) => { void this.rejectDelivery(id); }]));
    }

    private get transport(): TransportManager {
        if (!this.roomTransport) throw new Error('Conversation room transport is not bound.');
        return this.roomTransport;
    }

    private get delivery(): DeliveryCoordinator {
        if (!this.deliveryCoordinator) throw new Error('Conversation room delivery is not bound.');
        return this.deliveryCoordinator;
    }

    public async connect(roomId: string, capability: string, remoteAddress?: string, remoteIdentityCommitment?: string, onMessage?: (text: string, envelopeId: string) => InboundMessageAcceptancePlan | Promise<InboundMessageAcceptancePlan>, onContactChange?: (contact: StoredContactIdentity) => void | Promise<void>, onDeviceControl?: (message: DeviceControlEvent) => void, options?: { sendJoinIntroduction?: boolean }): Promise<ModernConnectionDetails> {
        const details = await this.withTabLock(roomId, async () => {
            this.connecting = true;
            try {
                return await this.connectUnlocked(roomId, capability, remoteAddress, remoteIdentityCommitment, onMessage, onContactChange, onDeviceControl, options);
            }
            finally { this.connecting = false; }
        }, true);
        const activeTransport = this.transport.activeTransport();
        if (this.sessionHealth !== 'unhealthy' && activeTransport instanceof SocketIoRelayTransport) await activeTransport.requestMailboxReplay();
        return details;
    }

    private async connectUnlocked(roomId: string, capability: string, remoteAddress?: string, remoteIdentityCommitment?: string, onMessage?: (text: string, envelopeId: string) => InboundMessageAcceptancePlan | Promise<InboundMessageAcceptancePlan>, onContactChange?: (contact: StoredContactIdentity) => void | Promise<void>, onDeviceControl?: (message: DeviceControlEvent) => void, options?: { sendJoinIntroduction?: boolean }): Promise<ModernConnectionDetails> {
        if (!/^[0-9a-f-]{36}$/i.test(roomId) || !capability) throw new Error('Invalid private conversation invitation.');
        if (this.roomId && this.roomId !== roomId) throw new Error('A ModernConversation cannot change its bound room.');
        this.roomId = roomId;
        this.roomTransport ??= new RoomTransportChannel(roomId, this.transportManager);
        this.deliveryCoordinator ??= new DeliveryCoordinator(new RelayPathAdapter(this.roomTransport));
        this.sessionHealth = 'healthy';
        this.lastConnectionFailureCategory = undefined;
        this.capability = capability;
        this.remoteIdentityCommitment = remoteIdentityCommitment;
        let introductionRecord = parseJoinIntroductionRecord(await this.storage.read(JOIN_INTRODUCTION_RECORD, roomId));
        if (options?.sendJoinIntroduction && remoteAddress && remoteIdentityCommitment) {
            if (introductionRecord && (introductionRecord.recipientAddress !== remoteAddress || introductionRecord.recipientIdentityCommitment !== remoteIdentityCommitment)) {
                throw new Error('Saved join introduction does not match this invitation.');
            }
            introductionRecord ??= { version: 1, recipientAddress: remoteAddress, recipientIdentityCommitment: remoteIdentityCommitment };
            await this.storage.write(JOIN_INTRODUCTION_RECORD, roomId, asBytes(introductionRecord));
        }
        this.joinIntroductionPending = Boolean(introductionRecord);
        this.onMessage = onMessage;
        this.onContactChange = onContactChange;
        this.onDeviceControl = onDeviceControl;
        await this.runtime.initialize();
        const own = await this.runtime.restoreOrCreateIdentity();
        this.localIdentityId = own.identityId;
        const publicationBytes = await this.storage.read(PUBLICATION_RECORD, 'local');
        const publication = publicationBytes ? JSON.parse(decoder.decode(publicationBytes)) as PublicationMarker : undefined;
        if (publication && (publication.version !== 1 || !publication.address || publication.roomId !== roomId)) {
            throw new Error('A previous key publication has an uncertain outcome. This identity cannot publish again automatically.');
        }
        let saved = await this.modes.read(roomId);
        const renewal = parseSessionRenewal(await this.storage.read(SESSION_RENEWAL_RECORD, roomId));
        if (renewal) this.sessionHealth = 'renewal-pending';
        if (!saved?.sessionId) await this.cleanupRetiredSession(roomId);
        if (saved?.sessionId && await this.auditAndMigratePersistedSession(roomId, saved.sessionId)) {
            saved = await this.modes.read(roomId);
        }
        const requestedContact = remoteAddress === saved?.localAddress ? undefined : remoteAddress;
        if (saved?.remoteAddress && requestedContact && saved.remoteAddress !== requestedContact) throw new Error('The contact address changed. Review the connection before continuing.');
        this.remoteAddress = requestedContact ?? saved?.remoteAddress;
        if (saved?.sessionId) {
            try { await this.runtime.restoreSession(roomId, saved.sessionId); }
            catch (error) {
                const category = error && typeof error === 'object' && 'restoreFailureCategory' in error
                    ? (error as { restoreFailureCategory?: unknown }).restoreFailureCategory : undefined;
                if (category !== 'session-record-missing') throw error;
                this.sessionHealth = 'unhealthy';
            }
        }
        if (this.remoteAddress && saved?.sessionId) {
            let contactBundle;
            try { contactBundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress)); }
            catch (error) { this.lastConnectionFailureCategory = 'prekey-session-lookup-failure'; throw error; }
            try { await this.observe(this.remoteAddress, contactBundle.identity, remoteIdentityCommitment); }
            catch (error) { this.lastConnectionFailureCategory = 'sender-identity-mismatch'; throw error; }
        }

        let localAddress = saved?.localAddress ?? publication?.address;
        let routingProof = saved?.routingProof ?? publication?.routingProof;
        if (localAddress) {
            try { await fetchVodozemacBundle(roomId, capability, localAddress); }
            catch { throw new Error('This private invitation expired. Create a fresh conversation to continue.'); }
            const localBundle = await this.runtime.getPublicBundle();
            if (localBundle.oneTimeKeys.length < 10) {
                try {
                    await this.runtime.replenishOneTimeKeys(20);
                    if (!saved?.routingProof) throw new Error('Pre-key ownership proof is unavailable.');
                    await renewVodozemacBundle(roomId, capability, localAddress, saved.routingProof, await this.runtime.getPublicBundle());
                    await this.runtime.markPublicKeysPublished();
                } catch {
                    // Renewal is availability work. Keep the existing identity/session usable and retry on a later open.
                }
            }
        }
        if (!localAddress) {
            const ownBundle = await this.runtime.getPublicBundle();
            if (ownBundle.oneTimeKeys.length === 0) await this.runtime.replenishOneTimeKeys();
            await this.storage.write(PUBLICATION_RECORD, 'local', asBytes({ version: 1, roomId }));
            const published = await publishVodozemacBundle(roomId, capability, await this.runtime.getPublicBundle());
            localAddress = published.address;
            routingProof = published.renewalProof;
            await this.storage.write(PUBLICATION_RECORD, 'local', asBytes({ version: 1, roomId, address: localAddress, routingProof: published.renewalProof }));
        }
        if (publication || !saved?.localAddress) {
            if (!routingProof) throw new Error('Modern routing ownership proof is unavailable.');
            await this.modes.write(roomId, { localAddress, remoteAddress: this.remoteAddress, sessionId: saved?.sessionId, routingProof });
            await this.runtime.markPublicKeysPublished();
            await this.storage.delete(PUBLICATION_RECORD, 'local');
        }
        const currentMode = await this.modes.read(roomId);
        routingProof = currentMode?.routingProof ?? routingProof;
        await this.modes.write(roomId, { localAddress, remoteAddress: this.remoteAddress, sessionId: saved?.sessionId, routingProof });
        this.localAddress = localAddress;

        this.deviceLifecyclePersistence = new SecureStorageDeviceLifecyclePersistence(this.storage);
        const legacyDeviceList = await this.deviceLifecyclePersistence.read(this.localIdentityId);
        const existingBinding = await this.storage.read('device-account-binding', 'local');
        let binding = await loadAccountBinding(this.storage, this.localIdentityId, legacyDeviceList);
        let bootstrapEpoch = 0;
        if (!existingBinding) {
            const bundle = await this.runtime.getPublicBundle();
            const bootstrapped = await bootstrapFirstDevice(
                { signControlEvent: (payload) => this.runtime.signControlEvent(payload) },
                { deviceId: binding.deviceId, deviceIdentityReference: this.localIdentityId, verificationKey: bundle.identity.ed25519, fingerprint: this.localIdentityId },
            );
            binding = await adoptApprovedAccountBinding(this.storage, this.localIdentityId, bootstrapped.accountIdentityReference, bootstrapped.deviceId);
            bootstrapEpoch = bootstrapped.trustEpoch;
        }
        this.userScope = binding.userScope;
        this.localDeviceId = binding.deviceId;
        const existingDeviceList = await this.deviceLifecyclePersistence.read(binding.userScope);
        if (!existingDeviceList) {
            const initialList = createDeviceList({ version: 1, identityReference: binding.userScope, epoch: bootstrapEpoch, previousCommitment: null,
                devices: [createDeviceEntry({ deviceId: binding.deviceId, publicIdentityReference: this.localIdentityId, algorithm: 'Olm-Curve25519+Ed25519', state: 'active', createdAt: Date.now() })] });
            await this.deviceLifecyclePersistence.initialize(binding.userScope, initialList);
        }
        this.deviceTrust = new DeviceTrustEnforcer(this.deviceLifecyclePersistence, binding.userScope, binding.deviceId, this.localIdentityId);
        const trustSnapshot = await this.deviceTrust.snapshot();
        await this.deviceTrust.assertTrustedAt(trustSnapshot.list.epoch);
        this.configureFreshnessFrom(trustSnapshot);
        this.trustEpoch = trustSnapshot.list.epoch;
        this.trustEvents = new TrustStateEventCoordinator(this.deviceTrust, binding.userScope);
        this.prepareDeviceControl();
        this.syncController = new RuntimeSyncController(
            binding.userScope,
            binding.deviceId,
            this.deviceTrust,
            new SecureSyncPersistence(this.storage),
        );
        await this.syncController.recover();

        if (this.remoteAddress && !saved?.sessionId) {
            // Validate and pin the invitation identity during join, but defer
            // claiming a peer one-time key until this device actually sends.
            // Otherwise both peers can independently create outbound Olm
            // sessions before the first message, and the first inbound
            // pre-key message is incorrectly routed to an unrelated session.
            let contact;
            try { contact = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress)); }
            catch (error) { this.lastConnectionFailureCategory = 'prekey-session-lookup-failure'; throw error; }
            try { await this.observe(this.remoteAddress, contact.identity, remoteIdentityCommitment); }
            catch (error) { this.lastConnectionFailureCategory = 'sender-identity-mismatch'; throw error; }
        }
        this.prepareDeviceControl();

        const activeTransport = this.transport.activeTransport();
        if (activeTransport instanceof SocketIoRelayTransport) {
            this.durableProofs = new DeviceProofClient(
                { signControlEvent: (payload) => this.runtime.signControlEvent(payload) },
                async () => {
                    if (!this.userScope || !this.localDeviceId || !this.localIdentityId || this.trustEpoch === undefined) throw new Error('Device trust is unavailable.');
                    return { accountIdentityReference: this.userScope, deviceId: this.localDeviceId, deviceIdentityReference: this.localIdentityId, epoch: this.trustEpoch };
                },
            );
            activeTransport.setDeviceProofProvider(this.durableProofs);
        }
        if (!routingProof) throw new Error('Modern routing ownership proof is unavailable.');
        this.transport.activeTransport()?.setProtocolFeatures?.([JOIN_INTRODUCTION_FEATURE, ROOM_MESSAGE_V1_FEATURE]);
        await this.roomTransport!.connect(localAddress, capability, routingProof);
        if (this.joinIntroductionPending) await this.sendJoinIntroductionUnlocked();
        if (trustSnapshot.list.devices.filter((entry) => entry.state === 'active').length > 1) {
            void this.requestTrustRefresh().catch(() => undefined);
        }
        this.retryTimer = setInterval(() => { void this.retryPending(); }, 5000);
        const browserWindow = (globalThis as typeof globalThis & { window?: { addEventListener?: (event: string, handler: () => void) => void } }).window;
        if (browserWindow?.addEventListener) {
            this.unloadHandler = () => this.releaseFallbackLease();
            browserWindow.addEventListener('beforeunload', this.unloadHandler);
            browserWindow.addEventListener('pagehide', this.unloadHandler);
        }
        void this.retryPending();
        return { ownFingerprint: own.identityId, ownAddress: localAddress,
            contact: this.remoteAddress ? await this.registry.get(this.remoteAddress) : undefined };
    }

    public async getDeviceLifecycleState(): Promise<LifecycleStateSnapshot | undefined> {
        if (!this.deviceLifecyclePersistence || !this.userScope) return undefined;
        return this.deviceLifecyclePersistence.read(this.userScope);
    }

    public async getDeviceTrust(): Promise<DeviceTrustDecision> {
        if (!this.deviceTrust) return 'unavailable';
        return this.deviceTrust.decision();
    }

    /** Guarded test harness view containing only approved message lifecycle metadata. */
    public async testOnlyCryptoSnapshot(): Promise<{ conversationId?: string; inboundEvents: InboundDiagnosticEvent[]; inboundFailureCategory?: string; connectionFailureCategory?: string }> {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        return { conversationId: this.roomId, inboundEvents: [...this.inboundDiagnosticEvents], inboundFailureCategory: this.lastInboundFailureCategory, connectionFailureCategory: this.lastConnectionFailureCategory };
    }

    public async testOnlyRelayRegistration(): Promise<{ connected: boolean; joinAcknowledged: boolean; channelHash?: string }> {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        const transport = this.transport.activeTransport();
        if (!(transport instanceof SocketIoRelayTransport)) return { connected: false, joinAcknowledged: false };
        return await transport.testOnlyRelayRegistration();
    }

    private async testOnlyRecordInboundStage(stage: InboundDiagnosticStage, senderFingerprint?: string, failureCategory?: string): Promise<void> {
        if (!testDiagnosticsEnabled() || !this.roomId) return;
        try {
            const fingerprintHash = async (value?: string): Promise<string | undefined> => {
                if (!value || !globalThis.crypto?.subtle) return undefined;
                const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value));
                return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
            };
            this.inboundDiagnosticEvents.push({
                conversationId: this.roomId,
                stage,
                receiverFingerprintHash: await fingerprintHash(this.localIdentityId),
                senderFingerprintHash: await fingerprintHash(senderFingerprint),
                ...(failureCategory ? { failureCategory } : {}),
            });
            if (this.inboundDiagnosticEvents.length > 100) this.inboundDiagnosticEvents.splice(0, this.inboundDiagnosticEvents.length - 100);
        } catch {
            // Test diagnostics must never affect message acceptance.
        }
    }

    /** Short-lived request proof for the host's authenticated ciphertext attachment adapter. */
    public async attachmentAuthorizationHeaders(operation: import('../devices/deviceProofClient').DeviceProofOperation = 'attachment:read'): Promise<Record<string, string>> {
        await this.assertCurrentDeviceTrust();
        if (!this.roomId || !this.capability || !this.localAddress) throw new Error('Attachment authorization is unavailable.');
        const mode = await this.modes.read(this.roomId);
        if (!mode?.routingProof || mode.localAddress !== this.localAddress) throw new Error('Attachment ownership proof is unavailable.');
        if (!this.durableProofs) throw new Error('Attachment device proof unavailable.');
        const proof = await this.durableProofs.acquire(operation, { conversationId: this.roomId });
        return {
            'X-K3ncrypt-Device-Proof': toBase64Url(encoder.encode(JSON.stringify(proof.deviceAuthorizationProof))),
            'X-K3ncrypt-Device-Nonce': proof.proofNonce,
            'X-K3ncrypt-Conversation': this.roomId,
            'X-K3ncrypt-Participant': this.localAddress,
            'X-K3ncrypt-Control-Capability': this.capability,
            'X-K3ncrypt-Routing-Proof': mode.routingProof,
            'X-K3ncrypt-Request-Id': crypto.randomUUID(),
        };
    }

    /** File authority uses the same protected canonical contact record as explicit verification. */
    public async fileTransferBinding(requireVerified: boolean): Promise<import('../files/protocol').FileBinding> {
        await this.assertCurrentDeviceTrust();
        if (!this.roomId || !this.capability || !this.localAddress || !this.localIdentityId || !this.remoteAddress) throw new Error('File contact unavailable.');
        const bundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, this.remoteAddress));
        await this.observe(this.remoteAddress, bundle.identity, this.remoteIdentityCommitment);
        const contact = await this.registry.get(this.remoteAddress);
        if (!contact) throw Object.assign(new Error('Verified unchanged contact required.'), { safeDiagnosticCode: 'RECIPIENT_AUTHORITY_MISSING' });
        if (contact.changeStatus !== 'unchanged') throw Object.assign(new Error('Verified unchanged contact required.'), { safeDiagnosticCode: 'RECIPIENT_AUTHORITY_CHANGED' });
        if (requireVerified && contact.verification !== 'verified') throw Object.assign(new Error('Verified unchanged contact required.'), { safeDiagnosticCode: 'VERIFICATION_REQUIRED' });
        return { conversationId: this.roomId, senderParticipantId: this.localAddress, recipientParticipantId: this.remoteAddress, senderIdentityReference: this.localIdentityId, recipientIdentityReference: contact.identityId };
    }

    /** Configures the all-member freshness fence used by every protected operation. */
    public configureDeviceTrustFreshness(activeMemberDeviceIds: readonly string[]): void {
        if (!this.deviceTrust || activeMemberDeviceIds.length === 0) throw new Error('Device trust is unavailable.');
        this.deviceTrust.configureFreshnessMembers(activeMemberDeviceIds);
    }

    public async requestTrustRefresh(): Promise<void> {
        if (!this.deviceControlChannel || !this.userScope || !this.localDeviceId) throw new Error('Device trust refresh is unavailable.');
        await this.deviceControlChannel.send({ type: 'trust-state-request', payload: { version: 1, scope: this.userScope, requesterDeviceId: this.localDeviceId, requestedAt: Date.now() } });
    }

    public async requestDeviceEnrollment(input: { requestedDeviceId: string; requestedPublicIdentityReference: string; algorithm: string }): Promise<EnrollmentRequest> {
        this.prepareDeviceControl();
        if (!this.deviceControlChannel || !this.localIdentityId || !this.remoteAddress) throw new Error('Device enrollment requires a ready modern session.');
        await this.assertCurrentDeviceTrust();
        const state = await this.getDeviceLifecycleState();
        if (!state) throw new Error('Device lifecycle state unavailable.');
        const contact = await this.registry.get(this.remoteAddress);
        if (!contact || contact.verification !== 'verified' || contact.changeStatus !== 'unchanged' || contact.identityId !== input.requestedPublicIdentityReference) throw new Error('Enrollment target identity is not authenticated.');
        const request = createEnrollmentRequest({ ...input, userScope: this.userScope!, knownEpoch: state.list.epoch });
        const service = this.requireDeviceLifecycle();
        const authorization = await service.approveEnrollment(request, this.deviceContext(), { deviceId: input.requestedDeviceId, publicIdentityReference: input.requestedPublicIdentityReference });
        await this.submitDurableEnrollment(authorization, input.requestedDeviceId, input.requestedPublicIdentityReference);
        const approvedState = await service.applyEnrollment(authorization, this.deviceContext());
        await this.deviceControlChannel.send({ type: 'enrollment-approval', payload: { version: 1, authorization, approvedState } satisfies EnrollmentApprovalPacket });
        return request;
    }

    public async approveDeviceEnrollment(request: EnrollmentRequest, confirmedTarget: { deviceId: string; publicIdentityReference: string }): Promise<DeviceAuthorization> {
        await this.assertCurrentDeviceTrust();
        const service = this.requireDeviceLifecycle();
        const authorization = await service.approveEnrollment(request, this.deviceContext(), confirmedTarget);
        await this.submitDurableEnrollment(authorization, confirmedTarget.deviceId, confirmedTarget.publicIdentityReference);
        const approvedState = await service.applyEnrollment(authorization, this.deviceContext());
        await this.deviceControlChannel!.send({ type: 'enrollment-approval', payload: { version: 1, authorization, approvedState } satisfies EnrollmentApprovalPacket });
        return authorization;
    }

    public async confirmDeviceEnrollment(packet: EnrollmentApprovalPacket): Promise<LifecycleStateSnapshot> {
        if (!this.deviceLifecyclePersistence || !this.localIdentityId || !this.localDeviceId || !this.roomId) throw new Error('Device enrollment requires a ready target device.');
        const authorization = packet.authorization;
        if (authorization.targetDeviceId !== this.localDeviceId || authorization.targetPublicIdentityReference !== this.localIdentityId) throw new Error('Enrollment target mismatch.');
        const targetContext = new DeviceContextAuthority(this.runtime.getAuthenticatedSession(), this.roomId,
            { deviceId: this.localDeviceId, identityReference: this.localIdentityId, userScope: authorization.userScope, verified: true }).localContext();
        const targetLifecycle = new DeviceLifecycleService(this.deviceLifecyclePersistence, { verify: async () => { throw new Error('Target device cannot issue enrollment approval.'); } });
        const joined = await new AuthenticatedDeviceJoinService(targetLifecycle, this.storage, this.deviceLifecyclePersistence).confirmApproval(packet, targetContext);
        this.userScope = joined.binding.userScope;
        this.localDeviceId = joined.binding.deviceId;
        this.deviceLifecycle = targetLifecycle;
        this.deviceTrust = new DeviceTrustEnforcer(this.deviceLifecyclePersistence, this.userScope, this.localDeviceId, this.localIdentityId);
        this.trustEvents = new TrustStateEventCoordinator(this.deviceTrust, this.userScope);
        this.configureFreshnessFrom(joined.state);
        const author = joined.state.list.devices.find((entry) => entry.deviceId === authorization.authorDeviceId);
        if (!author || author.state !== 'active') throw new Error('Enrollment issuer unavailable.');
        await this.deviceTrust.recordFreshnessEvidence({ version: 1, deviceId: author.deviceId, identityReference: author.publicIdentityReference, epoch: joined.state.list.epoch, commitment: joined.state.commitment, evidenceId: `enrollment:${joined.confirmation.confirmationDigest}` });
        this.trustEpoch = joined.state.list.epoch;
        await this.activateDurableEnrollment();
        await this.deviceControlChannel!.send({ type: 'enrollment-confirmation', payload: { authorization, confirmation: joined.confirmation } });
        return joined.state;
    }

    /** Target-side account joining: confirmation also installs the public lifecycle state and account namespace. */
    public async confirmDeviceEnrollmentAsAccountMember(authorization: DeviceAuthorization, targetStorage: SecureStorage, targetPersistence: import('../devices/lifecycle').DeviceLifecyclePersistence): Promise<LifecycleStateSnapshot> {
        await this.assertCurrentDeviceTrust();
        if (!this.deviceLifecycle || !this.userScope) throw new Error('Device lifecycle requires a ready modern session.');
        const joined = await new AuthenticatedDeviceJoinService(this.deviceLifecycle, targetStorage, targetPersistence).confirm(authorization, this.deviceContext());
        return joined.state;
    }

    public async rejectDeviceEnrollment(request: EnrollmentRequest): Promise<void> {
        if (!this.deviceControlChannel) throw new Error('Device enrollment requires a ready modern session.');
        await this.assertCurrentDeviceTrust();
        await this.deviceControlChannel.send({ type: 'enrollment-rejection', payload: { version: 1, transactionNonce: request.transactionNonce, expiresAt: request.expiresAt } });
    }

    public async revokeDevice(deviceId: string): Promise<DeviceAuthorization> {
        await this.assertCurrentDeviceTrust();
        const service = this.requireDeviceLifecycle();
        const authorization = await service.approveRevocation(deviceId, this.deviceContext());
        await this.deviceControlChannel!.send({ type: 'revocation', payload: authorization });
        const confirmation = await createRevocationConfirmation({ version: 1, authorizationDigest: authorization.authorizationDigest,
            targetDeviceId: authorization.targetDeviceId, confirmationNonce: `${authorization.transactionNonce}-confirm`, confirmedAt: Date.now(), expiresAt: authorization.expiresAt });
        const next = await service.applyRevocation(authorization, this.deviceContext(), confirmation);
        await this.deviceControlChannel!.send({ type: 'trust-state-snapshot', payload: { version: 1, state: next } });
        const target = next.list.devices.find((entry) => entry.deviceId === authorization.targetDeviceId);
        if (target && (target.state === 'active' || target.state === 'revoked')) {
            await this.deviceControlChannel!.send({ type: 'trust-state', payload: {
                version: 1, eventId: `${authorization.transactionNonce}:${next.list.epoch}`, scope: this.userScope!,
                epoch: next.list.epoch, commitment: next.commitment, deviceId: target.deviceId,
                identityReference: target.publicIdentityReference, state: target.state, createdAt: Date.now(),
            } satisfies TrustStateEvent });
        }
        this.configureFreshnessFrom(next);
        return authorization;
    }

    public async send(text: string): Promise<'pending'> {
        await this.sendWithReceipt(text);
        return 'pending';
    }

    public async sendWithReceipt(
        text: string,
        prepareHistoryUpdate?: (clientId: string) => Promise<SecureRecordUpdate>,
        supersedeHeldClientId?: string,
    ): Promise<string> {
        if (this.roomId) {
            const clientId = await this.withTabLock(this.roomId, () => this.sendUnlocked(text, prepareHistoryUpdate, supersedeHeldClientId));
            // Durable encrypted enqueue is the acceptance boundary. Relay I/O
            // must not retain the room lock and block another conversation
            // instance from restoring the same room.
            try { await this.retryPending(); } catch { /* Reconnect retries the committed ciphertext. */ }
            return clientId;
        }
        throw new Error('The private contact is not ready.');
    }

    public onDeliveryUpdate(observer: (clientId: string, state: 'accepted' | 'rejected' | 'held') => void): void { this.deliveryObserver = observer; }

    /** Observe the existing relay presence event to release active media when a peer leaves. */
    public onPeerDisconnect(observer: () => void): () => void {
        const listeners = this.subscriptions.get('on-alice-disconnect') ?? new Set<Function>();
        listeners.add(observer);
        this.subscriptions.set('on-alice-disconnect', listeners);
        return () => {
            listeners.delete(observer);
            if (listeners.size === 0) this.subscriptions.delete('on-alice-disconnect');
        };
    }

    private async sendUnlocked(text: string, prepareHistoryUpdate?: (clientId: string) => Promise<SecureRecordUpdate>, supersedeHeldClientId?: string): Promise<string> {
        if (this.sessionHealth === 'unhealthy') throw new Error('The encrypted session needs verified renewal before sending.');
        if (!this.roomId || !text.trim()) throw new Error('The private contact is not ready.');
        if (encoder.encode(text).byteLength > MAX_USER_MESSAGE_UTF8_BYTES) throw new Error(`Messages can be up to ${MAX_USER_MESSAGE_UTF8_BYTES.toLocaleString()} UTF-8 bytes.`);
        testOnlyDeliveryStage('send-start');
        await this.assertCurrentDeviceTrust();
        const contact = await this.getContact();
        if (contact?.changeStatus !== 'unchanged') throw new Error('Review this contact’s changed identity before sending.');
        const rawPayload = encoder.encode(text);
        if (startsWithBytes(rawPayload, JOIN_INTRODUCTION_MAGIC) ||
            (!this.transport.activeTransport()?.peerSupportsFeature?.(ROOM_MESSAGE_V1_FEATURE) && text.startsWith(`${ROOM_MESSAGE_V1_DOMAIN}\0`))) {
            throw new Error('This message begins with a reserved protocol marker and cannot be sent as plain text.');
        }
        let fileReference;
        try { fileReference = text.startsWith('k3ncrypt-file-') ? parseFileReference(text) : undefined; }
        catch { throw new Error('This text uses the reserved protected-file marker but is not a valid file reference.'); }
        if (fileReference && (!sameBinding(await this.fileTransferBinding(true), fileReference.context) || fileReference.expiresAt <= Date.now())) throw new Error('File identity binding rejected.');
        const sessionSetup = await this.prepareOutboundSession();
        const clientId = crypto.randomUUID();
        await this.deliveryMutex.runExclusive(async () => {
            const encoded = await this.encodeOutboundMessage(text, clientId, fileReference ? 'attachment-reference' : 'text');
            const { plaintext, roomMessageVersion } = encoded;
            try {
                await this.runtime.encryptAndCommitOutbound('message', plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer,
                    async (envelope, sessionId) => {
                        testOnlyDeliveryStage('envelope-created');
                        const outboxBytes = await this.storage.read(OUTBOX_RECORD, this.roomId!);
                        const pending = parseList<PendingEnvelope>(outboxBytes);
                        if (pending.some((item) => item.clientId === clientId)) throw new Error('The sender message identifier already exists.');
                        if (supersedeHeldClientId) {
                            const held = pending.find((item) => item.clientId === supersedeHeldClientId && item.heldNotSentSecurely === true);
                            if (!held || !roomMessageVersion || fileReference) throw new Error('Held message cannot be safely retried in the current room.');
                        }
                        const nextPending = pending.filter((item) => item.clientId !== supersedeHeldClientId);
                        if (nextPending.length >= MAX_PENDING) throw new Error('Too many messages are waiting to send.');
                        nextPending.push({ envelope, clientId, senderOrigin: SENDER_ORIGIN, ...(roomMessageVersion ? { roomMessageVersion } : {}), recipientIdentityReference: contact.identityId });
                        const updates: SecureRecordUpdate[] = [
                            { recordType: OUTBOX_RECORD, recordId: this.roomId!, expected: outboxBytes, next: asBytes(nextPending) },
                        ];
                        const floorGuard = await prepareRoomMessageVersionFloorGuard(this.storage, this.roomId!, contact.identityId);
                        if (floorGuard.floor >= 1 && roomMessageVersion === undefined) {
                            throw new Error('This contact requires room-message-v1; retry to create a new secure message.');
                        }
                        updates.push(floorGuard.update);
                        if (sessionSetup) {
                            updates.push(await this.modes.prepareWrite(this.roomId!, { sessionId, remoteAddress: this.remoteAddress }));
                            const auditBytes = await this.storage.read(SESSION_AUDIT_RECORD, this.roomId!);
                            updates.push({ recordType: SESSION_AUDIT_RECORD, recordId: this.roomId!, expected: auditBytes,
                                next: asBytes({ version: 1, classification: 'active-established', direction: 'outbound', origin: 'first-message' } satisfies SessionAudit) });
                        }
                        if (this.sessionHealth === 'renewal-pending') {
                            const renewalBytes = await this.storage.read(SESSION_RENEWAL_RECORD, this.roomId!);
                            const renewal = parseSessionRenewal(renewalBytes);
                            if (!renewal) throw new Error('Verified renewal state is unavailable.');
                            updates.push({ recordType: SESSION_RENEWAL_RECORD, recordId: this.roomId!, expected: renewalBytes,
                                next: asBytes({ ...renewal, clientId } satisfies SessionRenewal) });
                        }
                        if (fileReference) updates.push(...await this.registry.prepareVerifiedFileGuards(this.remoteAddress!, fileReference.context.recipientIdentityReference));
                        if (prepareHistoryUpdate) updates.push(await prepareHistoryUpdate(clientId));
                        return updates;
                    }, sessionSetup ? { conversationId: this.roomId!, ...sessionSetup } : undefined);
            } finally { plaintext.fill(0); }
        });
        if (sessionSetup) this.lastConnectionFailureCategory = undefined;
        return clientId;
    }

    private async encodeOutboundMessage(text: string, eventId: string, kind: RoomMessageKind): Promise<{ plaintext: Uint8Array; roomMessageVersion?: 1 }> {
        const transport = this.transport.activeTransport();
        const peerSupportsV1 = Boolean(transport?.peerSupportsFeature?.(ROOM_MESSAGE_V1_FEATURE));
        const contact = await this.getContact();
        const latchedFloor = this.roomId && contact?.identityId
            ? await readRoomMessageVersionFloor(this.storage, this.roomId, contact.identityId) : 0;
        if (latchedFloor > 1) throw new Error('This contact requires a newer secure message format.');
        if (transport?.requiresRoomMessageV1 && !peerSupportsV1 && latchedFloor < 1) throw new Error('The multiplexed transport requires peer room-message-v1 support.');
        if (!peerSupportsV1 && !transport?.requiresRoomMessageV1 && latchedFloor < 1) return { plaintext: encoder.encode(text) };
        if (!this.roomId || !this.localIdentityId || !contact?.identityId || contact.changeStatus !== 'unchanged') {
            throw new Error('Stable identities are required for room-bound message delivery.');
        }
        return { plaintext: encodeRoomMessageV1({
            roomId: this.roomId,
            senderIdentityReference: this.localIdentityId,
            recipientIdentityReference: contact.identityId,
            eventId,
            kind,
            payload: encoder.encode(text),
        }), roomMessageVersion: 1 };
    }

    /** Fetches and verifies first-send material without advancing or persisting the local account. */
    private async prepareOutboundSession(): Promise<Omit<OutboundSessionInitialization, 'conversationId'> | undefined> {
        if (this.sessionHealth === 'unhealthy') throw new Error('The encrypted session needs verified renewal before sending.');
        if (this.runtime.activeSessionId) return undefined;
        if (!this.roomId || !this.capability || !this.remoteAddress) throw new Error('The private contact is not ready.');
        let contact;
        try { contact = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, this.remoteAddress)); }
        catch (error) { this.lastConnectionFailureCategory = 'prekey-session-lookup-failure'; throw error; }
        try { await this.observe(this.remoteAddress, contact.identity, this.remoteIdentityCommitment); }
        catch (error) { this.lastConnectionFailureCategory = 'sender-identity-mismatch'; throw error; }
        if (contact.oneTimeKeys.length === 0) {
            this.lastConnectionFailureCategory = 'prekey-session-lookup-failure';
            throw new Error('The contact has no available invitation keys.');
        }
        let claimed;
        try { claimed = await claimVodozemacOneTimeKey(this.roomId, this.capability, this.remoteAddress, contact.oneTimeKeys[0].id); }
        catch (error) { this.lastConnectionFailureCategory = 'prekey-session-lookup-failure'; throw error; }
        if (claimed.key !== contact.oneTimeKeys[0].key) {
            this.lastConnectionFailureCategory = 'prekey-session-lookup-failure';
            throw new Error('The claimed invitation key changed.');
        }
        return { recipientIdentityKey: contact.identity.curve25519, recipientOneTimeKey: claimed.key };
    }

    private async retryJoinIntroduction(): Promise<void> {
        if (!this.roomId || !this.joinIntroductionPending) return;
        try {
            await this.withTabLock(this.roomId, () => this.sendJoinIntroductionUnlocked());
        } catch {
            // The persisted encrypted introduction is retried after the next
            // authenticated peer-presence event or conversation restore.
        }
    }

    private async sendJoinIntroductionUnlocked(): Promise<void> {
        if (!this.joinIntroductionPending || !this.roomId || !this.remoteAddress || !this.capability) return;
        const transport = this.transport.activeTransport();
        if (!transport?.peerSupportsFeature?.(JOIN_INTRODUCTION_FEATURE)) return;

        let record = parseJoinIntroductionRecord(await this.storage.read(JOIN_INTRODUCTION_RECORD, this.roomId));
        if (!record || record.recipientAddress !== this.remoteAddress || record.recipientIdentityCommitment !== this.remoteIdentityCommitment) return;
        const contact = await this.getContact();
        const floor = this.roomId && contact?.identityId ? await readRoomMessageVersionFloor(this.storage, this.roomId, contact.identityId) : 0;
        if (floor > 1) throw new Error('This contact requires a newer secure message format.');
        if (floor >= 1 && record.envelope && record.roomMessageVersion !== 1) return;
        if (transport.requiresRoomMessageV1 && record.envelope && record.roomMessageVersion !== 1) {
            throw new Error('A legacy join introduction cannot be sent over a room-message-v1-required transport.');
        }
        if (transport.requiresRoomMessageV1 && !transport.peerSupportsFeature?.(ROOM_MESSAGE_V1_FEATURE) && floor < 1) {
            throw new Error('The multiplexed transport requires peer room-message-v1 support.');
        }
        if (!record.envelope) {
            await this.assertCurrentDeviceTrust();
            const sessionSetup = await this.prepareOutboundSession();
            const unsigned: Omit<JoinIntroduction, 'signature'> = {
                version: 1,
                type: 'join-introduction',
                eventId: crypto.randomUUID(),
                conversationId: this.roomId,
                senderAddress: this.localAddress!,
                identityCommitment: this.localIdentityId!,
                createdAt: Date.now(),
            };
            const event: JoinIntroduction = {
                ...unsigned,
                signature: await this.runtime.signControlEvent(canonicalJoinIntroduction(unsigned)),
            };
            const introductionPayload = new Uint8Array(encodeJoinIntroduction(event));
            const contact = await this.getContact();
            const usesRoomMessageV1 = Boolean(transport.peerSupportsFeature?.(ROOM_MESSAGE_V1_FEATURE) || transport.requiresRoomMessageV1 || floor >= 1);
            if (usesRoomMessageV1 && (!this.localIdentityId || !contact?.identityId || contact.changeStatus !== 'unchanged')) {
                throw new Error('Stable identities are required for room-bound message delivery.');
            }
            const plaintext = usesRoomMessageV1
                ? encodeRoomMessageV1({
                    roomId: this.roomId,
                    senderIdentityReference: this.localIdentityId!,
                    recipientIdentityReference: contact!.identityId,
                    eventId: event.eventId,
                    kind: 'join-introduction',
                    payload: introductionPayload,
                })
                : introductionPayload;
            let envelope: EncryptedEnvelope;
            try { envelope = await this.runtime.encryptAndCommitOutbound('message', plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer, async (exactEnvelope, sessionId) => {
                const recordBytes = await this.storage.read(JOIN_INTRODUCTION_RECORD, this.roomId!);
                const current = parseJoinIntroductionRecord(recordBytes);
                if (!current || current.recipientAddress !== this.remoteAddress || current.recipientIdentityCommitment !== this.remoteIdentityCommitment || current.envelope) {
                    throw new Error('Saved join introduction changed before it could be committed.');
                }
                const next: JoinIntroductionRecord = { ...current, clientId: event.eventId, envelope: exactEnvelope, senderOrigin: SENDER_ORIGIN,
                    ...(usesRoomMessageV1 ? { roomMessageVersion: 1 as const } : {}) };
                const updates: SecureRecordUpdate[] = [
                    { recordType: JOIN_INTRODUCTION_RECORD, recordId: this.roomId!, expected: recordBytes, next: asBytes(next) },
                ];
                if (sessionSetup) {
                    updates.push(await this.modes.prepareWrite(this.roomId!, { sessionId, remoteAddress: this.remoteAddress }));
                    const auditBytes = await this.storage.read(SESSION_AUDIT_RECORD, this.roomId!);
                    updates.push({ recordType: SESSION_AUDIT_RECORD, recordId: this.roomId!, expected: auditBytes,
                        next: asBytes({ version: 1, classification: 'active-established', direction: 'outbound', origin: 'join' } satisfies SessionAudit) });
                }
                return updates;
            }, sessionSetup ? { conversationId: this.roomId, ...sessionSetup } : undefined); }
            finally {
                introductionPayload.fill(0);
                if (plaintext !== introductionPayload) plaintext.fill(0);
            }
            record = { ...record, clientId: event.eventId, envelope, senderOrigin: SENDER_ORIGIN,
                ...(usesRoomMessageV1 ? { roomMessageVersion: 1 as const } : {}) };
        }
        await this.assertCurrentDeviceTrust();
        if (!record.envelope) throw new Error('Saved join introduction ciphertext is unavailable.');
        await this.delivery.submit(record.envelope, this.remoteAddress);
    }

    public async retryPending(): Promise<void> {
        if (this.sessionHealth === 'unhealthy') return;
        if (!this.roomId) return;
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            const contact = await this.getContact();
            const floor = this.roomId && contact?.identityId ? await readRoomMessageVersionFloor(this.storage, this.roomId, contact.identityId) : 0;
            const safePending = floor >= 1 ? await this.holdLegacyPending(pending) : pending;
            const renewal = this.sessionHealth === 'renewal-pending'
                ? parseSessionRenewal(await this.storage.read(SESSION_RENEWAL_RECORD, this.roomId!)) : undefined;
            await this.delivery.retry({
                pending: safePending,
                recipientRoutingId: this.remoteAddress,
                skip: (item) => Boolean(item.terminallyRejected || item.heldNotSentSecurely) || contact?.changeStatus !== 'unchanged' || !contact.identityId ||
                    item.recipientIdentityReference !== contact.identityId ||
                    (this.sessionHealth === 'renewal-pending' && item.clientId !== renewal?.clientId) ||
                    (this.transport.activeTransport()?.requiresRoomMessageV1 === true && item.roomMessageVersion !== 1),
                beforeSubmit: async () => {
                    await this.assertCurrentDeviceTrust();
                    const current = await this.getContact();
                    if (current?.changeStatus !== 'unchanged' || !current.identityId || current.identityId !== contact?.identityId) {
                        throw new Error('Review this contact’s changed identity before sending queued messages.');
                    }
                    testOnlyDeliveryStage('relay-dispatch');
                },
                persist: async (nextPending) => this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(nextPending)),
                onTerminalRejection: (item) => {
                    item.terminallyRejected = true;
                    if (item.clientId) this.deliveryObserver?.(item.clientId, item.heldNotSentSecurely ? 'held' : 'rejected');
                },
            });
        });
    }

    /** Legacy ciphertext is durably held before any retry can submit it after the floor is raised. */
    private async holdLegacyPending(pending: PendingEnvelope[]): Promise<PendingEnvelope[]> {
        if (!this.roomId) return pending;
        let current = pending;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const held = current.filter((item) => !item.roomMessageVersion && !item.heldNotSentSecurely && !item.terminallyRejected);
            if (held.length === 0) return current;
            const expected = await this.storage.read(OUTBOX_RECORD, this.roomId);
            current = parseList<PendingEnvelope>(expected);
            const next = current.map((item) => !item.roomMessageVersion && !item.terminallyRejected ? { ...item, heldNotSentSecurely: true as const } : item);
            if (!this.storage.compareAndSwapRecords) throw new Error('Atomic secure outbox hold is unavailable.');
            if (await this.storage.compareAndSwapRecords([{ recordType: OUTBOX_RECORD, recordId: this.roomId, expected, next: asBytes(next) }])) {
                next.filter((item) => item.heldNotSentSecurely && !current.some((prior) => prior.clientId === item.clientId && prior.heldNotSentSecurely))
                    .forEach((item) => { if (item.clientId) this.deliveryObserver?.(item.clientId, 'held'); });
                return next;
            }
            current = parseList<PendingEnvelope>(await this.storage.read(OUTBOX_RECORD, this.roomId));
        }
        throw new Error('Outbox changed too often to apply the secure hold.');
    }

    public async isHeldNotSentSecurely(clientId: string): Promise<boolean> {
        return (await this.readPending()).some((item) => item.clientId === clientId && item.heldNotSentSecurely === true);
    }

    public async heldNotSentSecurelyClientIds(): Promise<string[]> {
        return (await this.readPending()).flatMap((item) => item.heldNotSentSecurely && item.clientId ? [item.clientId] : []);
    }

    public async isTerminallyRejected(clientId: string): Promise<boolean> {
        return (await this.readPending()).some((item) => item.clientId === clientId && item.terminallyRejected === true);
    }

    public async acceptDelivery(relayId: string): Promise<void> {
        if (!this.roomId) return;
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            const accepted = pending.find((item) => item.relayId === relayId);
            if (accepted?.terminallyRejected || accepted?.heldNotSentSecurely) return;
            const next = pending.filter((item) => item.relayId !== relayId);
            if (next.length !== pending.length) await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(next));
            const renewal = parseSessionRenewal(await this.storage.read(SESSION_RENEWAL_RECORD, this.roomId!));
            if (accepted?.clientId && renewal?.clientId === accepted.clientId) {
                await this.storage.delete(SESSION_RENEWAL_RECORD, this.roomId!);
                this.sessionHealth = 'healthy';
                this.sessionHealthObserver?.('healthy');
            }
            if (accepted?.clientId) this.deliveryObserver?.(accepted.clientId, 'accepted');
        });
    }

    public async rejectDelivery(relayId: string): Promise<void> {
        if (!this.roomId) return;
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            const rejected = pending.find((item) => item.relayId === relayId);
            if (!rejected || rejected.terminallyRejected) return;
            rejected.terminallyRejected = true;
            await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(pending));
            if (rejected.clientId) this.deliveryObserver?.(rejected.clientId, rejected.heldNotSentSecurely ? 'held' : 'rejected');
        });
    }

    public async getContact(): Promise<StoredContactIdentity | undefined> {
        return this.remoteAddress ? this.registry.get(this.remoteAddress) : undefined;
    }

    /** Passive call-listener restoration must not create an outbound Olm session. */
    public hasEstablishedSession(): boolean {
        return Boolean(this.runtime.activeSessionId);
    }

    public getSessionHealth(): 'healthy' | 'unhealthy' | 'renewal-pending' {
        return this.sessionHealth;
    }

    public onSessionHealthUpdate(observer: (health: 'healthy' | 'unhealthy' | 'renewal-pending') => void): void {
        this.sessionHealthObserver = observer;
    }

    /** Explicit, peer-verified renewal retains every old vault record and waits for accepted encrypted delivery. */
    public async prepareVerifiedSessionRenewal(confirmed: boolean): Promise<void> {
        if (!confirmed || this.sessionHealth !== 'unhealthy' || !this.roomId || !this.remoteAddress || !this.capability) {
            throw new Error('Session renewal requires explicit contact verification.');
        }
        await this.assertCurrentDeviceTrust();
        const pinned = await this.registry.get(this.remoteAddress);
        if (!pinned || pinned.verification !== 'verified' || pinned.changeStatus !== 'unchanged') throw new Error('The contact is not verified.');
        const bundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, this.remoteAddress));
        if (await fingerprintVodozemacIdentity(bundle.identity) !== pinned.identityId) throw new Error('The verified contact identity changed.');
        const modeBytes = await this.storage.read('conversation-protocol', this.roomId);
        if (!modeBytes || !this.storage.compareAndSwapRecords) throw new Error('Atomic session renewal is unavailable.');
        const mode = JSON.parse(decoder.decode(modeBytes)) as Record<string, unknown>;
        if (typeof mode.sessionId !== 'string' || !mode.sessionId || await this.storage.read('vodozemac-session', this.roomId)) {
            throw new Error('The saved session state changed; renewal must be reviewed again.');
        }
        const nextMode = { ...mode };
        delete nextMode.sessionId;
        const changed = await this.storage.compareAndSwapRecords([
            { recordType: 'conversation-protocol', recordId: this.roomId, expected: modeBytes, next: asBytes(nextMode) },
            { recordType: SESSION_RENEWAL_RECORD, recordId: this.roomId, expected: undefined,
                next: asBytes({ version: 1, previousSessionId: mode.sessionId } satisfies SessionRenewal) },
        ]);
        if (!changed) throw new Error('Session renewal state changed; try again.');
        this.sessionHealth = 'renewal-pending';
        this.sessionHealthObserver?.('renewal-pending');
    }

    /**
     * Creates the only call composition available to a modern conversation.
     * A ready modern session, stable routing identities, and an explicitly
     * verified contact are all required; legacy conversations cannot reach
     * this boundary because they do not own a ModernConversation instance.
     */
    public async createAuthenticatedCallComposition(refreshSessionBinding = false): Promise<AuthenticatedCallComposition> {
        if (this.sessionHealth !== 'healthy') throw new Error('The encrypted session needs verified renewal before calling.');
        if (!this.roomId || !this.localAddress || !this.localIdentityId || !this.remoteAddress) {
            throw new Error('Modern conversation is not ready for calling.');
        }
        await this.assertCurrentDeviceTrust();
        const contact = await this.registry.get(this.remoteAddress, false);
        if (!contact || contact.changeStatus !== 'unchanged' || contact.verification !== 'verified') {
            throw new Error('Verify this contact before starting a call.');
        }
        if (this.callComposition && !refreshSessionBinding) return this.callComposition;
        // Calls use the established conversation session for encrypted
        // signaling. Do not create an outbound session just to prepare call
        // support: both peers may do so independently before the first
        // message, leaving neither able to decrypt the other's first
        // pre-key message. Messaging (or an authenticated inbound message)
        // must establish the shared session first.
        if (!this.runtime.activeSessionId) {
            throw new Error('Send or receive a secure message before starting a call.');
        }
        const localParticipant: CallParticipant = { participantId: this.localAddress, identityId: this.localIdentityId, verification: 'verified' };
        const remoteParticipant: CallParticipant = { participantId: this.remoteAddress, identityId: contact.identityId, verification: contact.verification };
        const identity = new VerifiedCallIdentityVerifier(
            new Set([localParticipant.participantId, remoteParticipant.participantId]),
            new Map([[localParticipant.participantId, localParticipant.verification], [remoteParticipant.participantId, remoteParticipant.verification]]),
            async () => {
                if (this.sessionHealth !== 'healthy') return 'unknown';
                const current = await this.registry.get(remoteParticipant.participantId, false);
                if (!current || current.identityId !== remoteParticipant.identityId) return 'unknown';
                if (current.changeStatus !== 'unchanged') return 'changed-pending-review';
                return current.verification;
            },
        );
        const composition = createAuthenticatedCallComposition({
            session: this.runtime.getAuthenticatedSession(),
            transport: this.transport,
            conversationId: this.roomId,
            localIdentityId: this.localIdentityId,
            localParticipantId: this.localAddress,
            remoteParticipant,
            identity,
            deviceTrust: this.deviceTrust!,
        });
        this.callComposition = composition;
        this.callSignalTransport = composition.signalTransport;
        return composition;
    }

    /** Creates the only synchronization boundary available to a modern conversation. */
    public async createSyncController(persistence: SyncPersistence = new SecureSyncPersistence(this.storage)): Promise<RuntimeSyncController> {
        if (persistence.durable !== true || typeof persistence.transaction !== 'function') throw new Error('Durable sync persistence is required.');
        await this.assertCurrentDeviceTrust();
        if (!this.userScope || !this.localDeviceId) throw new Error('Modern conversation is not ready for synchronization.');
        if (!this.syncController) {
            const controller = new RuntimeSyncController(this.userScope, this.localDeviceId, this.deviceTrust!, persistence);
            await controller.recover();
            this.syncController = controller;
        }
        return this.syncController;
    }

    public async authorizeSync(authorization: SyncAuthorization, persistence: SyncPersistence): Promise<RuntimeSyncController> {
        const controller = await this.createSyncController(persistence);
        await controller.authorize(authorization);
        return controller;
    }

    /** Returns a sync transport only for the active verified modern session. */
    public async createAuthenticatedSyncTransport(binding: Omit<SyncSessionBinding, 'session'>): Promise<AuthenticatedSyncTransport> {
        binding = Object.freeze({ ...binding });
        await this.assertCurrentDeviceTrust();
        if (!this.roomId || !this.localAddress || !this.localIdentityId || !this.remoteAddress) throw new Error('Modern conversation is not ready for synchronization.');
        if (!this.runtime.getAuthenticatedSession()) throw new Error('Authenticated sync session is unavailable.');
        const contact = await this.registry.get(this.remoteAddress);
        const state = await this.deviceTrust!.snapshot();
        const peer = state.list.devices.find((device) => device.deviceId === binding.peerDeviceId && device.state === 'active');
        const sessionBinding = `${this.roomId}:${this.runtime.activeSessionId}`;
        if (!contact || !peer || peer.publicIdentityReference !== contact.identityId || contact.verification !== 'verified' || contact.changeStatus !== 'unchanged' || binding.sessionBinding !== sessionBinding || binding.peerIdentityReference !== contact.identityId || binding.localIdentityReference !== this.localIdentityId) throw new Error('Authenticated sync identity rejected.');
        const controller = this.syncController;
        if (!controller || !this.capability) throw new Error('Durable sync controller is required.');
        const baseUrl = configContext().baseUrl;
        if (!baseUrl) throw new Error('Sync relay configuration is unavailable.');
        this.syncRelay?.close();
        let authenticated: AuthenticatedSyncTransport;
        const verifyPeer = async (): Promise<void> => {
            await this.assertCurrentDeviceTrust();
            const currentContact = await this.registry.get(this.remoteAddress!);
            if (currentContact?.verification !== 'verified' || currentContact.changeStatus !== 'unchanged' || currentContact.identityId !== binding.peerIdentityReference) throw new Error('Sync peer changed.');
        };
        const relay = new SocketSyncRelay(baseUrl, this.roomId, this.localAddress, this.capability, this.remoteAddress, async (envelope) => {
            await verifyPeer();
            const frame = await authenticated.receive(envelope, binding.peerDeviceId);
            await controller.receiveAuthenticated(frame);
        });
        authenticated = new AuthenticatedSyncTransport({ ...binding, session: this.runtime.getAuthenticatedSession() }, { send: async (envelope) => { await verifyPeer(); await relay.send(envelope); } }, this.userScope!, this.localDeviceId!, this.deviceTrust!);
        this.syncRelay = relay;
        return authenticated;
    }

    /** Product composition for durable membership and group-key epoch updates. */
    public async createGroupSecurityRuntime(): Promise<{ runtime: GroupSecurityRuntime; localContext: AuthenticatedDeviceContext; keys: SecureStorageGroupRuntimeAdapter }> {
        await this.assertCurrentDeviceTrust();
        if (!this.groupAdapter) this.groupAdapter = new SecureStorageGroupRuntimeAdapter(this.storage);
        if (!this.groupRuntime) this.groupRuntime = new GroupSecurityRuntime(this.groupAdapter, this.groupAdapter);
        return { runtime: this.groupRuntime, localContext: this.deviceContext(), keys: this.groupAdapter };
    }

    /** Product recovery composition backed by the same encrypted atomic vault. */
    public async createRecoveryRuntime(): Promise<RecoveryRuntime> {
        await this.assertCurrentDeviceTrust();
        if (!this.recoveryRuntime) this.recoveryRuntime = createProductionRecoveryRuntime(this.storage);
        return this.recoveryRuntime;
    }

    public async verifyContact(confirmed: boolean, expectedIdentity?: string): Promise<void> {
        if (!confirmed || !this.remoteAddress) throw new Error('Confirm the comparison before verifying this contact.');
        await this.registry.markVerified(this.remoteAddress, expectedIdentity ?? (await this.registry.get(this.remoteAddress))?.identityId);
    }

    public async unverifyContact(): Promise<void> {
        if (!this.remoteAddress) throw new Error('No contact is open.');
        await this.registry.markUnverified(this.remoteAddress);
    }

    /** Explicitly accepts a changed public identity; the prior session is discarded and a fresh pre-key flow is required. */
    public async acceptChangedIdentity(): Promise<void> {
        this.syncRelay?.close();
        if (!this.roomId || !this.remoteAddress) throw new Error('No changed contact is open.');
        await this.registry.acceptPendingChange(this.remoteAddress);
        await this.storage.delete('vodozemac-session', this.roomId);
        await this.storage.delete(SESSION_AUDIT_RECORD, this.roomId);
        await this.modes.write(this.roomId, { sessionId: undefined });
        this.runtime.close();
        this.callComposition = undefined;
        this.callSignalTransport = undefined;
        this.syncController = undefined;
        this.groupRuntime = undefined;
        this.groupAdapter = undefined;
        this.recoveryRuntime = undefined;
    }

    public async close(lockStorage = true): Promise<void> {
        this.syncRelay?.close();
        if (this.retryTimer) clearInterval(this.retryTimer);
        await this.roomTransport?.close();
        // A transport may already have delivered more envelopes than the old
        // conversation can drain. Cancel only its queued receive lock requests
        // so a newly selected instance is not starved by a retired listener.
        this.inboundLockAbort.abort();
        this.runtime.close();
        this.callComposition = undefined;
        this.callSignalTransport = undefined;
        this.syncController = undefined;
        const browserWindow = (globalThis as typeof globalThis & { window?: { removeEventListener?: (event: string, handler: () => void) => void } }).window;
        if (this.unloadHandler && browserWindow?.removeEventListener) {
            browserWindow.removeEventListener('beforeunload', this.unloadHandler);
            browserWindow.removeEventListener('pagehide', this.unloadHandler);
        }
        this.unloadHandler = undefined;
        this.releaseFallbackLease();
        if (lockStorage) this.storage.lock();
    }

    public async delete(): Promise<void> {
        if (!this.roomId || !this.capability) throw new Error('No modern conversation is open.');
        await deleteLink({ channelID: this.roomId, controlCapability: this.capability });
        await this.storage.delete(OUTBOX_RECORD, this.roomId);
        await this.storage.delete(SEEN_RECORD, this.roomId);
        await this.storage.delete(SESSION_AUDIT_RECORD, this.roomId);
        await this.storage.delete('vodozemac-session', this.roomId);
        await this.storage.delete('conversation-protocol', this.roomId);
        if (this.remoteAddress) await this.storage.delete('contact-identity', this.remoteAddress);
        await this.close();
    }

    /**
     * Audits pre-direction session records before restoring them. Older
     * conversation records do not say whether their session was created on
     * join, on first send, or on first receive. Keep those records unless a
     * durable audit marker proves they are an unused join-created outbound
     * session. Message evidence upgrades an unmarked record to preserved
     * history; absence of evidence alone is deliberately not deletion proof.
     */
    private async auditAndMigratePersistedSession(conversationId: string, sessionId: string): Promise<boolean> {
        const auditBytes = await this.storage.read(SESSION_AUDIT_RECORD, conversationId);
        const audit = parseSessionAudit(auditBytes);
        if (audit?.classification === 'unused-outbound' && audit.direction === 'outbound' && audit.origin === 'join') {
            const modeBytes = await this.storage.read('conversation-protocol', conversationId);
            if (!modeBytes || !auditBytes || !this.storage.compareAndSwapRecords) return false;
            const mode = JSON.parse(decoder.decode(modeBytes)) as Record<string, unknown>;
            if (mode.version !== 1 || mode.mode !== 'modern' || mode.sessionId !== sessionId) return false;
            const modeWithoutSession = { ...mode };
            delete modeWithoutSession.sessionId;
            const retired: SessionAudit = { version: 1, classification: 'retired-unused-outbound', direction: 'outbound', origin: 'join' };
            const transitioned = await this.storage.compareAndSwapRecords([
                { recordType: 'conversation-protocol', recordId: conversationId, expected: modeBytes, next: asBytes(modeWithoutSession) },
                { recordType: SESSION_AUDIT_RECORD, recordId: conversationId, expected: auditBytes, next: asBytes(retired) },
            ]);
            if (!transitioned) return false;
            await this.cleanupRetiredSession(conversationId);
            return true;
        }
        if (audit) return false;

        const [seenBytes, outboxBytes, messageBytes] = await Promise.all([
            this.storage.read(SEEN_RECORD, conversationId),
            this.storage.read(OUTBOX_RECORD, conversationId),
            this.storage.read('product-messages', conversationId),
        ]);
        const seen = parseList<string>(seenBytes);
        const outbox = parseList<PendingEnvelope>(outboxBytes);
        let hasProductHistory = false;
        if (messageBytes) {
            const messages: unknown = JSON.parse(decoder.decode(messageBytes));
            if (!Array.isArray(messages)) throw new Error('Saved conversation history is invalid.');
            hasProductHistory = messages.length > 0;
        }
        const classification: SessionAudit['classification'] = seen.length > 0 || outbox.length > 0 || hasProductHistory
            ? 'session-with-message-history'
            : 'legacy-unclassified';
        const migrationAudit: SessionAudit = { version: 1, classification };
        await this.storage.write(SESSION_AUDIT_RECORD, conversationId, asBytes(migrationAudit));
        // sessionId is intentionally read/validated here so malformed or
        // incomplete mode records cannot be treated as migration candidates.
        if (!sessionId) throw new Error('Persisted conversation session identity is missing.');
        return false;
    }

    private async cleanupRetiredSession(conversationId: string): Promise<void> {
        const audit = parseSessionAudit(await this.storage.read(SESSION_AUDIT_RECORD, conversationId));
        if (audit?.classification !== 'retired-unused-outbound') return;
        await this.storage.delete('vodozemac-session', conversationId);
        await this.storage.delete(SESSION_AUDIT_RECORD, conversationId);
    }

    private receive(envelope: EncryptedEnvelope, senderAddress?: string): Promise<boolean> {
        return this.receiveMutex.runExclusive(() => this.receiveUnlocked(envelope, senderAddress));
    }

    private async decideInbound(envelope: EncryptedEnvelope, senderAddress?: string): Promise<InboundTransportDecision> {
        try {
            const accepted = this.connecting
                ? await this.receive(envelope, senderAddress)
                : await this.withTabLock(this.roomId ?? 'unknown', () => this.receive(envelope, senderAddress), false, this.inboundLockAbort.signal);
            return accepted ? { outcome: 'accepted' } : { outcome: 'retryable' };
        } catch (error) {
            return error instanceof PermanentInboundRejection
                ? { outcome: 'permanent-rejection', reasonClass: error.reasonClass }
                : { outcome: 'retryable' };
        }
    }

    private async receiveUnlocked(envelope: EncryptedEnvelope, senderAddress?: string): Promise<boolean> {
        if (this.sessionHealth === 'unhealthy') return false;
        this.lastInboundFailureCategory = undefined;
        let senderFingerprint: string | undefined;
        await this.testOnlyRecordInboundStage('received');
        try {
            try { await this.assertCurrentDeviceTrust(); }
            catch (error) { this.lastInboundFailureCategory = 'device-trust-failure'; throw error; }
            if (!this.roomId || !this.capability || !senderAddress || (this.remoteAddress && senderAddress !== this.remoteAddress)) {
                this.lastInboundFailureCategory = 'routing-mismatch';
                await this.testOnlyRecordInboundStage('received', undefined, this.lastInboundFailureCategory);
                return false;
            }
            let wireText: string;
            try { wireText = firstMessage(envelope); }
            catch (error) { this.lastInboundFailureCategory = 'malformed-envelope'; throw error; }
            this.lastInboundFailureCategory = undefined;
            await this.testOnlyRecordInboundStage('parsed');
            const m1 = await envelopeIdForEnvelope(this.roomId, envelope);
            const legacyDigest = await this.digest(envelope);
            const seenBytes = await this.storage.read(SEEN_RECORD, this.roomId);
            const m1SeenBytes = await this.storage.read(M1_SEEN_RECORD, this.roomId);
            const roomMessageSeenBytes = await this.storage.read(ROOM_MESSAGE_SEEN_RECORD, this.roomId);
            const seen = parseList<string>(seenBytes);
            const m1Seen = parseM1Seen(m1SeenBytes);
            const roomMessageSeen = parseRoomMessageSeen(roomMessageSeenBytes);
            if (seen.includes(legacyDigest) || m1Seen.includes(m1)) {
                await this.testOnlyRecordInboundStage('persisted');
                await this.testOnlyRecordInboundStage('acknowledged');
                return true;
            }

            const firstSession = !this.runtime.activeSessionId;
            let bundle: ReturnType<typeof validateVodozemacPublicBundle> | undefined;
            if (firstSession) {
                try { bundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, senderAddress)); }
                catch (error) { this.lastInboundFailureCategory = 'prekey-session-lookup-failure'; throw error; }
                const pinned = await this.registry.get(senderAddress);
                senderFingerprint = await fingerprintVodozemacIdentity(bundle.identity);
                if (pinned && (pinned.identityId !== senderFingerprint || pinned.changeStatus !== 'unchanged')) {
                    this.lastInboundFailureCategory = 'sender-identity-mismatch';
                    await this.testOnlyRecordInboundStage('parsed', senderFingerprint, this.lastInboundFailureCategory);
                    throw new PermanentInboundRejection('identity-changed');
                }
            } else {
                const contact = this.remoteAddress ? await this.registry.get(this.remoteAddress) : undefined;
                if (contact && contact.changeStatus !== 'unchanged') {
                    this.lastInboundFailureCategory = 'sender-identity-mismatch';
                    await this.testOnlyRecordInboundStage('parsed', contact.identityId, this.lastInboundFailureCategory);
                    throw new PermanentInboundRejection('identity-changed');
                }
                // A saved invitation commitment is the provisional identity
                // scope when route/contact metadata needs authenticated repair.
                // The acceptance path verifies it against the fetched identity
                // before this event can commit.
                senderFingerprint = contact?.identityId ?? this.remoteIdentityCommitment;
            }
            await this.testOnlyRecordInboundStage('session-found', senderFingerprint);

            let acceptedPlan: InboundMessageAcceptancePlan | undefined;
            let afterCommitRouteRepair: (() => void | Promise<void>) | undefined;
            let heldOutboxClientIds: string[] = [];
            const buildAcceptanceUpdates = async (plaintext: ArrayBuffer): Promise<readonly SecureRecordUpdate[]> => {
                let payload: Uint8Array;
                let authenticatedEventId: string | undefined;
                let authenticatedCommitment: string | undefined;
                let authenticatedWrapperVersion: number | undefined;
                if (!senderFingerprint) {
                    const identity = bundle?.identity ?? validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId!, this.capability!, senderAddress)).identity;
                    senderFingerprint = await fingerprintVodozemacIdentity(identity);
                    if (this.remoteIdentityCommitment && senderFingerprint !== this.remoteIdentityCommitment) {
                        throw new Error('The authenticated sender identity does not match the saved invitation.');
                    }
                }
                const floorGuard = await prepareRoomMessageVersionFloorGuard(this.storage, this.roomId!, senderFingerprint!);
                if (floorGuard.floor > 1) throw new Error('This contact requires a newer secure message format.');
                try {
                    const decrypted = firstSession ? unframeFirstMessage(plaintext) : new Uint8Array(plaintext);
                    const decoded = decodeRoomMessage(decrypted, {
                        roomId: this.roomId!,
                        senderIdentityReference: senderFingerprint!,
                        recipientIdentityReference: this.localIdentityId!,
                    }, { requireRoomMessageV1: this.transport.activeTransport()?.requiresRoomMessageV1 === true || floorGuard.floor >= 1 });
                    payload = decoded.payload;
                    if (decoded.version === 'room-message-v1') {
                        authenticatedWrapperVersion = 1;
                        const isIntroduction = startsWithBytes(payload, JOIN_INTRODUCTION_MAGIC);
                        const isAttachmentReference = startsWithBytes(payload, encoder.encode('k3ncrypt-file-'));
                        if ((decoded.kind === 'join-introduction') !== isIntroduction ||
                            (decoded.kind === 'attachment-reference') !== isAttachmentReference) {
                            throw new Error('Room message payload kind does not match its application payload.');
                        }
                        authenticatedEventId = await roomMessageEventId(this.roomId!, senderFingerprint!, decoded.eventId);
                        authenticatedCommitment = await roomMessageCommitment(decrypted);
                    }
                } catch (error) {
                    this.lastInboundFailureCategory = 'message-frame-parsing-failure';
                    if (error instanceof RoomMessageDecodeError) {
                        const reasonClass = error.failure === 'unsupported-version' || error.failure === 'unsupported-kind' || error.failure === 'legacy-forbidden'
                            ? 'unsupported-message' : 'authenticated-invalid';
                        throw new PermanentInboundRejection(reasonClass, error.message);
                    }
                    throw new PermanentInboundRejection('authenticated-invalid', error instanceof Error ? error.message : undefined);
                }
                const priorEvent = authenticatedEventId ? roomMessageSeen.find((item) => item.id === authenticatedEventId) : undefined;
                if (priorEvent && priorEvent.commitment !== authenticatedCommitment) {
                    this.lastInboundFailureCategory = 'message-frame-parsing-failure';
                    throw new PermanentInboundRejection('authenticated-invalid', 'Room message event ID was reused with different content.');
                }
                const authenticatedReplay = Boolean(priorEvent);
                let introduction: JoinIntroduction | undefined;
                try { introduction = parseJoinIntroduction(payload); }
                catch { this.lastInboundFailureCategory = 'message-frame-parsing-failure'; throw new PermanentInboundRejection('authenticated-invalid'); }
                const updates: SecureRecordUpdate[] = [];
                if (authenticatedReplay) {
                    // A new ciphertext may carry an already accepted authenticated event.
                    // Commit the ratchet and ciphertext marker, but do not repeat app effects.
                } else if (introduction) {
                    const identity = bundle?.identity ?? validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId!, this.capability!, senderAddress)).identity;
                    acceptedPlan = await this.acceptJoinIntroduction(introduction, senderAddress, identity);
                    updates.push(...acceptedPlan.updates);
                } else {
                    let text: string;
                    try { text = strictMessageDecoder.decode(payload); }
                    catch { this.lastInboundFailureCategory = 'message-frame-parsing-failure'; throw new PermanentInboundRejection('authenticated-invalid'); }
                    await this.testOnlyRecordInboundStage('frame-parsed', senderFingerprint);
                    if (firstSession) {
                        if (this.remoteIdentityCommitment && this.remoteIdentityCommitment !== senderFingerprint) {
                            this.lastInboundFailureCategory = 'sender-identity-mismatch';
                            throw new PermanentInboundRejection('identity-changed');
                        }
                        const routePlan = await this.prepareAuthenticatedRouteUpdates(senderAddress, bundle!.identity, senderFingerprint!);
                        updates.push(...routePlan.updates);
                        afterCommitRouteRepair = routePlan.afterCommit;
                        const auditBytes = await this.storage.read(SESSION_AUDIT_RECORD, this.roomId!);
                        updates.push({
                            recordType: SESSION_AUDIT_RECORD,
                            recordId: this.roomId!,
                            expected: auditBytes,
                            next: asBytes({ version: 1, classification: 'active-established', direction: 'inbound', origin: 'first-message' } satisfies SessionAudit),
                        });
                    } else if (!this.remoteAddress || !(await this.getContact())) {
                        const restoredBundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId!, this.capability!, senderAddress));
                        const restoredFingerprint = await fingerprintVodozemacIdentity(restoredBundle.identity);
                        if (this.remoteIdentityCommitment && this.remoteIdentityCommitment !== restoredFingerprint) {
                            this.lastInboundFailureCategory = 'sender-identity-mismatch';
                            throw new Error('The authenticated sender identity does not match the saved invitation.');
                        }
                        const routePlan = await this.prepareAuthenticatedRouteUpdates(senderAddress, restoredBundle.identity, restoredFingerprint);
                        updates.push(...routePlan.updates);
                        afterCommitRouteRepair = routePlan.afterCommit;
                    }
                    if (!this.onMessage) {
                        this.lastInboundFailureCategory = 'persistence-failure';
                        throw new Error('Inbound message consumer is unavailable.');
                    }
                    acceptedPlan = await this.onMessage(text, authenticatedEventId ?? m1);
                    if (!acceptedPlan || !Array.isArray(acceptedPlan.updates)) {
                        this.lastInboundFailureCategory = 'persistence-failure';
                        throw new Error('Inbound message consumer did not prepare durable acceptance.');
                    }
                    updates.push(...acceptedPlan.updates);
                }

                const floorUpdate = authenticatedWrapperVersion === undefined
                    ? floorGuard.update
                    : (await prepareRoomMessageVersionFloorRaise(this.storage, this.roomId!, senderFingerprint!, authenticatedWrapperVersion)).update!;
                updates.push(floorUpdate);
                if (authenticatedWrapperVersion !== undefined) {
                    const outboxBytes = await this.storage.read(OUTBOX_RECORD, this.roomId!);
                    const outbox = parseList<PendingEnvelope>(outboxBytes);
                    const nextOutbox = outbox.map((item) => {
                        if (item.roomMessageVersion || item.terminallyRejected || item.heldNotSentSecurely) return item;
                        if (item.clientId) heldOutboxClientIds.push(item.clientId);
                        return { ...item, heldNotSentSecurely: true as const };
                    });
                    if (nextOutbox.some((item, index) => item !== outbox[index])) {
                        updates.push({ recordType: OUTBOX_RECORD, recordId: this.roomId!, expected: outboxBytes, next: asBytes(nextOutbox) });
                    }
                }

                // Legacy digests retain their existing count-bounded behavior. M1 markers are
                // deliberately not pruned: retention pending owner-approved horizon.
                const nextLegacySeen = [...seen.slice(-(MAX_SEEN - 1)), legacyDigest];
                const nextM1Seen = [...m1Seen, m1, ...(authenticatedEventId && !m1Seen.includes(authenticatedEventId) ? [authenticatedEventId] : [])];
                updates.push(
                    { recordType: SEEN_RECORD, recordId: this.roomId!, expected: seenBytes, next: asBytes(nextLegacySeen) },
                    { recordType: M1_SEEN_RECORD, recordId: this.roomId!, expected: m1SeenBytes, next: asBytes({ version: 1, ids: nextM1Seen }) },
                );
                if (authenticatedEventId && authenticatedCommitment && !priorEvent) {
                    updates.push({ recordType: ROOM_MESSAGE_SEEN_RECORD, recordId: this.roomId!, expected: roomMessageSeenBytes,
                        next: asBytes({ version: 1, events: [...roomMessageSeen, { id: authenticatedEventId, commitment: authenticatedCommitment }] }) });
                }
                return updates;
            };

            try {
                if (firstSession) {
                    await this.runtime.establishInboundSessionAndCommit(this.roomId, bundle!.identity.curve25519, wireText, buildAcceptanceUpdates);
                } else {
                    await this.runtime.decryptAndCommitInbound('message', envelope, buildAcceptanceUpdates);
                }
            } catch (error) {
                this.lastInboundFailureCategory ??= 'persistence-failure';
                throw error;
            }
            try { await afterCommitRouteRepair?.(); } catch { /* Durable message/session acceptance can recover route metadata on reconnect. */ }
            try { await acceptedPlan?.afterCommit?.(); } catch { /* Durable acceptance is already complete; UI projection reloads stored history. */ }
            heldOutboxClientIds.forEach((clientId) => this.deliveryObserver?.(clientId, 'held'));
            await this.testOnlyRecordInboundStage('persisted', senderFingerprint);
            await this.testOnlyRecordInboundStage('acknowledged', senderFingerprint);
            this.lastInboundFailureCategory = undefined;
            return true;
        } catch (error) {
            if (this.lastInboundFailureCategory) await this.testOnlyRecordInboundStage('parsed', senderFingerprint, this.lastInboundFailureCategory);
            throw error;
        }
    }

    private async acceptJoinIntroduction(
        event: JoinIntroduction,
        senderAddress: string,
        identity: VodozemacPublicIdentity,
    ): Promise<InboundMessageAcceptancePlan> {
        if (!this.roomId || event.conversationId !== this.roomId || event.senderAddress !== senderAddress ||
            (this.remoteAddress !== undefined && this.remoteAddress !== senderAddress)) {
            throw new PermanentInboundRejection('authenticated-invalid');
        }
        const fingerprint = await fingerprintVodozemacIdentity(identity);
        if (event.identityCommitment !== fingerprint ||
            (this.remoteIdentityCommitment !== undefined && this.remoteIdentityCommitment !== fingerprint)) {
            throw new PermanentInboundRejection('identity-changed');
        }
        const signatureValid = await this.verifyJoinIntroductionSignature(event, identity.ed25519);
        if (!signatureValid) throw new PermanentInboundRejection('authenticated-invalid');

        const acceptedBytes = await this.storage.read(JOIN_INTRODUCTION_SEEN_RECORD, this.roomId);
        const updates: SecureRecordUpdate[] = [];
        if (acceptedBytes) {
            let accepted: unknown;
            try { accepted = JSON.parse(decoder.decode(acceptedBytes)); } catch { throw new Error('Saved join introduction replay state is invalid.'); }
            if (!accepted || typeof accepted !== 'object' || Array.isArray(accepted) ||
                Object.keys(accepted).sort().join(',') !== 'eventId,version' ||
                (accepted as { version?: unknown }).version !== 1 ||
                typeof (accepted as { eventId?: unknown }).eventId !== 'string') {
                throw new Error('Saved join introduction replay state is invalid.');
            }
            if ((accepted as { eventId: string }).eventId !== event.eventId) throw new PermanentInboundRejection('authenticated-invalid');
        } else {
            updates.push({
                recordType: JOIN_INTRODUCTION_SEEN_RECORD,
                recordId: this.roomId,
                expected: undefined,
                next: asBytes({ version: 1, eventId: event.eventId }),
            });
        }

        const routePlan = await this.prepareAuthenticatedRouteUpdates(senderAddress, identity, fingerprint);
        updates.push(...routePlan.updates);
        const auditBytes = await this.storage.read(SESSION_AUDIT_RECORD, this.roomId);
        updates.push({
            recordType: SESSION_AUDIT_RECORD,
            recordId: this.roomId,
            expected: auditBytes,
            next: asBytes({ version: 1, classification: 'active-established', direction: 'inbound', origin: 'join' } satisfies SessionAudit),
        });
        return {
            updates,
            afterCommit: routePlan.afterCommit,
        };
    }

    /** Prepare authenticated route/contact records for the same CAS as session and message acceptance. */
    private async prepareAuthenticatedRouteUpdates(
        senderAddress: string,
        identity: VodozemacPublicIdentity,
        fingerprint: string,
    ): Promise<InboundMessageAcceptancePlan> {
        if (!this.roomId) throw new Error('Authenticated sender cannot be associated with this conversation.');
        if (this.remoteIdentityCommitment && this.remoteIdentityCommitment !== fingerprint) {
            throw new Error('The authenticated sender identity does not match the saved invitation.');
        }
        const known = await this.registry.get(senderAddress);
        if (known && (known.identityId !== fingerprint || known.changeStatus !== 'unchanged')) {
            throw new PermanentInboundRejection('identity-changed');
        }
        const contactBytes = await this.storage.read('contact-identity', senderAddress);
        const updates: SecureRecordUpdate[] = [];
        if (!known) {
            const contact: StoredContactIdentity = {
                contactId: senderAddress,
                identityId: fingerprint,
                algorithm: 'Olm-Curve25519+Ed25519',
                publicKey: toBase64Url(encoder.encode(JSON.stringify(identity))),
                verification: 'unverified',
                changeStatus: 'unchanged',
            };
            updates.push({ recordType: 'contact-identity', recordId: senderAddress, expected: contactBytes, next: asBytes(contact) });
        }
        updates.push(await this.modes.prepareWrite(this.roomId, {
            sessionId: this.runtime.activeSessionId,
            remoteAddress: senderAddress,
        }));
        return {
            updates,
            afterCommit: async () => {
                this.remoteAddress = senderAddress;
                this.remoteIdentityCommitment ??= fingerprint;
                const persisted = await this.registry.get(senderAddress);
                if (persisted) await this.onContactChange?.(persisted);
            },
        };
    }

    private async verifyJoinIntroductionSignature(event: JoinIntroduction, publicKey: string): Promise<boolean> {
        try {
            const { signature, ...unsigned } = event;
            const keyBytes = fromBase64Url(publicKey);
            const signatureBytes = fromBase64Url(signature);
            const messageBytes = canonicalJoinIntroduction(unsigned);
            const key = await globalThis.crypto.subtle.importKey('raw', keyBytes.slice().buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
            return await globalThis.crypto.subtle.verify('Ed25519', key, signatureBytes.slice().buffer as ArrayBuffer, messageBytes.slice().buffer as ArrayBuffer);
        } catch {
            return false;
        }
    }

    private requireDeviceLifecycle(): DeviceLifecycleService {
        this.prepareDeviceControl();
        if (!this.deviceLifecycle || !this.deviceControlChannel) throw new Error('Device lifecycle requires a ready modern session.');
        return this.deviceLifecycle;
    }

    private prepareDeviceControl(): void {
        if (this.deviceControlChannel || !this.deviceLifecyclePersistence || !['active', 'persisted'].includes(this.runtime.lifecycle)) return;
        if (!this.roomId || !this.localIdentityId || !this.remoteIdentityCommitment) return;
        this.deviceControlChannel = new AuthenticatedDeviceControlChannel(this.runtime.getAuthenticatedSession(), this.transport, {
            conversationId: this.roomId,
            localIdentityReference: this.localIdentityId,
            remoteIdentityReference: this.remoteIdentityCommitment,
            requiresRoomBinding: () => this.transport.activeTransport()?.requiresRoomMessageV1 === true,
        });
        this.deviceLifecycle = new DeviceLifecycleService(this.deviceLifecyclePersistence, {
            verify: async (context, authorization) => {
                const sender = context.authenticatedSender;
                if (!sender.verified || sender.userScope !== context.userScope || sender.deviceId !== authorization.authorDeviceId || sender.identityReference !== authorization.authorIdentityReference) throw new Error('Device authorization rejected.');
            },
        });
    }

    private deviceContext(): AuthenticatedDeviceContext {
        if (!this.localIdentityId || !this.localAddress) throw new Error('Device lifecycle identity is unavailable.');
        if (!this.userScope || !this.localDeviceId) throw new Error('Device account binding unavailable.');
        return new DeviceContextAuthority(this.runtime.getAuthenticatedSession(), this.roomId!,
            { deviceId: this.localDeviceId, identityReference: this.localIdentityId, userScope: this.userScope, verified: true }).localContext();
    }

    private async handleDeviceControl(message: DeviceControlMessage): Promise<void> {
        // Control delivery is deliberately fail-closed until a caller supplies a
        // target-side ceremony. Unknown or malformed controls are dropped.
        if (!this.remoteAddress || !this.userScope) return;
        const contact = await this.registry.get(this.remoteAddress);
        if (!contact || contact.verification !== 'verified' || contact.changeStatus !== 'unchanged') return;
        if (message.type === 'trust-state') {
            if (!this.trustEvents || !message.payload || typeof message.payload !== 'object') return;
            try {
                const current = await this.deviceTrust!.snapshot();
                if (!current.list.devices.some((entry) => entry.state === 'active' && entry.publicIdentityReference === contact.identityId)) return;
                const state = await this.trustEvents.accept(message.payload as TrustStateEvent);
                await this.deviceTrust!.recordFreshnessEvidence({ version: 1, deviceId: (message.payload as TrustStateEvent).deviceId, identityReference: (message.payload as TrustStateEvent).identityReference, epoch: (message.payload as TrustStateEvent).epoch, commitment: (message.payload as TrustStateEvent).commitment, evidenceId: (message.payload as TrustStateEvent).eventId });
                this.trustEpoch = state.list.epoch;
                const event = message.payload as TrustStateEvent;
                const local = state.list.devices.find((entry) => entry.deviceId === this.localDeviceId);
                if (event.deviceId === this.localDeviceId && event.state === 'revoked' && local?.state !== 'active') {
                    this.runtime.close();
                    this.callComposition = undefined;
                    this.callSignalTransport = undefined;
                }
                this.onDeviceControl?.(message as DeviceControlEvent);
                return;
            } catch { return; }
        }
        if (message.type === 'trust-state-request') {
            if (!this.deviceControlChannel || !this.deviceTrust) return;
            const state = await this.deviceTrust.snapshot();
            const peer = state.list.devices.find((entry) => entry.publicIdentityReference === contact.identityId);
            if (!peer) return;
            await this.deviceControlChannel.send({ type: 'trust-state-snapshot', payload: { version: 1, state } });
            return;
        }
        if (message.type === 'trust-state-snapshot') {
            const payload = message.payload as { version?: unknown; state?: LifecycleStateSnapshot } | undefined;
            if (payload?.version !== 1 || !payload.state || !this.deviceLifecyclePersistence || !this.deviceTrust || !this.userScope) return;
            const current = await this.deviceTrust.snapshot();
            const peer = current.list.devices.find((entry) => entry.publicIdentityReference === contact.identityId && entry.state === 'active');
            if (!peer) return;
            try {
                let state = current;
                if (payload.state.list.epoch === current.list.epoch + 1) {
                    if (!this.deviceLifecyclePersistence.installTrustUpdate) throw new Error('Trust update installation unavailable.');
                    await this.deviceLifecyclePersistence.installTrustUpdate(this.userScope, current, payload.state, { deviceId: peer.deviceId, identityReference: peer.publicIdentityReference });
                    state = payload.state;
                    this.deviceTrust = new DeviceTrustEnforcer(this.deviceLifecyclePersistence, this.userScope, this.localDeviceId!, this.localIdentityId!);
                    this.trustEvents = new TrustStateEventCoordinator(this.deviceTrust, this.userScope);
                } else if (payload.state.list.epoch !== current.list.epoch || payload.state.commitment !== current.commitment) throw new Error('Trust update is stale or incomplete.');
                this.configureFreshnessFrom(state);
                const sender = state.list.devices.find((entry) => entry.deviceId === peer.deviceId);
                if (!sender || sender.state !== 'active') throw new Error('Trust update sender rejected.');
                await this.deviceTrust.recordFreshnessEvidence({ version: 1, deviceId: sender.deviceId, identityReference: sender.publicIdentityReference, epoch: state.list.epoch, commitment: state.commitment, evidenceId: `snapshot:${state.list.epoch}:${sender.deviceId}` });
                this.trustEpoch = state.list.epoch;
                if (state.list.devices.find((entry) => entry.deviceId === this.localDeviceId)?.state !== 'active') {
                    this.runtime.close(); this.callComposition = undefined; this.callSignalTransport = undefined;
                }
                this.onDeviceControl?.(message as DeviceControlEvent);
            } catch {
                await this.deviceTrust.suspend(payload.state.list.epoch, payload.state.commitment).catch(() => undefined);
            }
            return;
        }
        if (message.type === 'enrollment-request' && this.deviceLifecycle) {
            const request = message.payload as EnrollmentRequest | undefined;
            if (!request || request.userScope !== this.userScope || request.requestedPublicIdentityReference !== contact.identityId) return;
            this.onDeviceControl?.(message as DeviceControlEvent);
            return;
        }
        if (message.type === 'enrollment-approval') {
            const packet = message.payload as EnrollmentApprovalPacket | undefined;
            if (!packet || packet.version !== 1 || packet.authorization.targetPublicIdentityReference !== this.localIdentityId || packet.authorization.authorIdentityReference !== contact.identityId) return;
            this.onDeviceControl?.(message as DeviceControlEvent);
            return;
        }
        if (message.type === 'enrollment-confirmation' && this.deviceLifecycle) {
            const payload = message.payload as { authorization?: DeviceAuthorization; confirmation?: import('../devices/lifecycle').EnrollmentConfirmation } | undefined;
            const authorization = payload?.authorization;
            const confirmation = payload?.confirmation;
            if (!authorization || !confirmation || authorization.authorDeviceId !== this.localDeviceId || authorization.authorIdentityReference !== this.localIdentityId || authorization.targetPublicIdentityReference !== contact.identityId) return;
            const targetContext = new DeviceContextAuthority(this.runtime.getAuthenticatedSession(), this.roomId!,
                { deviceId: authorization.targetDeviceId, identityReference: contact.identityId, userScope: authorization.userScope, verified: true }).localContext();
            const state = await this.deviceLifecycle.confirmEnrollment(authorization, targetContext, confirmation);
            this.configureFreshnessFrom(state);
            await this.deviceTrust!.recordFreshnessEvidence({ version: 1, deviceId: authorization.targetDeviceId, identityReference: authorization.targetPublicIdentityReference!, epoch: state.list.epoch, commitment: state.commitment, evidenceId: `enrollment:${confirmation.confirmationDigest}` });
            await this.deviceControlChannel!.send({ type: 'trust-state-snapshot', payload: { version: 1, state } });
            this.onDeviceControl?.(message as DeviceControlEvent);
        }
    }

    private configureFreshnessFrom(state: LifecycleStateSnapshot): void {
        this.deviceTrust?.configureFreshnessMembers(state.list.devices.filter((entry) => entry.state === 'active').map((entry) => entry.deviceId));
    }

    /** Sends the durable counterpart of an already verified local enrollment approval. */
    private async submitDurableEnrollment(authorization: DeviceAuthorization, targetDeviceId: string, targetIdentityReference: string): Promise<void> {
        if (!this.durableProofs || !this.userScope || !this.localDeviceId || !this.localIdentityId || this.trustEpoch === undefined || !this.remoteAddress) throw new Error('Durable device enrollment is unavailable.');
        if (authorization.operation !== 'enroll' || authorization.userScope !== this.userScope || authorization.authorDeviceId !== this.localDeviceId || authorization.authorIdentityReference !== this.localIdentityId || authorization.targetDeviceId !== targetDeviceId || authorization.targetPublicIdentityReference !== targetIdentityReference || authorization.previousEpoch !== this.trustEpoch) throw new Error('Durable device enrollment rejected.');
        const contact = await this.registry.get(this.remoteAddress);
        if (!contact || contact.identityId !== targetIdentityReference || contact.verification !== 'verified' || contact.changeStatus !== 'unchanged') throw new Error('Enrollment target identity is not authenticated.');
        let targetVerificationKey: string;
        try {
            const publicIdentity = JSON.parse(decoder.decode(fromBase64Url(contact.publicKey))) as VodozemacPublicIdentity;
            if (!publicIdentity || typeof publicIdentity.ed25519 !== 'string' || publicIdentity.ed25519.length < 40) throw new Error();
            targetVerificationKey = publicIdentity.ed25519;
        } catch { throw new Error('Enrollment target verification key is unavailable.'); }
        const createdAt = Date.now();
        const unsigned: Omit<EnrollmentEvent, 'signature'> = {
            version: 1, eventId: crypto.randomUUID(), accountIdentityReference: this.userScope,
            issuerDeviceId: this.localDeviceId, issuerIdentityReference: this.localIdentityId, issuerEpoch: this.trustEpoch,
            targetDeviceId, targetIdentityReference, targetVerificationKey, targetFingerprint: targetIdentityReference,
            nonce: crypto.randomUUID().replace(/-/g, ''), createdAt, expiresAt: createdAt + 30_000,
        };
        const event = await signEnrollmentEvent({ signControlEvent: (payload) => this.runtime.signControlEvent(payload) }, unsigned);
        const carrier = await this.durableProofs.acquire('device-control');
        await makeRequest<unknown, { event: EnrollmentEvent; deviceAuthorizationProof: typeof carrier.deviceAuthorizationProof; proofNonce: string }>('device-trust/enrollment', { method: 'POST', body: { event, ...carrier } });
    }

    /** Advances the pending durable target record to the confirmed local lifecycle epoch. */
    private async activateDurableEnrollment(): Promise<void> {
        if (!this.userScope || !this.localDeviceId || !this.localIdentityId || this.trustEpoch === undefined || this.trustEpoch < 1) throw new Error('Durable device activation is unavailable.');
        const createdAt = Date.now();
        const unsigned = { version: 1 as const, eventId: crypto.randomUUID(), accountIdentityReference: this.userScope,
            issuerDeviceId: this.localDeviceId, issuerIdentityReference: this.localIdentityId,
            targetDeviceId: this.localDeviceId, targetIdentityReference: this.localIdentityId,
            operation: 'activate' as const, previousEpoch: this.trustEpoch - 1, nextEpoch: this.trustEpoch,
            createdAt, expiresAt: createdAt + 30_000 };
        const signature = await this.runtime.signControlEvent(encoder.encode(JSON.stringify(unsigned)));
        await makeRequest<unknown, typeof unsigned & { signature: string }>('device-trust/activation', { method: 'POST', body: { ...unsigned, signature } });
    }

    /** Every protected operation observes the current lifecycle epoch. */
    private async assertCurrentDeviceTrust(): Promise<void> {
        if (!this.deviceTrust) throw new Error('Device trust is unavailable.');
        try {
            const state = await this.deviceTrust.snapshot();
            await this.deviceTrust.assertTrustedAt(state.list.epoch);
            if (this.trustEpoch !== undefined && state.list.epoch < this.trustEpoch) throw new Error('Device trust is stale.');
            this.trustEpoch = state.list.epoch;
        } catch (error) {
            this.runtime.close();
            this.callComposition = undefined;
            this.callSignalTransport = undefined;
            throw error;
        }
    }

    private async withTabLock<T>(conversationId: string, operation: () => Promise<T>, persistLease = false, signal?: AbortSignal): Promise<T> {
        const locks = (globalThis as typeof globalThis & { navigator?: { locks?: { request: (name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>) => Promise<T> } } }).navigator?.locks;
        if (typeof (globalThis as typeof globalThis & { window?: unknown }).window === 'undefined') return operation();
        const browser = globalThis as typeof globalThis & { localStorage?: Storage };
        if (!browser.localStorage) {
            if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') return operation();
            throw new Error('Secure conversation requires a browser tab lock.');
        }
        const key = `k3ncrypt-tab-lease:${conversationId}`;
        const lockName = `k3ncrypt-modern:${conversationId}`;
        const now = Date.now();
        const current = browser.localStorage.getItem(key);
        const [owner, expires] = current?.split(':') ?? [];
        if (owner && owner !== this.tabOwnerId && Number(expires) > now) throw new Error('This secure conversation is active in another tab.');
        if (this.fallbackLeaseKey !== key) {
            browser.localStorage.setItem(key, `${this.tabOwnerId}:${now + TAB_LEASE_MS}`);
            this.fallbackLeaseKey = key;
        }
        try {
            const result = locks ? await locks.request(lockName, { ...(signal ? { signal } : {}) }, operation) : await operation();
            if (persistLease) {
                if (this.fallbackLeaseTimer) clearInterval(this.fallbackLeaseTimer);
                this.fallbackLeaseTimer = setInterval(() => this.refreshFallbackLease(browser.localStorage!, key), TAB_LEASE_MS / 3);
            } else this.refreshFallbackLease(browser.localStorage, key);
            return result;
        } catch (error) {
            if (persistLease) this.releaseFallbackLease();
            throw error;
        }
    }

    private refreshFallbackLease(storage: Storage, key: string): void {
        if (this.fallbackLeaseKey === key) storage.setItem(key, `${this.tabOwnerId}:${Date.now() + TAB_LEASE_MS}`);
    }

    private releaseFallbackLease(): void {
        if (this.fallbackLeaseTimer) clearInterval(this.fallbackLeaseTimer);
        this.fallbackLeaseTimer = undefined;
        if (this.fallbackLeaseKey) {
            const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
            const current = storage?.getItem(this.fallbackLeaseKey);
            if (current?.startsWith(`${this.tabOwnerId}:`)) storage?.removeItem(this.fallbackLeaseKey);
            this.fallbackLeaseKey = undefined;
        }
    }

    private async observe(address: string, identity: VodozemacPublicIdentity, expectedCommitment?: string, authenticatedInboundFirstContact = false): Promise<void> {
        const fingerprint = await fingerprintVodozemacIdentity(identity);
        const known = await this.registry.get(address);
        if (!known && !authenticatedInboundFirstContact && (!expectedCommitment || fingerprint !== expectedCommitment)) {
            throw new Error('The invitation identity commitment is missing or does not match the published identity.');
        }
        const event = await this.registry.observe(address, {
            identityId: fingerprint,
            publicKey: encoder.encode(JSON.stringify(identity)),
            algorithm: 'Olm-Curve25519+Ed25519', verification: 'unverified',
        });
        await this.onContactChange?.(event.current);
        if (event.kind === 'identity-changed' || event.current.changeStatus !== 'unchanged') {
            throw new Error('This contact’s identity changed. Review it before continuing.');
        }
    }

    private async readPending(): Promise<PendingEnvelope[]> {
        const values = parseList<PendingEnvelope>(await this.storage.read(OUTBOX_RECORD, this.roomId!));
        if (values.length > MAX_PENDING || values.some((item) => !item || firstMessage(item.envelope) === undefined ||
            (item.clientId !== undefined && (typeof item.clientId !== 'string' || !item.clientId)) ||
            (item.senderOrigin !== undefined && !isSenderOriginMetadata(item.senderOrigin)))) {
            throw new Error('Modern pending delivery state is invalid.');
        }
        return values;
    }

    private async digest(envelope: EncryptedEnvelope): Promise<string> {
        const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(envelope))));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
}
