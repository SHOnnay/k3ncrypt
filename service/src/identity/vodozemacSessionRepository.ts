import type { SecureStorage } from '../core/contracts';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';

const RECORD_TYPE = 'vodozemac-session';
const INDEX_RECORD_TYPE = 'vodozemac-session-index';
const MAX_SESSIONS_PER_CONTACT = 8;

const parseIndex = (bytes: ArrayBuffer | undefined): string[] => {
    if (!bytes) return [];
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.length === 0)) {
        throw new Error('Corrupted Vodozemac session index.');
    }
    return [...new Set(value)].slice(-MAX_SESSIONS_PER_CONTACT);
};

export class VodozemacSessionRepository {
    constructor(private readonly storage: SecureStorage, private readonly factory: { loadSession(serialized: Uint8Array): VodozemacSessionHandle }) {}

    public async save(contactId: string, session: VodozemacSessionHandle): Promise<void> {
        const serialized = session.saveSession();
        try {
            const bytes = serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength) as ArrayBuffer;
            const sessionId = session.sessionId();
            await this.storage.write(RECORD_TYPE, `${contactId}:${sessionId}`, bytes);
            const current = parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId));
            const next = [...current.filter((id) => id !== sessionId), sessionId];
            const evicted = next.slice(0, Math.max(0, next.length - MAX_SESSIONS_PER_CONTACT));
            for (const oldId of evicted) await this.storage.delete(RECORD_TYPE, `${contactId}:${oldId}`);
            const indexBytes = new TextEncoder().encode(JSON.stringify(next.slice(-MAX_SESSIONS_PER_CONTACT))).buffer as ArrayBuffer;
            await this.storage.write(INDEX_RECORD_TYPE, contactId, indexBytes);
        } finally {
            serialized.fill(0);
        }
    }

    public async load(contactId: string, sessionId: string): Promise<VodozemacSessionHandle> {
        const value = await this.storage.read(RECORD_TYPE, `${contactId}:${sessionId}`);
        if (!value) throw new Error('Vodozemac session state is missing.');
        const bytes = new Uint8Array(value);
        try { return this.factory.loadSession(bytes); }
        finally { bytes.fill(0); }
    }

    public async listSessionIds(contactId: string): Promise<string[]> {
        return parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId));
    }

    public static maxSessionsPerContact(): number { return MAX_SESSIONS_PER_CONTACT; }
}
