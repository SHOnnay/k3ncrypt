import type { CryptoSession, SecureStorage } from '../core/contracts';
import { VodozemacCryptoSession, type VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { PersistentVodozemacIdentity, type VodozemacAccountFactory } from '../identity/vodozemacIdentity';
import { VodozemacSessionStore, type VodozemacSessionFactory } from '../identity/vodozemacSessionStore';
import type { MessagingIdentity } from '../core/contracts';
import { VodozemacBoundaryError } from './vodozemacErrors';
import { AsyncMutex } from '../utils/asyncMutex';
import type { VodozemacPublicBundle } from '../identity/vodozemacBundle';

const TRANSACTION_RECORD_TYPE = 'vodozemac-commit';
type CommitPhase = 'prepared' | 'account-written' | 'committed';
interface CommitMarker { version: 1; conversationId: string; sessionId: string; phase: CommitPhase; }

export type VodozemacLifecycleState =
    | 'uninitialized'
    | 'crypto-ready'
    | 'identity-restored'
    | 'session-establishing'
    | 'active'
    | 'persisted'
    | 'closed'
    | 'error';

export interface VodozemacBindings {
    readonly protocolVersion: 1;
    readonly accountFactory: VodozemacAccountFactory;
    readonly sessionFactory: VodozemacSessionFactory;
}

export type VodozemacBindingsLoader = () => Promise<VodozemacBindings>;

/**
 * Explicit owner for the modern protocol. It deliberately accepts only opaque
 * factories and handles; UI code cannot access account keys or pickles.
 */
export class VodozemacRuntime {
    private state: VodozemacLifecycleState = 'uninitialized';
    private bindings?: VodozemacBindings;
    private identity?: PersistentVodozemacIdentity;
    private session?: VodozemacCryptoSession;
    private conversationId?: string;
    private sessionStore?: VodozemacSessionStore;
    private readonly sessionMutex = new AsyncMutex();

    constructor(
        private readonly storage: SecureStorage,
        private readonly loadBindings: VodozemacBindingsLoader,
    ) {}

    public get lifecycle(): VodozemacLifecycleState { return this.state; }
    public get activeSessionId(): string | undefined { return this.session?.sessionId(); }

    /**
     * Narrow application boundary for authenticated call composition. The
     * opaque session adapter is returned only while the modern session is
     * active; its identity/account handles and persistence keys never leave
     * this runtime.
     */
    public getAuthenticatedSession(): CryptoSession {
        this.requireState('active', 'persisted');
        if (!this.session?.ready) throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        const runtime = this;
        const boundSession = this.session;
        const check = (): void => {
            runtime.requireState('active', 'persisted');
            if (runtime.session !== boundSession) throw new VodozemacBoundaryError('MISSING_SESSION', 'Session binding expired.');
        };
        return Object.freeze({
            get encrypted() { return runtime.session === boundSession && boundSession.encrypted; },
            get ready() { return runtime.session === boundSession && boundSession.ready && ['active', 'persisted'].includes(runtime.state); },
            initialize: async () => { throw new Error('Session initialization belongs to the runtime.'); },
            encrypt: async (channel, plaintext) => { check(); return runtime.encrypt(channel, plaintext); },
            decrypt: async (channel, envelope) => { check(); return runtime.decrypt(channel, envelope); },
            destroy: () => { check(); runtime.close(); },
        } satisfies CryptoSession);
    }

    public async initialize(): Promise<void> {
        this.requireState('uninitialized');
        try {
            const bindings = await this.loadBindings();
            if (bindings.protocolVersion !== 1) {
                throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Unsupported modern crypto protocol.');
            }
        this.bindings = bindings;
        this.sessionStore = new VodozemacSessionStore(this.storage, bindings.sessionFactory);
        await this.recoverPendingCommit();
        this.state = 'crypto-ready';
        } catch (error) {
            this.state = 'error';
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto is unavailable.');
        }
    }

    public async restoreOrCreateIdentity(): Promise<MessagingIdentity> {
        this.requireState('crypto-ready');
        const bindings = this.bindings;
        if (!bindings) throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto is unavailable.');
        this.identity = new PersistentVodozemacIdentity(this.storage, bindings.accountFactory);
        try {
            const value = await this.identity.getOrCreate();
            this.state = 'identity-restored';
            return value;
        } catch {
            this.state = 'error';
            throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity could not be restored.');
        }
    }

    public async persistIdentity(): Promise<void> {
        this.requireState('identity-restored', 'active', 'persisted');
        if (!this.identity) throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity is unavailable.');
        try { await this.identity.persistAccount(); }
        catch { throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity could not be persisted.'); }
    }

    /** Returns public pre-key material for explicit publication by the caller. */
    public async getPublicBundle(): Promise<VodozemacPublicBundle> {
        this.requireState('identity-restored', 'active', 'persisted');
        if (!this.identity) throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity is unavailable.');
        try { return await this.identity.getPublicBundle(); }
        catch { throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The public identity could not be read.'); }
    }

    /** Marks the current public pre-key set as published and persists the account. */
    public async markPublicKeysPublished(): Promise<void> {
        this.requireState('identity-restored', 'active', 'persisted');
        if (!this.identity) throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity is unavailable.');
        try { await this.identity.markPublicKeysPublished(); }
        catch { throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The public keys could not be persisted.'); }
    }

    public async replenishOneTimeKeys(minimum = 10): Promise<void> {
        this.requireState('identity-restored', 'active', 'persisted');
        if (!this.identity) throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity is unavailable.');
        try { await this.identity.replenishOneTimeKeys(minimum); }
        catch { throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The one-time keys could not be replenished.'); }
    }

    /** Accepts an already-established opaque handle from the reviewed protocol flow. */
    public async establishSession(conversationId: string, handle: VodozemacSessionHandle, expectedSessionId: string): Promise<void> {
        this.requireState('identity-restored', 'persisted');
        if (!conversationId || !handle || !expectedSessionId) {
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The conversation session identity is invalid.');
        }
        this.state = 'session-establishing';
        try {
            const session = new VodozemacCryptoSession(handle);
            await session.initialize(expectedSessionId);
            this.session = session;
            this.conversationId = conversationId;
            this.state = 'active';
        } catch {
            this.state = 'error';
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The conversation session could not be established.');
        }
    }

    public async establishOutboundSession(
        conversationId: string,
        recipientIdentityKey: string,
        recipientOneTimeKey: string,
    ): Promise<void> {
        this.requireState('identity-restored', 'persisted');
        if (!this.identity || !recipientIdentityKey || !recipientOneTimeKey) {
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The recipient identity is invalid.');
        }
        try {
            const handle = await this.identity.withAccount(async (account) => {
                if (!account.createOutboundSession) throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Outbound modern sessions are unavailable.');
                return account.createOutboundSession(recipientIdentityKey, recipientOneTimeKey);
            });
            await this.establishSession(conversationId, handle, handle.sessionId());
            await this.commitAccountAndSession();
        } catch (error) {
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The outbound session could not be established.');
        }
    }

    public async establishInboundSession(
        conversationId: string,
        senderIdentityKey: string,
        preKeyMessage: string,
    ): Promise<ArrayBuffer> {
        this.requireState('identity-restored', 'persisted');
        if (!this.identity || !senderIdentityKey || !preKeyMessage) {
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The sender identity is invalid.');
        }
        try {
            const result = await this.identity.withAccount(async (account) => {
                if (!account.createInboundSession) throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Inbound modern sessions are unavailable.');
                return account.createInboundSession(senderIdentityKey, preKeyMessage);
            });
            const handle = result.takeSession();
            await this.establishSession(conversationId, handle, handle.sessionId());
            await this.commitAccountAndSession();
            const plaintext = result.plaintext();
            try { return plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer; }
            finally { plaintext.fill(0); }
        } catch (error) {
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The inbound session message could not be accepted.');
        }
    }

    public async restoreSession(conversationId: string, expectedSessionId: string): Promise<void> {
        this.requireState('identity-restored', 'persisted');
        if (!this.sessionStore) throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto is unavailable.');
        try {
            const handle = await this.sessionStore.load(conversationId);
            await this.establishSession(conversationId, handle, expectedSessionId);
        } catch (error) {
            if (error instanceof VodozemacBoundaryError) throw error;
            this.state = 'error';
            throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The conversation session could not be restored.');
        }
    }

    public async encrypt(channel: 'message' | 'signaling', plaintext: ArrayBuffer) {
        return this.sessionMutex.runExclusive(async () => {
            this.requireState('active', 'persisted');
            if (!this.session) throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
            await this.prepareMutation();
            let envelope;
            try { envelope = await this.session.encrypt(channel, plaintext); }
            catch { this.quarantineSession(); throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be encrypted.'); }
            try {
                await this.persistSessionUnsafe();
                await this.storage.delete(TRANSACTION_RECORD_TYPE, 'local');
                return envelope;
            } catch {
                this.quarantineSession();
                throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The message could not be safely persisted.');
            }
        });
    }

    public async decrypt(channel: 'message' | 'signaling', envelope: Parameters<VodozemacCryptoSession['decrypt']>[1]) {
        return this.sessionMutex.runExclusive(async () => {
            this.requireState('active', 'persisted');
            if (!this.session) throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
            await this.prepareMutation();
            let plaintext: ArrayBuffer | undefined;
            try { plaintext = await this.session.decrypt(channel, envelope); }
            catch { this.quarantineSession(); throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be decrypted.'); }
            try {
                await this.persistSessionUnsafe();
                await this.storage.delete(TRANSACTION_RECORD_TYPE, 'local');
                return plaintext;
            } catch {
                new Uint8Array(plaintext).fill(0);
                this.quarantineSession();
                throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The message could not be safely persisted.');
            }
        });
    }

    public async persistSession(): Promise<void> {
        await this.sessionMutex.runExclusive(() => this.persistSessionUnsafe(true));
    }
    private async prepareMutation(): Promise<void> {
        if (!this.conversationId || !this.session) throw new Error('Session unavailable.');
        const marker: CommitMarker = { version: 1, conversationId: this.conversationId, sessionId: this.session.sessionId(), phase: 'prepared' };
        await this.storage.write(TRANSACTION_RECORD_TYPE, 'local', new TextEncoder().encode(JSON.stringify(marker)).buffer as ArrayBuffer);
    }

    public close(): void {
        this.session?.destroy();
        this.identity?.lock();
        this.session = undefined;
        this.identity = undefined;
        this.bindings = undefined;
        this.state = 'closed';
    }

    private async persistSessionUnsafe(keepPersisted = false): Promise<void> {
        this.requireState('active', 'persisted');
        if (!this.session || !this.conversationId || !this.sessionStore) {
            throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        }
        await this.sessionStore.save(this.conversationId, this.session);
        this.state = keepPersisted ? 'persisted' : 'active';
    }

    /**
     * Commits an account mutation and its newly-created session with an
     * encrypted metadata marker. The marker never contains a pickle, key, or
     * plaintext. Recovery treats an incomplete commit as unsafe and discards
     * only the session record; the account mutation is never rolled back.
     */
    private async commitAccountAndSession(): Promise<void> {
        if (!this.identity || !this.session || !this.conversationId || !this.sessionStore) {
            throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        }
        const markerId = 'local';
        const writeMarker = async (phase: CommitPhase): Promise<void> => {
            const marker: CommitMarker = { version: 1, conversationId: this.conversationId!, sessionId: this.session!.sessionId(), phase };
            await this.storage.write(TRANSACTION_RECORD_TYPE, markerId,
                new TextEncoder().encode(JSON.stringify(marker)).buffer as ArrayBuffer);
        };
        await writeMarker('prepared');
        await this.persistIdentity();
        await writeMarker('account-written');
        await this.persistSessionUnsafe();
        await writeMarker('committed');
        await this.storage.delete(TRANSACTION_RECORD_TYPE, markerId);
        this.state = 'persisted';
    }

    private async recoverPendingCommit(): Promise<void> {
        const bytes = await this.storage.read(TRANSACTION_RECORD_TYPE, 'local');
        if (!bytes) return;
        let marker: CommitMarker;
        try {
            marker = JSON.parse(new TextDecoder().decode(bytes)) as CommitMarker;
            if (marker?.version !== 1 || typeof marker.conversationId !== 'string' ||
                typeof marker.sessionId !== 'string' || !['prepared', 'account-written', 'committed'].includes(marker.phase)) {
                throw new Error('invalid marker');
            }
        } catch {
            await this.storage.delete(TRANSACTION_RECORD_TYPE, 'local');
            throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'Modern crypto recovery metadata is invalid.');
        }
        if (marker.phase !== 'committed' && this.sessionStore) {
            await this.sessionStore.delete(marker.conversationId);
        }
        await this.storage.delete(TRANSACTION_RECORD_TYPE, 'local');
    }

    private quarantineSession(): void {
        this.session?.destroy();
        this.session = undefined;
        this.state = 'error';
    }

    private requireState(...allowed: VodozemacLifecycleState[]): void {
        if (!allowed.includes(this.state)) {
            throw new VodozemacBoundaryError('INVALID_LIFECYCLE', 'Modern crypto is not ready for this operation.');
        }
    }
}
