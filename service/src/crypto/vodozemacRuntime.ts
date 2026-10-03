import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { CryptoSession, EncryptedEnvelope, SecureRecordUpdate, SecureStorage } from '../core/contracts';
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
const equalBytes = (left: ArrayBuffer | undefined, right: ArrayBuffer | undefined): boolean => {
    if (left === undefined || right === undefined) return left === right;
    if (left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left);
    const b = new Uint8Array(right);
    return a.every((byte, index) => byte === b[index]);
};

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

export type InboundAcceptanceUpdateBuilder = (plaintext: ArrayBuffer) => Promise<readonly SecureRecordUpdate[]> | readonly SecureRecordUpdate[];

/**
 * Explicit owner for the modern protocol. It deliberately accepts only opaque
 * factories and handles; UI code cannot access account keys or pickles.
 */
export class VodozemacRuntime {
    private lastInboundFailureStage?: 'wasm-authentication' | 'session-state' | 'persistence';
    private lastInboundEntry?: { lifecycle: VodozemacLifecycleState; identityPresent: boolean; bindingsPresent: boolean; senderPresent: boolean; messagePresent: boolean };
    private lastInboundStage?: 'input-ready' | 'wasm-called' | 'wasm-returned' | 'session-created' | 'session-serialized' | 'returned';
    private state: VodozemacLifecycleState = 'uninitialized';
    private bindings?: VodozemacBindings;
    private identity?: PersistentVodozemacIdentity;
    private session?: VodozemacCryptoSession;
    private conversationId?: string;
    private sessionStore?: VodozemacSessionStore;
    /** Exact plaintext pickle that was last durably written for this runtime's session. */
    private persistedSessionSnapshot?: ArrayBuffer;
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

    /** Signs canonical device-lifecycle control data without exposing identity keys. */
    public async signControlEvent(payload: Uint8Array): Promise<string> {
        this.requireState('identity-restored', 'active', 'persisted');
        if (!this.identity) throw new VodozemacBoundaryError('CORRUPTED_ACCOUNT', 'The private identity is unavailable.');
        try { return await this.identity.signControlEvent(payload); }
        catch { throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Identity control signing is unavailable.'); }
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
            this.clearPersistedSessionSnapshot();
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
        this.lastInboundEntry = { lifecycle: this.state, identityPresent: !!this.identity, bindingsPresent: !!this.bindings, senderPresent: !!senderIdentityKey, messagePresent: !!preKeyMessage };
        try { this.requireState('identity-restored', 'persisted'); }
        catch (error) { this.lastInboundFailureStage = 'session-state'; throw error; }
        if (!this.identity || !senderIdentityKey || !preKeyMessage) {
            throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The sender identity is invalid.');
        }
        let result: import('../identity/vodozemacIdentity').VodozemacInboundSessionResult;
        try {
            this.lastInboundStage = 'input-ready';
            result = await this.identity.withAccount(async (account) => {
                if (!account.createInboundSession) throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Inbound modern sessions are unavailable.');
                this.lastInboundStage = 'wasm-called';
                const inbound = account.createInboundSession(senderIdentityKey, preKeyMessage);
                this.lastInboundStage = 'wasm-returned';
                return inbound;
            });
        } catch (error) {
            this.lastInboundFailureStage = 'wasm-authentication';
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The inbound session message could not be accepted.');
        }
        let handle: VodozemacSessionHandle;
        try {
            handle = result.takeSession();
            await this.establishSession(conversationId, handle, handle.sessionId());
            this.lastInboundStage = 'session-created';
        } catch (error) {
            this.lastInboundFailureStage = 'session-state';
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The inbound session state could not be established.');
        }
        try {
            await this.commitAccountAndSession();
            this.lastInboundStage = 'session-serialized';
            const plaintext = result.plaintext();
            try { this.lastInboundStage = 'returned'; return plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer; }
            finally { plaintext.fill(0); }
        } catch (error) {
            this.lastInboundFailureStage = 'persistence';
            if (error instanceof VodozemacBoundaryError) throw error;
            throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The inbound session could not be persisted.');
        }
    }

    /** Atomically advances an established session with caller-owned durable acceptance records. */
    public async decryptAndCommitInbound(
        channel: 'message' | 'signaling',
        envelope: Parameters<VodozemacCryptoSession['decrypt']>[1],
        buildUpdates: InboundAcceptanceUpdateBuilder,
    ): Promise<void> {
        return this.sessionMutex.runExclusive(async () => {
            this.requireState('active', 'persisted');
            if (!this.session || !this.conversationId || !this.persistedSessionSnapshot || !this.storage.compareAndSwapRecords) {
                throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The inbound message could not be safely accepted.');
            }
            const conversationId = this.conversationId;
            const sessionId = this.session.sessionId();
            const expectedSession = this.persistedSessionSnapshot.slice(0);
            let plaintext: ArrayBuffer | undefined;
            let nextSession: ArrayBuffer | undefined;
            let acceptanceUpdates: readonly SecureRecordUpdate[] = [];
            let updates: readonly SecureRecordUpdate[] = [];
            let acceptanceBuildFailed = false;
            let acceptanceBuildError: unknown;
            try {
                const durableSession = await this.storage.read('vodozemac-session', conversationId);
                if (!equalBytes(durableSession, expectedSession)) throw new Error('Persisted inbound session changed.');
                if (durableSession) new Uint8Array(durableSession).fill(0);
                try { plaintext = await this.session.decrypt(channel, envelope); }
                catch { throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be decrypted.'); }
                let additional: readonly SecureRecordUpdate[];
                try { additional = await buildUpdates(plaintext); acceptanceUpdates = additional; }
                catch (error) { acceptanceBuildFailed = true; acceptanceBuildError = error; throw error; }
                nextSession = this.serializeCurrentSession();
                updates = [
                    { recordType: 'vodozemac-session', recordId: conversationId, expected: expectedSession, next: nextSession },
                    ...additional,
                ];
                const addresses = updates.map((item) => `${item.recordType}:${item.recordId}`);
                if (new Set(addresses).size !== addresses.length) throw new Error('Inbound acceptance contains duplicate records.');
                new Uint8Array(plaintext).fill(0);
                plaintext = undefined;
                if (!await this.storage.compareAndSwapRecords(updates)) throw new Error('Inbound acceptance transaction conflicted.');
                this.replacePersistedSessionSnapshot(nextSession.slice(0));
                this.state = 'active';
            } catch (error) {
                if (plaintext) new Uint8Array(plaintext).fill(0);
                // Resolve an uncertain IndexedDB completion from the exact transaction records.
                // A committed transaction is accepted; an unchanged session can safely be restored
                // so relay redelivery retries the same ciphertext without advancing the ratchet.
                let durableValues: (ArrayBuffer | undefined)[] = [];
                try {
                    durableValues = await Promise.all(updates.map((item) => this.storage.read(item.recordType, item.recordId)));
                    if (updates.length > 0 && updates.every((item, index) => equalBytes(durableValues[index], item.next))) {
                        if (nextSession) this.replacePersistedSessionSnapshot(nextSession.slice(0));
                        this.state = 'active';
                        return;
                    }
                    const durableSession = updates.length > 0 ? durableValues[0] : await this.storage.read('vodozemac-session', conversationId);
                    if (equalBytes(durableSession, expectedSession)) await this.restoreSessionSnapshot(expectedSession, sessionId);
                    else this.quarantineSession();
                } catch { this.quarantineSession(); }
                finally { durableValues.forEach((value) => { if (value) new Uint8Array(value).fill(0); }); }
                if (acceptanceBuildFailed) throw acceptanceBuildError;
                throw error instanceof VodozemacBoundaryError ? error : new VodozemacBoundaryError('CORRUPTED_SESSION', 'The inbound message could not be safely accepted.');
            } finally {
                new Uint8Array(expectedSession).fill(0);
                if (nextSession) new Uint8Array(nextSession).fill(0);
                for (const update of updates.length > 0 ? updates : acceptanceUpdates) {
                    if (update.recordType === 'vodozemac-session') continue;
                    if (update.expected) new Uint8Array(update.expected).fill(0);
                    new Uint8Array(update.next).fill(0);
                }
            }
        });
    }

    /** Creates the first inbound session and commits account, session and acceptance in one secure CAS. */
    public async establishInboundSessionAndCommit(
        conversationId: string,
        senderIdentityKey: string,
        preKeyMessage: string,
        buildUpdates: InboundAcceptanceUpdateBuilder,
    ): Promise<void> {
        return this.sessionMutex.runExclusive(async () => {
            this.requireState('identity-restored', 'persisted');
            if (!this.identity || !senderIdentityKey || !preKeyMessage || !this.storage.compareAndSwapRecords) {
                throw new VodozemacBoundaryError('IDENTITY_MISMATCH', 'The inbound session could not be safely accepted.');
            }
            const identity = this.identity;
            let inbound: import('../identity/vodozemacIdentity').VodozemacInboundSessionResult | undefined;
            let plaintext: ArrayBuffer | undefined;
            let accountBytes: ArrayBuffer | undefined;
            let sessionBytes: Uint8Array | undefined;
            let sessionNext: ArrayBuffer | undefined;
            let expectedAccount: ArrayBuffer | undefined;
            let expectedSession: ArrayBuffer | undefined;
            let acceptanceUpdates: readonly SecureRecordUpdate[] = [];
            let updates: SecureRecordUpdate[] = [];
            let acceptanceBuildFailed = false;
            let acceptanceBuildError: unknown;
            try {
                expectedAccount = await this.storage.read('vodozemac-account', 'local');
                expectedSession = await this.storage.read('vodozemac-session', conversationId);
                inbound = await identity.withAccount(async (account) => {
                    if (!account.createInboundSession) throw new VodozemacBoundaryError('UNSUPPORTED_PROTOCOL', 'Inbound modern sessions are unavailable.');
                    return account.createInboundSession(senderIdentityKey, preKeyMessage);
                });
                const handle = inbound.takeSession();
                await this.establishSession(conversationId, handle, handle.sessionId());
                const source = inbound.plaintext();
                plaintext = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
                source.fill(0);
                let additional: readonly SecureRecordUpdate[];
                try { additional = await buildUpdates(plaintext); acceptanceUpdates = additional; }
                catch (error) { acceptanceBuildFailed = true; acceptanceBuildError = error; throw error; }
                new Uint8Array(plaintext).fill(0);
                plaintext = undefined;
                accountBytes = await identity.serializeAccountForCommit();
                sessionBytes = this.session!.saveSession();
                sessionNext = sessionBytes.buffer.slice(sessionBytes.byteOffset, sessionBytes.byteOffset + sessionBytes.byteLength) as ArrayBuffer;
                updates = [
                    { recordType: 'vodozemac-account', recordId: 'local', expected: expectedAccount, next: accountBytes },
                    { recordType: 'vodozemac-session', recordId: conversationId, expected: expectedSession, next: sessionNext },
                    ...additional,
                ];
                const addresses = updates.map((item) => `${item.recordType}:${item.recordId}`);
                if (new Set(addresses).size !== addresses.length) throw new Error('Inbound acceptance contains duplicate records.');
                if (!await this.storage.compareAndSwapRecords(updates)) throw new Error('Inbound acceptance transaction conflicted.');
                this.replacePersistedSessionSnapshot(sessionNext.slice(0));
                this.state = 'active';
            } catch (error) {
                if (plaintext) new Uint8Array(plaintext).fill(0);
                this.quarantineSession();
                identity.lock();
                this.identity = undefined;
                this.state = 'error';
                if (acceptanceBuildFailed) throw acceptanceBuildError;
                throw error instanceof VodozemacBoundaryError ? error : new VodozemacBoundaryError('CORRUPTED_SESSION', 'The inbound message could not be safely accepted.');
            } finally {
                sessionBytes?.fill(0);
                if (accountBytes) new Uint8Array(accountBytes).fill(0);
                if (sessionNext) new Uint8Array(sessionNext).fill(0);
                if (expectedAccount) new Uint8Array(expectedAccount).fill(0);
                if (expectedSession) new Uint8Array(expectedSession).fill(0);
                for (const update of updates.length > 0 ? updates : acceptanceUpdates) {
                    if (update.recordType === 'vodozemac-account' || update.recordType === 'vodozemac-session') continue;
                    if (update.expected) new Uint8Array(update.expected).fill(0);
                    new Uint8Array(update.next).fill(0);
                }
                if (inbound) { try { inbound.plaintext().fill(0); } catch { /* already cleared */ } }
            }
        });
    }

    public testOnlyInboundFailureStage(): string | undefined {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        return this.lastInboundFailureStage;
    }

    public testOnlyInboundEntry(): typeof this.lastInboundEntry {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        return this.lastInboundEntry;
    }
    public testOnlyInboundStage(): typeof this.lastInboundStage {
        if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
        return this.lastInboundStage;
    }

    public async restoreSession(conversationId: string, expectedSessionId: string): Promise<void> {
        this.requireState('identity-restored', 'persisted');
        if (!this.sessionStore) throw new VodozemacBoundaryError('WASM_INIT_FAILED', 'Modern crypto is unavailable.');
        let stage: 'session-load' | 'session-bind' = 'session-load';
        let loadedSnapshot: ArrayBuffer | undefined;
        try {
            const { handle, snapshot } = await this.sessionStore.loadWithSnapshot(conversationId);
            loadedSnapshot = snapshot;
            stage = 'session-bind';
            await this.establishSession(conversationId, handle, expectedSessionId);
            this.persistedSessionSnapshot = snapshot;
            loadedSnapshot = undefined;
        } catch (error) {
            if (loadedSnapshot) new Uint8Array(loadedSnapshot).fill(0);
            if (error instanceof VodozemacBoundaryError) throw error;
            const missingRecord = stage === 'session-load' && error instanceof Error && error.message === 'Vodozemac session state is missing.';
            this.state = missingRecord ? 'identity-restored' : 'error';
            const failure = new VodozemacBoundaryError('CORRUPTED_SESSION', 'The conversation session could not be restored.');
            Object.assign(failure, { restoreFailureCategory: stage === 'session-load'
                ? missingRecord ? 'session-record-missing' : 'session-load-failed'
                : 'session-bind-failed' });
            throw failure;
        }
    }

    /** Persists a session mutation alone; ModernConversation user messages must use the atomic outbox operation below. */
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

    /**
     * Encrypts a user-message envelope and atomically persists the advanced
     * session pickle with its caller-owned recovery records (normally outbox).
     * This operation deliberately does not alter signaling or receive paths.
     */
    public async encryptMessageWithAtomicRecords(
        plaintext: ArrayBuffer,
        buildAdditionalUpdates: (envelope: EncryptedEnvelope) => readonly SecureRecordUpdate[] | Promise<readonly SecureRecordUpdate[]>,
        assertCanCommit?: () => void,
    ): Promise<EncryptedEnvelope> {
        return this.sessionMutex.runExclusive(async () => {
            this.requireState('active', 'persisted');
            if (!this.session || !this.conversationId || !this.persistedSessionSnapshot || !this.storage.compareAndSwapRecords) {
                throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The message could not be safely persisted.');
            }

            const conversationId = this.conversationId;
            const sessionId = this.session.sessionId();
            const expectedSession = this.persistedSessionSnapshot.slice(0);
            let envelope: EncryptedEnvelope;
            try {
                envelope = await this.session.encrypt('message', plaintext);
            } catch {
                this.quarantineSession();
                new Uint8Array(expectedSession).fill(0);
                throw new VodozemacBoundaryError('INVALID_CIPHERTEXT', 'The message could not be encrypted.');
            }

            let nextSession: ArrayBuffer | undefined;
            let updates: readonly SecureRecordUpdate[] = [];
            let recoveryHandled = false;
            try {
                nextSession = this.serializeCurrentSession();
                const additional = await buildAdditionalUpdates(envelope);
                updates = [
                    { recordType: 'vodozemac-session', recordId: conversationId, expected: expectedSession, next: nextSession },
                    ...additional,
                ];
                const addresses = updates.map((item) => `${item.recordType}:${item.recordId}`);
                if (new Set(addresses).size !== addresses.length) throw new Error('Atomic message update contains duplicate records.');

                assertCanCommit?.();
                const committed = await this.storage.compareAndSwapRecords(updates);
                if (committed) {
                    this.replacePersistedSessionSnapshot(nextSession.slice(0));
                    this.state = 'active';
                    return envelope;
                }

                // A transaction may have committed immediately before the page
                // was interrupted. Read back all written values to distinguish
                // that case from a pre-commit conflict.
                const durableValues = await Promise.all(updates.map((item) => this.storage.read(item.recordType, item.recordId)));
                const committedDespiteError = updates.every((item, index) => equalBytes(durableValues[index], item.next));
                const sessionUnchanged = equalBytes(durableValues[0], expectedSession);
                durableValues.forEach((value) => { if (value) new Uint8Array(value).fill(0); });
                if (committedDespiteError) {
                    this.replacePersistedSessionSnapshot(nextSession.slice(0));
                    this.state = 'active';
                    return envelope;
                }
                if (sessionUnchanged) {
                    await this.restoreSessionSnapshot(expectedSession, sessionId);
                } else {
                    this.quarantineSession();
                }
                recoveryHandled = true;
                throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The message could not be safely persisted.');
            } catch (error) {
                if (!recoveryHandled) {
                    // Storage can reject after a transaction commit while the
                    // browser is closing. Resolve that ambiguity from durable
                    // state; never roll back a session that another tab advanced.
                    try {
                        const durableSession = await this.storage.read('vodozemac-session', conversationId);
                        const sessionWasAdvanced = !!nextSession && equalBytes(durableSession, nextSession);
                        if (sessionWasAdvanced) {
                            if (durableSession) new Uint8Array(durableSession).fill(0);
                            const durableAdditional = await Promise.all(updates.slice(1).map((item) => this.storage.read(item.recordType, item.recordId)));
                            const additionalCommitted = updates.slice(1).every((item, index) => equalBytes(durableAdditional[index], item.next));
                            durableAdditional.forEach((value) => { if (value) new Uint8Array(value).fill(0); });
                            if (additionalCommitted) {
                                this.replacePersistedSessionSnapshot(nextSession!.slice(0));
                                this.state = 'active';
                                return envelope;
                            }
                        } else if (equalBytes(durableSession, expectedSession)) await this.restoreSessionSnapshot(expectedSession, sessionId);
                        else this.quarantineSession();
                        if (durableSession) new Uint8Array(durableSession).fill(0);
                    } catch {
                        this.quarantineSession();
                    }
                    throw new VodozemacBoundaryError('CORRUPTED_SESSION', 'The message could not be safely persisted.');
                }
                throw error;
            } finally {
                new Uint8Array(expectedSession).fill(0);
                if (nextSession) new Uint8Array(nextSession).fill(0);
                for (const update of updates) {
                    if (update.recordType !== 'vodozemac-session') {
                        if (update.expected) new Uint8Array(update.expected).fill(0);
                        new Uint8Array(update.next).fill(0);
                    }
                }
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
        this.clearPersistedSessionSnapshot();
        this.identity = undefined;
        this.bindings = undefined;
        this.state = 'closed';
    }

    private async persistSessionUnsafe(keepPersisted = false): Promise<void> {
        this.requireState('active', 'persisted');
        if (!this.session || !this.conversationId || !this.sessionStore) {
            throw new VodozemacBoundaryError('MISSING_SESSION', 'No active conversation session.');
        }
        this.replacePersistedSessionSnapshot(await this.sessionStore.save(this.conversationId, this.session));
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
        this.clearPersistedSessionSnapshot();
        this.state = 'error';
    }

    private serializeCurrentSession(): ArrayBuffer {
        if (!this.session) throw new Error('Session unavailable.');
        const serialized = this.session.saveSession();
        try { return serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength) as ArrayBuffer; }
        finally { serialized.fill(0); }
    }

    private async restoreSessionSnapshot(snapshot: ArrayBuffer, sessionId: string): Promise<void> {
        const factory = this.bindings?.sessionFactory;
        if (!factory) { this.quarantineSession(); throw new Error('Session recovery unavailable.'); }
        const bytes = new Uint8Array(snapshot.slice(0));
        let recovered: VodozemacSessionHandle | undefined;
        try {
            recovered = factory.loadSession(bytes);
            const replacement = new VodozemacCryptoSession(recovered);
            await replacement.initialize(sessionId);
            this.session?.destroy();
            this.session = replacement;
            this.replacePersistedSessionSnapshot(snapshot.slice(0));
            this.state = 'active';
        } catch (error) {
            recovered?.free?.();
            this.quarantineSession();
            throw error;
        } finally { bytes.fill(0); }
    }

    private replacePersistedSessionSnapshot(next: ArrayBuffer): void {
        this.clearPersistedSessionSnapshot();
        this.persistedSessionSnapshot = next;
    }

    private clearPersistedSessionSnapshot(): void {
        if (this.persistedSessionSnapshot) new Uint8Array(this.persistedSessionSnapshot).fill(0);
        this.persistedSessionSnapshot = undefined;
    }

    private requireState(...allowed: VodozemacLifecycleState[]): void {
        if (!allowed.includes(this.state)) {
            throw new VodozemacBoundaryError('INVALID_LIFECYCLE', 'Modern crypto is not ready for this operation.');
        }
    }
}
