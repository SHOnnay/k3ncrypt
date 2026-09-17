import type { CryptoChannel, CryptoSession, EncryptedEnvelope } from './contracts';

export const VODOZEMAC_STRATEGY_ID = 'vodozemac-olm-v1';
export const VODOZEMAC_ENVELOPE_VERSION = 2;
const INNER_VERSION = 1;
const MAX_WIRE_MESSAGE_LENGTH = 192 * 1024;

/** Narrow shape implemented by the generated K3ncrypt Rust/WASM session handle. */
export interface VodozemacSessionHandle {
    encrypt(plaintext: Uint8Array): string;
    decrypt(wireMessage: string): Uint8Array;
    sessionId(): string;
    saveSession(): Uint8Array;
    free?(): void;
}

type VodozemacEnvelopeData = {
    version: 1;
    olmMessage: string;
};

const channelByte = (channel: CryptoChannel): number => channel === 'message' ? 1 : 2;

const framePlaintext = (channel: CryptoChannel, plaintext: ArrayBuffer): Uint8Array => {
    if (plaintext.byteLength > 64 * 1024) {
        throw new Error('Vodozemac plaintext is too large.');
    }
    const framed = new Uint8Array(plaintext.byteLength + 2);
    framed[0] = INNER_VERSION;
    framed[1] = channelByte(channel);
    framed.set(new Uint8Array(plaintext), 2);
    return framed;
};

const parseEnvelopeData = (value: unknown): VodozemacEnvelopeData => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Malformed vodozemac envelope data.');
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== 'olmMessage' || keys[1] !== 'version') {
        throw new Error('Malformed vodozemac envelope data.');
    }
    const data = value as VodozemacEnvelopeData;
    if (data.version !== INNER_VERSION || typeof data.olmMessage !== 'string' ||
        data.olmMessage.length < 1 || data.olmMessage.length > MAX_WIRE_MESSAGE_LENGTH) {
        throw new Error('Unsupported or malformed vodozemac envelope data.');
    }
    return data;
};

/**
 * Isolated second CryptoSession implementation. It is intentionally not
 * registered as the production default; callers must provide an established
 * Rust/WASM Olm session handle explicitly.
 */
export class VodozemacCryptoSession implements CryptoSession {
    public readonly encrypted = true;
    private initialized = false;
    private destroyed = false;

    constructor(private readonly session: VodozemacSessionHandle) {}

    public get ready(): boolean {
        return this.initialized && !this.destroyed;
    }

    /** Initialization binds this adapter to the expected, non-secret Olm session id. */
    public async initialize(expectedSessionId: string): Promise<void> {
        if (this.destroyed) {
            throw new Error('Vodozemac session has been destroyed.');
        }
        if (!expectedSessionId || this.session.sessionId() !== expectedSessionId) {
            throw new Error('Vodozemac session identity mismatch.');
        }
        this.initialized = true;
    }

    public async encrypt(channel: CryptoChannel, plaintext: ArrayBuffer): Promise<EncryptedEnvelope> {
        this.assertReady();
        return {
            version: VODOZEMAC_ENVELOPE_VERSION,
            strategy: VODOZEMAC_STRATEGY_ID,
            data: { version: INNER_VERSION, olmMessage: this.session.encrypt(framePlaintext(channel, plaintext)) },
        };
    }

    public async decrypt(channel: CryptoChannel, envelope: EncryptedEnvelope): Promise<ArrayBuffer> {
        this.assertReady();
        if (envelope.version !== VODOZEMAC_ENVELOPE_VERSION || envelope.strategy !== VODOZEMAC_STRATEGY_ID) {
            throw new Error('Unsupported vodozemac protocol version or strategy.');
        }
        const data = parseEnvelopeData(envelope.data);
        const plaintext = this.session.decrypt(data.olmMessage);
        if (plaintext.byteLength < 2 || plaintext[0] !== INNER_VERSION || plaintext[1] !== channelByte(channel)) {
            plaintext.fill(0);
            throw new Error('Vodozemac plaintext channel binding failed.');
        }
        const payload = plaintext.slice(2);
        plaintext.fill(0);
        return payload.buffer as ArrayBuffer;
    }

    public destroy(): void {
        if (!this.destroyed) {
            this.session.free?.();
        }
        this.destroyed = true;
        this.initialized = false;
    }

    private assertReady(): void {
        if (!this.ready) {
            throw new Error('Vodozemac session is not initialized.');
        }
    }
}
