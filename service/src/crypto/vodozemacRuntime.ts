import type { SecureStorage } from '../core/contracts';
import { VodozemacCryptoSession, type VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { PersistentVodozemacIdentity, type VodozemacAccountFactory } from '../identity/vodozemacIdentity';
import { VodozemacSessionStore, type VodozemacSessionFactory } from '../identity/vodozemacSessionStore';
import type { MessagingIdentity } from '../core/contracts';
import { VodozemacBoundaryError } from './vodozemacErrors';

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

    constructor(
        private readonly storage: SecureStorage,
        private readonly loadBindings: VodozemacBindingsLoader,
    ) {}

    public get lifecycle(): VodozemacLifecycleState { return this.state; }

    public async initialize(): Promise<void> {
        this.requireState('uninitialized');
        try {
            const bindings = await this.loadBindings();
            if (bindings.protocolVersion !== 1) {
                throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Unsupported modern crypto protocol.');
            }
            this.bindings = bindings;
            this.sessionStore = new VodozemacSessionStore(this.storage, bindings.sessionFactory);
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
        this.requireState('active');
        if (!this.session) throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        try { return await this.session.encrypt(channel, plaintext); }
        catch { throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be encrypted.'); }
    }

    public async decrypt(channel: 'message' | 'signaling', envelope: Parameters<VodozemacCryptoSession['decrypt']>[1]) {
        this.requireState('active');
        if (!this.session) throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        try { return await this.session.decrypt(channel, envelope); }
        catch { throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be decrypted.'); }
    }

    public async persistSession(): Promise<void> {
        this.requireState('active');
        if (!this.session || !this.conversationId || !this.sessionStore) {
            throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        }
        try {
            await this.sessionStore.save(this.conversationId, this.session);
            this.state = 'persisted';
        } catch {
            throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The conversation session could not be persisted.');
        }
    }

    public close(): void {
        this.session?.destroy();
        this.identity?.lock();
        this.session = undefined;
        this.identity = undefined;
        this.bindings = undefined;
        this.state = 'closed';
    }

    private requireState(...allowed: VodozemacLifecycleState[]): void {
        if (!allowed.includes(this.state)) {
            throw new VodozemacBoundaryError('INVALID_LIFECYCLE', 'Modern crypto is not ready for this operation.');
        }
    }
}
