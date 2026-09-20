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
    private retryTimer?: ReturnType<typeof setInterval>;
    private onMessage?: (text: string) => void;
    private onContactChange?: (contact: StoredContactIdentity) => void;
    private readonly tabOwnerId = `${Math.random().toString(36).slice(2)}-${Date.now()}`;
    private fallbackLeaseKey?: string;
    private fallbackLeaseTimer?: ReturnType<typeof setInterval>;
    private unloadHandler?: () => void;

    constructor(private readonly storage: SecureStorage, loader: VodozemacBindingsLoader, transportManager?: TransportManager) {
        this.runtime = new VodozemacRuntime(storage, loader);
        this.registry = new ContactIdentityRegistry(storage);
        this.modes = new ConversationModeStore(storage);
        const relay = transportManager ? undefined : new SocketIoRelayTransport(() => this.subscriptions, new Logger('ModernConversation'),
            async (message) => this.receiveMutex.runExclusive(() => this.withTabLock(this.roomId ?? 'unknown', () => this.receive(message.envelope, message.senderRoutingId))));
        this.transport = transportManager ?? new DefaultTransportManager(relay!);
        this.subscriptions.set('on-alice-join', new Set([() => { void this.retryPending(); }]));
        this.subscriptions.set('delivered', new Set([(id: string) => { void this.acceptDelivery(id); }]));
    }

    public async connect(roomId: string, capability: string, remoteAddress?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void): Promise<ModernConnectionDetails> {
        return this.withTabLock(roomId, () => this.connectUnlocked(roomId, capability, remoteAddress, onMessage, onContactChange), true);
    }

    private async connectUnlocked(roomId: string, capability: string, remoteAddress?: string, onMessage?: (text: string) => void, onContactChange?: (contact: StoredContactIdentity) => void): Promise<ModernConnectionDetails> {
        if (!/^[0-9a-f-]{36}$/i.test(roomId) || !capability) throw new Error('Invalid private conversation invitation.');
        this.roomId = roomId;
        this.capability = capability;
        this.onMessage = onMessage;
        this.onContactChange = onContactChange;
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

        if (this.remoteAddress && !saved?.sessionId) {
            const contact = validateVodozemacPublicBundle(await fetchVodozemacBundle(roomId, capability, this.remoteAddress));
            await this.observe(this.remoteAddress, contact.identity);
            if (contact.oneTimeKeys.length === 0) throw new Error('The contact has no available invitation keys.');
            const claimed = await claimVodozemacOneTimeKey(roomId, capability, this.remoteAddress, contact.oneTimeKeys[0].id);
            if (claimed.key !== contact.oneTimeKeys[0].key) throw new Error('The claimed invitation key changed.');
            await this.runtime.establishOutboundSession(roomId, contact.identity.curve25519, claimed.key);
            await this.modes.write(roomId, { sessionId: this.runtime.activeSessionId, remoteAddress: this.remoteAddress });
        }

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

    public async send(text: string): Promise<'pending'> {
        if (this.roomId) return this.withTabLock(this.roomId, () => this.sendUnlocked(text));
        throw new Error('The private contact is not ready.');
    }

    private async sendUnlocked(text: string): Promise<'pending'> {
        if (!this.roomId || !this.runtime.activeSessionId || !text.trim()) throw new Error('The private contact is not ready.');
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
        if (!this.roomId || !this.localAddress || !this.localIdentityId || !this.remoteAddress) {
            throw new Error('Modern conversation is not ready for calling.');
        }
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
        return createAuthenticatedCallComposition({
            session: this.runtime.getAuthenticatedSession(),
            transport: this.transport,
            conversationId: this.roomId,
            localIdentityId: this.localIdentityId,
            localParticipantId: this.localAddress,
            remoteParticipant,
            identity,
        });
    }

    public async verifyContact(confirmed: boolean): Promise<void> {
        if (!confirmed || !this.remoteAddress) throw new Error('Confirm the comparison before verifying this contact.');
        await this.registry.markVerified(this.remoteAddress);
    }

    /** Explicitly accepts a changed public identity; the prior session is discarded and a fresh pre-key flow is required. */
    public async acceptChangedIdentity(): Promise<void> {
        if (!this.roomId || !this.remoteAddress) throw new Error('No changed contact is open.');
        await this.registry.acceptPendingChange(this.remoteAddress);
        await this.storage.delete('vodozemac-session', this.roomId);
        await this.modes.write(this.roomId, { sessionId: undefined });
        this.runtime.close();
    }

    public async close(): Promise<void> {
        if (this.retryTimer) clearInterval(this.retryTimer);
        await this.transport.stop();
        this.runtime.close();
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
