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
import { DeviceLifecycleService, createEnrollmentRequest, createEnrollmentConfirmation, createRevocationConfirmation, type AuthenticatedDeviceContext, type DeviceAuthorization, type EnrollmentRequest, type LifecycleStateSnapshot } from '../devices/lifecycle';
import { AuthenticatedDeviceJoinService } from '../devices/join';
import { createDeviceList } from '../devices/deviceList';
import { createDeviceEntry } from '../devices/deviceIdentity';
import { RuntimeSyncController } from '../sync/runtime';
import type { SyncPersistence, SyncAuthorization } from '../sync/contracts';
import { AuthenticatedSyncTransport, type SyncSessionBinding } from '../sync/authenticatedTransport';
import { loadAccountBinding } from '../identity/accountBinding';
import { DeviceContextAuthority } from '../devices/authenticatedContext';
import { SocketSyncRelay } from '../sync/relay';
import { configContext } from '../configContext';
import { SecureSyncPersistence } from '../sync/persistence';

const OUTBOX_RECORD = 'modern-outbox';
const SEEN_RECORD = 'modern-seen';
const PUBLICATION_RECORD = 'modern-publication';
const MAX_PENDING = 32;
const MAX_SEEN = 1024;
const TAB_LEASE_MS = 15_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PendingEnvelope { envelope: EncryptedEnvelope; relayId?: string; sentAt?: number; }
interface PublicationMarker { version: 1; roomId: string; address?: string; }
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
    private syncRelay?: SocketSyncRelay;
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
                return this.receiveMutex.runExclusive(() => this.withTabLock(this.roomId ?? 'unknown', () => this.receive(message.envelope, message.senderRoutingId)));
            });
        this.transport = transportManager ?? new DefaultTransportManager(relay!);
        this.subscriptions.set('on-alice-join', new Set([() => { void this.retryPending(); }]));
        this.subscriptions.set('delivered', new Set([(id: string) => { void this.acceptDelivery(id); }]));
    }

    public async connect(roomId: string, capability: string, remoteAddress?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void, onDeviceControl?: (message: DeviceControlEvent) => void): Promise<ModernConnectionDetails> {
        return this.withTabLock(roomId, () => this.connectUnlocked(roomId, capability, remoteAddress, onMessage, onContactChange, onDeviceControl), true);
    }

    private async connectUnlocked(roomId: string, capability: string, remoteAddress?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void, onDeviceControl?: (message: DeviceControlEvent) => void): Promise<ModernConnectionDetails> {
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
            await this.observe(this.remoteAddress, contactBundle.identity);
        }

        let localAddress = saved?.localAddress ?? publication?.address;
        if (localAddress) {
            try { await fetchVodozemacBundle(roomId, capability, localAddress); }
            catch { throw new Error('This private invitation expired. Create a fresh conversation to continue.'); }
            const localBundle = await this.runtime.getPublicBundle();
            if (localBundle.oneTimeKeys.length < 10) {
                try {
                    await this.runtime.replenishOneTimeKeys(20);
                    await renewVodozemacBundle(roomId, capability, localAddress, await this.runtime.getPublicBundle());
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
            await this.storage.write(PUBLICATION_RECORD, 'local', asBytes({ version: 1, roomId, address: localAddress }));
        }
        if (publication || !saved?.localAddress) {
            await this.modes.write(roomId, { localAddress, remoteAddress: this.remoteAddress, sessionId: saved?.sessionId });
            await this.runtime.markPublicKeysPublished();
            await this.storage.delete(PUBLICATION_RECORD, 'local');
        }
        await this.modes.write(roomId, { localAddress, remoteAddress: this.remoteAddress, sessionId: saved?.sessionId });
        this.localAddress = localAddress;

        this.deviceLifecyclePersistence = new SecureStorageDeviceLifecyclePersistence(this.storage);
        const legacyDeviceList = await this.deviceLifecyclePersistence.read(this.localIdentityId);
        const binding = await loadAccountBinding(this.storage, this.localIdentityId, legacyDeviceList);
        this.userScope = binding.userScope;
        this.localDeviceId = binding.deviceId;
        const existingDeviceList = await this.deviceLifecyclePersistence.read(binding.userScope);
        if (!existingDeviceList) {
            const initialList = createDeviceList({ version: 1, identityReference: binding.userScope, epoch: 0, previousCommitment: null,
                devices: [createDeviceEntry({ deviceId: binding.deviceId, publicIdentityReference: this.localIdentityId, algorithm: 'Olm-Curve25519+Ed25519', state: 'active', createdAt: Date.now() })] });
            await this.deviceLifecyclePersistence.initialize(binding.userScope, initialList);
        }
        this.deviceTrust = new DeviceTrustEnforcer(this.deviceLifecyclePersistence, binding.userScope, binding.deviceId, this.localIdentityId);
        const trustSnapshot = await this.deviceTrust.snapshot();
        await this.deviceTrust.assertTrustedAt(trustSnapshot.list.epoch);
        this.trustEpoch = trustSnapshot.list.epoch;
        this.trustEvents = new TrustStateEventCoordinator(this.deviceTrust, binding.userScope);
        this.prepareDeviceControl();

        if (this.remoteAddress && !saved?.sessionId) {
            const contact = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress));
            await this.observe(this.remoteAddress, contact.identity);
            if (contact.oneTimeKeys.length === 0) throw new Error('The contact has no available invitation keys.');
            const claimed = await claimVodozemacOneTimeKey(roomId, capability, this.remoteAddress, contact.oneTimeKeys[0].id);
            if (claimed.key !== contact.oneTimeKeys[0].key) throw new Error('The claimed invitation key changed.');
            await this.runtime.establishOutboundSession(roomId, contact.identity.curve25519, claimed.key);
            await this.modes.write(roomId, { sessionId: this.runtime.activeSessionId, remoteAddress: this.remoteAddress });
        }
        this.prepareDeviceControl();

        await this.transport.start();
        this.transport.join(roomId, localAddress, capability);
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

    /** Configures the all-member freshness fence used by every protected operation. */
    public configureDeviceTrustFreshness(activeMemberDeviceIds: readonly string[]): void {
        if (!this.deviceTrust || activeMemberDeviceIds.length === 0) throw new Error('Device trust is unavailable.');
        this.deviceTrust.configureFreshnessMembers(activeMemberDeviceIds);
    }

    public async requestDeviceEnrollment(input: { requestedDeviceId: string; requestedPublicIdentityReference: string; algorithm: string }): Promise<EnrollmentRequest> {
        this.prepareDeviceControl();
        if (!this.deviceControlChannel || !this.localIdentityId) throw new Error('Device enrollment requires a ready modern session.');
        await this.assertCurrentDeviceTrust();
        const state = await this.getDeviceLifecycleState();
        if (!state) throw new Error('Device lifecycle state unavailable.');
        const request = createEnrollmentRequest({ ...input, userScope: this.userScope!, knownEpoch: state.list.epoch });
        await this.deviceControlChannel.send({ type: 'enrollment-request', payload: request });
        return request;
    }

    public async approveDeviceEnrollment(request: EnrollmentRequest, confirmedTarget: { deviceId: string; publicIdentityReference: string }): Promise<DeviceAuthorization> {
        await this.assertCurrentDeviceTrust();
        const service = this.requireDeviceLifecycle();
        const authorization = await service.approveEnrollment(request, this.deviceContext(), confirmedTarget);
        await this.deviceControlChannel!.send({ type: 'enrollment-approval', payload: authorization });
        await service.applyEnrollment(authorization, this.deviceContext());
        return authorization;
    }

    public async confirmDeviceEnrollment(authorization: DeviceAuthorization): Promise<LifecycleStateSnapshot> {
        await this.assertCurrentDeviceTrust();
        const service = this.requireDeviceLifecycle();
        const confirmation = await createEnrollmentConfirmation({ version: 1, authorizationDigest: authorization.authorizationDigest,
            targetDeviceId: authorization.targetDeviceId, targetIdentityReference: authorization.targetPublicIdentityReference!,
            confirmationNonce: `${authorization.transactionNonce}-confirm`, confirmedAt: Date.now(), expiresAt: authorization.expiresAt });
        await this.deviceControlChannel!.send({ type: 'enrollment-approval', payload: confirmation });
        return service.confirmEnrollment(authorization, this.deviceContext(), confirmation);
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
        const target = next.list.devices.find((entry) => entry.deviceId === authorization.targetDeviceId);
        if (target && (target.state === 'active' || target.state === 'revoked')) {
            await this.deviceControlChannel!.send({ type: 'trust-state', payload: {
                version: 1, eventId: `${authorization.transactionNonce}:${next.list.epoch}`, scope: this.userScope!,
                epoch: next.list.epoch, commitment: next.commitment, deviceId: target.deviceId,
                identityReference: target.publicIdentityReference, state: target.state, createdAt: Date.now(),
            } satisfies TrustStateEvent });
        }
        return authorization;
    }

    public async send(text: string): Promise<'pending'> {
        if (this.roomId) return this.withTabLock(this.roomId, () => this.sendUnlocked(text));
        throw new Error('The private contact is not ready.');
    }

    private async sendUnlocked(text: string): Promise<'pending'> {
        if (!this.roomId || !this.runtime.activeSessionId || !text.trim()) throw new Error('The private contact is not ready.');
        await this.assertCurrentDeviceTrust();
        const contact = await this.getContact();
        if (contact?.changeStatus !== 'unchanged') throw new Error('Review this contact’s changed identity before sending.');
        await this.deliveryMutex.runExclusive(async () => {
            const pending = await this.readPending();
            if (pending.length >= MAX_PENDING) throw new Error('Too many messages are waiting to send.');
            const envelope = await this.runtime.encrypt('message', encoder.encode(text).buffer as ArrayBuffer);
            pending.push({ envelope });
            await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(pending));
        });
        await this.retryPending();
        return 'pending';
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
            const next = pending.filter((item) => item.relayId !== relayId);
            if (next.length !== pending.length) await this.storage.write(OUTBOX_RECORD, this.roomId!, asBytes(next));
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
        await this.assertCurrentDeviceTrust();
        if (!this.roomId || !this.capability || !senderAddress ||
            (this.remoteAddress && senderAddress !== this.remoteAddress)) return false;
        const digest = await this.digest(envelope);
        const seen = parseList<string>(await this.storage.read(SEEN_RECORD, this.roomId));
        if (seen.includes(digest)) return true;
        let text: string;
        if (!this.runtime.activeSessionId) {
            const bundle = validateVodozemacPublicBundle(await fetchVodozemacBundle(this.roomId, this.capability, senderAddress));
            const pinned = await this.registry.get(senderAddress);
            const fingerprint = await fingerprintVodozemacIdentity(bundle.identity);
            if (pinned && (pinned.identityId !== fingerprint || pinned.changeStatus !== 'unchanged')) {
                await this.observe(senderAddress, bundle.identity);
                return false;
            }
            const plaintext = await this.runtime.establishInboundSession(this.roomId, bundle.identity.curve25519, firstMessage(envelope));
            text = unframeFirstMessage(plaintext);
            await this.observe(senderAddress, bundle.identity);
            this.remoteAddress = senderAddress;
            await this.modes.write(this.roomId, { sessionId: this.runtime.activeSessionId, remoteAddress: senderAddress });
        } else {
            text = decoder.decode(await this.runtime.decrypt('message', envelope));
        }
        await this.storage.write(SEEN_RECORD, this.roomId, asBytes([...seen.slice(-(MAX_SEEN - 1)), digest]));
        this.onMessage?.(text);
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
        if (message.type === 'enrollment-request' && this.deviceLifecycle) {
            const request = message.payload as EnrollmentRequest | undefined;
            if (!request || request.userScope !== this.userScope || request.requestedPublicIdentityReference !== contact.identityId) return;
            this.onDeviceControl?.(message as DeviceControlEvent);
        }
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

    private async observe(address: string, identity: VodozemacPublicIdentity): Promise<void> {
        const event = await this.registry.observe(address, {
            identityId: await fingerprintVodozemacIdentity(identity),
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
