import type { SecureStorage } from '../core/contracts';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';

const SESSION_RECORD_TYPE = 'vodozemac-session';

export interface VodozemacSessionFactory {
    loadSession(serialized: Uint8Array): VodozemacSessionHandle;
}

/** Encrypts every transient modern SessionPickle before persistence. */
export class VodozemacSessionStore {
    constructor(private readonly storage: SecureStorage, private readonly factory: VodozemacSessionFactory) {}

    public async save(conversationId: string, session: VodozemacSessionHandle): Promise<void> {
        const serialized = session.saveSession();
        try {
            const bytes = serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength) as ArrayBuffer;
            await this.storage.write(SESSION_RECORD_TYPE, conversationId, bytes);
        } finally {
            serialized.fill(0);
        }
    }

    public async load(conversationId: string): Promise<VodozemacSessionHandle> {
        const serialized = await this.storage.read(SESSION_RECORD_TYPE, conversationId);
        if (!serialized) {
            throw new Error('Vodozemac session state is missing.');
        }
        const bytes = new Uint8Array(serialized);
        try {
            return this.factory.loadSession(bytes);
        } finally {
            bytes.fill(0);
        }
    }

    public async delete(conversationId: string): Promise<void> {
        await this.storage.delete(SESSION_RECORD_TYPE, conversationId);
    }
}
