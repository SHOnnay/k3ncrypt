import { deriveChannelSecrets } from '../crypto/inviteCrypto';
import type { EncryptionStrategy, EncryptionStrategyFactory, EncryptionEnvelope } from '../crypto/strategy';
import type { CryptoChannel, CryptoSession } from './contracts';

/**
 * Compatibility adapter for the existing invite-secret + HKDF + AES-GCM flow.
 *
 * This intentionally preserves the current wire format. It is not a ratchet,
 * has no forward secrecy, and must be replaced rather than extended when the
 * reviewed ratcheted implementation is ready.
 */
export class LegacyInviteCryptoSession implements CryptoSession {
    private readonly messageStrategy: EncryptionStrategy;
    private readonly signalingStrategy: EncryptionStrategy;
    private initialized = false;

    constructor(strategyFactory: EncryptionStrategyFactory) {
        this.messageStrategy = strategyFactory();
        this.signalingStrategy = strategyFactory();
    }

    public get encrypted(): boolean {
        return this.messageStrategy.encrypted && this.signalingStrategy.encrypted;
    }

    public get ready(): boolean {
        return this.initialized;
    }

    public async initialize(secret: string): Promise<void> {
        if (this.initialized) {
            this.destroy();
        }
        const { chatSecret, signalingSecret } = await deriveChannelSecrets(secret);
        await this.messageStrategy.initialize(chatSecret);
        try {
            await this.signalingStrategy.initialize(signalingSecret);
        } catch (error) {
            this.messageStrategy.destroy();
            throw error;
        }
        this.initialized = true;
    }

    public async encrypt(channel: CryptoChannel, plaintext: ArrayBuffer): Promise<EncryptionEnvelope> {
        this.assertReady();
        return await this.strategyFor(channel).encrypt(plaintext);
    }

    public async decrypt(channel: CryptoChannel, envelope: EncryptionEnvelope): Promise<ArrayBuffer> {
        this.assertReady();
        const strategy = this.strategyFor(channel);
        if (!envelope || typeof envelope !== 'object') {
            throw new Error('Invalid envelope: expected an object.');
        }
        if (envelope.strategy !== strategy.id) {
            throw new Error(`Unsupported encryption strategy: expected "${strategy.id}", got "${String(envelope.strategy)}".`);
        }
        return await strategy.decrypt(envelope);
    }

    public destroy(): void {
        try {
            this.messageStrategy.destroy();
        } finally {
            try {
                this.signalingStrategy.destroy();
            } finally {
                this.initialized = false;
            }
        }
    }

    private strategyFor(channel: CryptoChannel): EncryptionStrategy {
        return channel === 'message' ? this.messageStrategy : this.signalingStrategy;
    }

    private assertReady(): void {
        if (!this.initialized) {
            throw new Error('Crypto session is not initialized.');
        }
    }
}
