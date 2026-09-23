import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { VODOZEMAC_ENVELOPE_VERSION, VODOZEMAC_STRATEGY_ID } from '../core/vodozemacCryptoSession';
import { claimVodozemacOneTimeKey, fetchVodozemacBundle, publishVodozemacBundle, renewVodozemacBundle } from '../api/prekeys';
import { deleteLink } from '../api/links';
import { ContactIdentityRegistry, type StoredContactIdentity } from '../identity/contactIdentityRegistry';
import { fingerprintVodozemacIdentity, type VodozemacPublicIdentity } from '../identity/vodozemacIdentity';
import { validateVodozemacPublicBundle } from '../identity/vodozemacBundle';
import { DefaultTransportManager } from '../transports/transportManager';
import { SocketIoRelayTransport, type SubscriptionType } from '../transports/socketIoRelayTransport';
import { Logger } from '../utils/logger';
import { AsyncMutex } from '../utils/asyncMutex';
import { ConversationModeStore } from './conversationMode';
import { VodozemacRuntime, type VodozemacBindingsLoader } from './vodozemacRuntime';
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
import { fromBase64Url } from './base64url';

const OUTBOX_RECORD = 'modern-outbox';
const SEEN_RECORD = 'modern-seen';
const PUBLICATION_RECORD = 'modern-publication';
const MAX_PENDING = 32;
const MAX_SEEN = 1024;
const TAB_LEASE_MS = 15_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PendingEnvelope { envelope: EncryptedEnvelope; relayId?: string; sentAt?: number; clientId?: string; }
interface PublicationMarker { version: 1; roomId: string; address?: string; routingProof?: string; }
export interface ModernConnectionDetails {
    ownFingerprint: string;
    ownAddress: string;
    contact?: StoredContactIdentity;
}
export type DeviceControlEvent = DeviceControlMessage;

const asBytes = (value: unknown): ArrayBuffer => encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer;
const parseList = <T>(bytes: ArrayBuffer | undefined): T[] => {
    if (!bytes) return [];
    const value = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(value)) throw new Error('Modern delivery state is invalid.');
    return value as T[];
};

const firstMessage = (envelope: EncryptedEnvelope): string => {
    if (envelope.version !== VODOZEMAC_ENVELOPE_VERSION || envelope.strategy !== VODOZEMAC_STRATEGY_ID ||
        !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
        throw new Error('Unsupported modern message.');
    }
    const data = envelope.data as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'olmMessage,version' || data.version !== 1 ||
        typeof data.olmMessage !== 'string' || data.olmMessage.length > 192 * 1024) {
        throw new Error('Malformed modern message.');
    }
    return data.olmMessage;
};

const unframeFirstMessage = (bytes: ArrayBuffer): string => {
    const value = new Uint8Array(bytes);
    try {
        if (value.length < 2 || value[0] !== 1 || value[1] !== 1) throw new Error('Modern message binding is invalid.');
        return decoder.decode(value.slice(2));
    } finally { value.fill(0); }
};

/** Application-facing modern path; it uses the same relay transport and ACK callback as legacy chat. */
export class ModernConversation {
    private readonly runtime: VodozemacRuntime;
    private readonly registry: ContactIdentityRegistry;
    private readonly modes: ConversationModeStore;
    private readonly subscriptions: SubscriptionType = new Map();
    private readonly transport: TransportManager;
    private readonly deliveryMutex = new AsyncMutex();
    private readonly receiveMutex = new AsyncMutex();
    private roomId?: string;
    private capability?: string;
    private remoteAddress?: string;
    private selectedRemotePreKeyId?: string;
    private lastInboundEnvelopeMetadata?: { protocolVersion: number; messageType: number; routingIdentity: string };
    private lastInboundFailureCategory?: string;
    /** A replay can arrive while connect() owns the conversation tab lock. */
    private connecting = false;
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
    private deliveryObserver?: (clientId: string, state: 'accepted') => void;
    private syncRelay?: SocketSyncRelay;
    private groupAdapter?: SecureStorageGroupRuntimeAdapter;
    private groupRuntime?: GroupSecurityRuntime;
    private recoveryRuntime?: RecoveryRuntime;
    private durableProofs?: DeviceProofClient;
    private retryTimer?: ReturnType<typeof setInterval>;
    private onMessage?: (text: string) => void;
    private onContactChange?: (contact: StoredContactIdentity) => void;
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
                if (message.channel === 'signaling') {
                    await this.assertCurrentDeviceTrust();
                    this.prepareDeviceControl();
                    if (this.deviceControlChannel) {
                        const plaintext = await this.runtime.decrypt('signaling', message.envelope);
                        const control = this.deviceControlChannel.decode(plaintext);
                        if (control) await this.handleDeviceControl(control);
                        else if (this.callSignalTransport) await this.callSignalTransport.receivePlaintext(plaintext);
                    } else if (this.callSignalTransport) await this.callSignalTransport.receive(message.envelope);
                    return false;
                }
                return this.receiveMutex.runExclusive(() => this.connecting
                    ? this.receive(message.envelope, message.senderRoutingId)
                    : this.withTabLock(this.roomId ?? 'unknown', () => this.receive(message.envelope, message.senderRoutingId)));
            });
        this.transport = transportManager ?? new DefaultTransportManager(relay!);
        this.subscriptions.set('on-alice-join', new Set([() => { void this.retryPending(); }]));
        this.subscriptions.set('delivered', new Set([(id: string) => { void this.acceptDelivery(id); }]));
    }

    public async connect(roomId: string, capability: string, remoteAddress?: string, remoteIdentityCommitment?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void, onDeviceControl?: (message: DeviceControlEvent) => void): Promise<ModernConnectionDetails> {
        const details = await this.withTabLock(roomId, async () => {
            this.connecting = true;
            try { return await this.connectUnlocked(roomId, capability, remoteAddress, remoteIdentityCommitment, onMessage, onContactChange, onDeviceControl); }
            finally { this.connecting = false; }
        }, true);
        const activeTransport = this.transport.activeTransport();
        if (activeTransport instanceof SocketIoRelayTransport) await activeTransport.requestMailboxReplay();
        return details;
    }

    private async connectUnlocked(roomId: string, capability: string, remoteAddress?: string, remoteIdentityCommitment?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void, onDeviceControl?: (message: DeviceControlEvent) => void): Promise<ModernConnectionDetails> {
        if (!/^[0-9a-f-]{36}$/i.test(roomId) || !capability) throw new Error('Invalid private conversation invitation.');
        this.roomId = roomId;
        this.capability = capability;
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
        const saved = await this.modes.read(roomId);
        const requestedContact = remoteAddress === saved?.localAddress ? undefined : remoteAddress;
        if (saved?.remoteAddress && requestedContact && saved.remoteAddress !== requestedContact) throw new Error('The contact address changed. Review the connection before continuing.');
        this.remoteAddress = requestedContact ?? saved?.remoteAddress;
        if (saved?.sessionId) await this.runtime.restoreSession(roomId, saved.sessionId);
        if (this.remoteAddress && saved?.sessionId) {
            const contactBundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress));
            await this.observe(this.remoteAddress, contactBundle.identity, remoteIdentityCommitment);
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
            const contact = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress));
            await this.observe(this.remoteAddress, contact.identity, remoteIdentityCommitment);
            if (contact.oneTimeKeys.length === 0) throw new Error('The contact has no available invitation keys.');
            const claimed = await claimVodozemacOneTimeKey(roomId, capability, this.remoteAddress, contact.oneTimeKeys[0].id);
            if (claimed.key !== contact.oneTimeKeys[0].key) throw new Error('The claimed invitation key changed.');
            this.selectedRemotePreKeyId = contact.oneTimeKeys[0].id;
            await this.runtime.establishOutboundSession(roomId, contact.identity.curve25519, claimed.key);
            await this.modes.write(roomId, { sessionId: this.runtime.activeSessionId, remoteAddress: this.remoteAddress });
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
        await this.transport.start();
        if (!routingProof) throw new Error('Modern routing ownership proof is unavailable.');
        await this.transport.join(roomId, localAddress, capability, routingProof);
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

    /** Guarded test harness view of public crypto metadata only. */
    public async testOnlyCryptoSnapshot(): Promise<{ identityFingerprint?: string; oneTimeKeyIds: string[]; availableKeyCount: number; selectedRecipientKeyId?: string; lastInboundEnvelope?: { protocolVersion: number; messageType: number; routingIdentity: string }; inboundFailureCategory?: string; runtimeEntry?: unknown; runtimeStage?: string }> {
        if ((globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ !== true) throw new Error('Test-only diagnostics are disabled.');
        const bundle = await this.runtime.getPublicBundle();
        return { identityFingerprint: this.localIdentityId, oneTimeKeyIds: bundle.oneTimeKeys.map((key) => key.id), availableKeyCount: bundle.oneTimeKeys.length, selectedRecipientKeyId: this.selectedRemotePreKeyId, lastInboundEnvelope: this.lastInboundEnvelopeMetadata, inboundFailureCategory: this.lastInboundFailureCategory, runtimeEntry: this.runtime.testOnlyInboundEntry(), runtimeStage: this.runtime.testOnlyInboundStage() };
    }

    /** Short-lived request proof for the host's authenticated ciphertext attachment adapter. */
    public async attachmentAuthorizationHeaders(): Promise<Record<string, string>> {
        await this.assertCurrentDeviceTrust();
        if (!this.roomId || !this.capability || !this.localAddress) throw new Error('Attachment authorization is unavailable.');
        const mode = await this.modes.read(this.roomId);
        if (!mode?.routingProof || mode.localAddress !== this.localAddress) throw new Error('Attachment ownership proof is unavailable.');
        return {
            'X-K3ncrypt-Conversation': this.roomId,
            'X-K3ncrypt-Participant': this.localAddress,
            'X-K3ncrypt-Control-Capability': this.capability,
            'X-K3ncrypt-Routing-Proof': mode.routingProof,
            'X-K3ncrypt-Request-Id': crypto.randomUUID(),
        };
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

    public async sendWithReceipt(text: string): Promise<string> {
        if (this.roomId) return this.withTabLock(this.roomId, () => this.sendUnlocked(text));
        throw new Error('The private contact is not ready.');
    }

    public onDeliveryUpdate(observer: (clientId: string, state: 'accepted') => void): void { this.deliveryObserver = observer; }

    private async sendUnlocked(text: string): Promise<string> {
        if (!this.roomId || !this.runtime.activeSessionId || !text.trim()) throw new Error('The private contact is not ready.');
        await this.assertCurrentDeviceTrust();
        const contact = await this.getContact();
        if (contact?.changeStatus !== 'unchanged') throw new Error('Review this contact’s changed identity before sending.');
        const clientId = crypto.randomUUID();
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            if (pending.length >= MAX_PENDING) throw new Error('Too many messages are waiting to send.');
            const envelope = await this.runtime.encrypt('message', encoder.encode(text).buffer as ArrayBuffer);
            pending.push({ envelope, clientId });
            await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(pending));
        });
        await this.retryPending();
        return clientId;
    }

    public async retryPending(): Promise<void> {
        if (!this.roomId) return;
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            for (const item of pending) {
                if (item.relayId && item.sentAt && Date.now() - item.sentAt < 5000) continue;
                try {
                    await this.assertCurrentDeviceTrust();
                    const sent = await this.transport.sendEnvelope('message', item.envelope, this.remoteAddress);
                    item.relayId = sent.id;
                    item.sentAt = Date.now();
                    await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(pending));
                } catch { return; }
            }
        });
    }

    public async acceptDelivery(relayId: string): Promise<void> {
        if (!this.roomId) return;
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            const accepted = pending.find((item) => item.relayId === relayId);
            const next = pending.filter((item) => item.relayId !== relayId);
            if (next.length !== pending.length) await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(next));
            if (accepted?.clientId) this.deliveryObserver?.(accepted.clientId, 'accepted');
        });
    }

    public async getContact(): Promise<StoredContactIdentity | undefined> {
        return this.remoteAddress ? this.registry.get(this.remoteAddress) : undefined;
    }

    /**
     * Creates the only call composition available to a modern conversation.
     * A ready modern session, stable routing identities, and an explicitly
     * verified contact are all required; legacy conversations cannot reach
     * this boundary because they do not own a ModernConversation instance.
     */
    public async createAuthenticatedCallComposition(): Promise<AuthenticatedCallComposition> {
        if (this.callComposition) return this.callComposition;
        if (!this.roomId || !this.localAddress || !this.localIdentityId || !this.remoteAddress) {
            throw new Error('Modern conversation is not ready for calling.');
        }
        await this.assertCurrentDeviceTrust();
        const contact = await this.getContact();
        if (!contact || contact.changeStatus !== 'unchanged' || contact.verification !== 'verified') {
            throw new Error('Verify this contact before starting a call.');
        }
        const localParticipant: CallParticipant = { participantId: this.localAddress, identityId: this.localIdentityId, verification: 'verified' };
        const remoteParticipant: CallParticipant = { participantId: this.remoteAddress, identityId: contact.identityId, verification: contact.verification };
        const identity = new VerifiedCallIdentityVerifier(
            new Set([localParticipant.participantId, remoteParticipant.participantId]),
            new Map([[localParticipant.participantId, localParticipant.verification], [remoteParticipant.participantId, remoteParticipant.verification]]),
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

    public async verifyContact(confirmed: boolean): Promise<void> {
        if (!confirmed || !this.remoteAddress) throw new Error('Confirm the comparison before verifying this contact.');
        await this.registry.markVerified(this.remoteAddress);
    }

    /** Explicitly accepts a changed public identity; the prior session is discarded and a fresh pre-key flow is required. */
    public async acceptChangedIdentity(): Promise<void> {
        this.syncRelay?.close();
        if (!this.roomId || !this.remoteAddress) throw new Error('No changed contact is open.');
        await this.registry.acceptPendingChange(this.remoteAddress);
        await this.storage.delete('vodozemac-session', this.roomId);
        await this.modes.write(this.roomId, { sessionId: undefined });
        this.runtime.close();
        this.callComposition = undefined;
        this.callSignalTransport = undefined;
        this.syncController = undefined;
        this.groupRuntime = undefined;
        this.groupAdapter = undefined;
        this.recoveryRuntime = undefined;
    }

    public async close(): Promise<void> {
        this.syncRelay?.close();
        if (this.retryTimer) clearInterval(this.retryTimer);
        await this.transport.stop();
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
        this.storage.lock();
    }

    public async delete(): Promise<void> {
        if (!this.roomId || !this.capability) throw new Error('No modern conversation is open.');
        await deleteLink({ channelID: this.roomId, controlCapability: this.capability });
        await this.storage.delete(OUTBOX_RECORD, this.roomId);
        await this.storage.delete(SEEN_RECORD, this.roomId);
        await this.storage.delete('vodozemac-session', this.roomId);
        await this.storage.delete('conversation-protocol', this.roomId);
        if (this.remoteAddress) await this.storage.delete('contact-identity', this.remoteAddress);
        await this.close();
    }

    private async receive(envelope: EncryptedEnvelope, senderAddress?: string): Promise<boolean> {
        this.lastInboundFailureCategory = 'envelope-received';
        try { await this.assertCurrentDeviceTrust(); }
        catch (error) { this.lastInboundFailureCategory = 'device-trust'; throw error; }
        if (!this.roomId || !this.capability || !senderAddress ||
            (this.remoteAddress && senderAddress !== this.remoteAddress)) return false;
        const digest = await this.digest(envelope);
        const seen = parseList<string>(await this.storage.read(SEEN_RECORD, this.roomId));
        if (seen.includes(digest)) return true;
        let text: string;
        if (!this.runtime.activeSessionId) {
            this.lastInboundFailureCategory = 'sender-bundle-requested';
            const wire = JSON.parse(firstMessage(envelope)) as { version?: unknown; message_type?: unknown };
            if (wire.version === 1 && typeof wire.message_type === 'number') this.lastInboundEnvelopeMetadata = { protocolVersion: wire.version, messageType: wire.message_type, routingIdentity: senderAddress };
            let bundle;
            try { bundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, senderAddress)); this.lastInboundFailureCategory = 'sender-bundle-retrieved'; }
            catch (error) { this.lastInboundFailureCategory = 'sender-bundle'; throw error; }
            const pinned = await this.registry.get(senderAddress);
            const fingerprint = await fingerprintVodozemacIdentity(bundle.identity);
            if (pinned && (pinned.identityId !== fingerprint || pinned.changeStatus !== 'unchanged')) {
                this.lastInboundFailureCategory = 'sender-identity';
                await this.observe(senderAddress, bundle.identity);
                return false;
            }
            this.lastInboundFailureCategory = 'runtime-entry';
            let plaintext: ArrayBuffer;
            try { plaintext = await this.runtime.establishInboundSession(this.roomId, bundle.identity.curve25519, firstMessage(envelope)); }
            catch (error) {
                // The public diagnostic hook is deliberately unavailable in a
                // production browser. Keep the operational category generic
                // there, while allowing the guarded test harness to refine it.
                if ((globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ === true) {
                    this.lastInboundFailureCategory = this.runtime.testOnlyInboundFailureStage() ?? 'runtime-entry';
                }
                throw error;
            }
            try { text = unframeFirstMessage(plaintext); }
            catch (error) { this.lastInboundFailureCategory = 'framing'; throw error; }
            // The conversation creator has no peer identity commitment until
            // the invitee speaks. At this point Olm has authenticated the
            // sender identity carried by the pre-key message; persist it only
            // as an unverified first-contact record. All later substitutions
            // still fail closed in observe().
            await this.observe(senderAddress, bundle.identity, undefined, true);
            this.remoteAddress = senderAddress;
            await this.modes.write(this.roomId, { sessionId: this.runtime.activeSessionId, remoteAddress: senderAddress });
        } else {
            text = decoder.decode(await this.runtime.decrypt('message', envelope));
        }
        await this.storage.write(SEEN_RECORD, this.roomId, asBytes([...seen.slice(-(MAX_SEEN - 1)), digest]));
        this.onMessage?.(text);
        this.lastInboundFailureCategory = undefined;
        return true;
    }

    private requireDeviceLifecycle(): DeviceLifecycleService {
        this.prepareDeviceControl();
        if (!this.deviceLifecycle || !this.deviceControlChannel) throw new Error('Device lifecycle requires a ready modern session.');
        return this.deviceLifecycle;
    }

    private prepareDeviceControl(): void {
        if (this.deviceControlChannel || !this.deviceLifecyclePersistence || !['active', 'persisted'].includes(this.runtime.lifecycle)) return;
        this.deviceControlChannel = new AuthenticatedDeviceControlChannel(this.runtime.getAuthenticatedSession(), this.transport);
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

    private async withTabLock<T>(conversationId: string, operation: () => Promise<T>, persistLease = false): Promise<T> {
        const locks = (globalThis as typeof globalThis & { navigator?: { locks?: { request: (name: string, callback: () => Promise<T>) => Promise<T> } } }).navigator?.locks;
        if (typeof (globalThis as typeof globalThis & { window?: unknown }).window === 'undefined') return operation();
        const browser = globalThis as typeof globalThis & { localStorage?: Storage };
        if (!browser.localStorage) {
            if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') return operation();
            throw new Error('Secure conversation requires a browser tab lock.');
        }
        const key = `k3ncrypt-tab-lease:${conversationId}`;
        const now = Date.now();
        const current = browser.localStorage.getItem(key);
        const [owner, expires] = current?.split(':') ?? [];
        if (owner && owner !== this.tabOwnerId && Number(expires) > now) throw new Error('This secure conversation is active in another tab.');
        if (this.fallbackLeaseKey !== key) {
            browser.localStorage.setItem(key, `${this.tabOwnerId}:${now + TAB_LEASE_MS}`);
            this.fallbackLeaseKey = key;
        }
        try {
            const result = locks ? await locks.request(`k3ncrypt-modern:${conversationId}`, operation) : await operation();
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
        this.onContactChange?.(event.current);
        if (event.kind === 'identity-changed' || event.current.changeStatus !== 'unchanged') {
            throw new Error('This contact’s identity changed. Review it before continuing.');
        }
    }

    private async readPending(): Promise<PendingEnvelope[]> {
        const values = parseList<PendingEnvelope>(await this.storage.read(OUTBOX_RECORD, this.roomId!));
        if (values.length > MAX_PENDING || values.some((item) => !item || firstMessage(item.envelope) === undefined)) {
            throw new Error('Modern pending delivery state is invalid.');
        }
        return values;
    }

    private async digest(envelope: EncryptedEnvelope): Promise<string> {
        const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(envelope))));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
}
