import type { SecureStorage } from '../core/contracts';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { AsyncMutex } from '../utils/asyncMutex';

const RECORD_TYPE = 'vodozemac-session';
const INDEX_RECORD_TYPE = 'vodozemac-session-index';
const MAX_SESSIONS_PER_CONTACT = 8;

interface SessionIndex { version: 1; ids: string[]; activeOutbound?: string; }
const parseIndex = (bytes: ArrayBuffer | undefined): SessionIndex => {
    if (!bytes) return { version: 1, ids: [] };
    const value = JSON.parse(new TextDecoder().decode(bytes));
    const index: SessionIndex = Array.isArray(value) ? { version: 1, ids: value } : value;
    if (!index || index.version !== 1 || !Array.isArray(index.ids) ||
        index.ids.some((id) => typeof id !== 'string' || id.length === 0) ||
        (index.activeOutbound !== undefined && (typeof index.activeOutbound !== 'string' || !index.ids.includes(index.activeOutbound)))) {
        throw new Error('Corrupted Vodozemac session index.');
    }
    return { version: 1, ids: [...new Set(index.ids)].slice(-MAX_SESSIONS_PER_CONTACT), activeOutbound: index.activeOutbound };
};

export class VodozemacSessionRepository {
    private readonly mutex = new AsyncMutex();
    constructor(private readonly storage: SecureStorage, private readonly factory: { loadSession(serialized: Uint8Array): VodozemacSessionHandle }) {}

    public async save(contactId: string, session: VodozemacSessionHandle, activeOutbound = false): Promise<void> {
      return this.mutex.runExclusive(async () => {
        const serialized = session.saveSession();
        try {
            const bytes = serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength) as ArrayBuffer;
            const sessionId = session.sessionId();
            await this.storage.write(RECORD_TYPE, `${contactId}:${sessionId}`, bytes);
            const current = parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId));
            const next = [...current.ids.filter((id) => id !== sessionId), sessionId];
            const selected = activeOutbound ? sessionId : current.activeOutbound;
            const evicted: string[] = [];
            while (next.length > MAX_SESSIONS_PER_CONTACT) {
                const oldest = next.find((id) => id !== selected);
                if (!oldest) throw new Error('No Vodozemac session can be safely evicted.');
                next.splice(next.indexOf(oldest), 1);
                evicted.push(oldest);
            }
            const indexBytes = new TextEncoder().encode(JSON.stringify({ version: 1, ids: next, activeOutbound: selected })).buffer as ArrayBuffer;
            await this.storage.write(INDEX_RECORD_TYPE, contactId, indexBytes);
            for (const oldId of evicted) await this.storage.delete(RECORD_TYPE, `${contactId}:${oldId}`);
        } finally {
            serialized.fill(0);
        }
      });
    }

    public async load(contactId: string, sessionId: string): Promise<VodozemacSessionHandle> {
        return this.mutex.runExclusive(async () => {
            const index = parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId));
            if (!index.ids.includes(sessionId)) throw new Error('Vodozemac session is not retained.');
            const value = await this.storage.read(RECORD_TYPE, `${contactId}:${sessionId}`);
            if (!value) throw new Error('Vodozemac session state is missing.');
            const bytes = new Uint8Array(value);
            try {
                const loaded = this.factory.loadSession(bytes);
                const ids = [...index.ids.filter((id) => id !== sessionId), sessionId];
                await this.storage.write(INDEX_RECORD_TYPE, contactId,
                    new TextEncoder().encode(JSON.stringify({ ...index, ids })).buffer as ArrayBuffer);
                return loaded;
            } finally { bytes.fill(0); }
        });
    }

    public async listSessionIds(contactId: string): Promise<string[]> {
        return parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId)).ids;
    }

    public async activeOutboundSessionId(contactId: string): Promise<string | undefined> {
        return parseIndex(await this.storage.read(INDEX_RECORD_TYPE, contactId)).activeOutbound;
    }

    public static maxSessionsPerContact(): number { return MAX_SESSIONS_PER_CONTACT; }
}
