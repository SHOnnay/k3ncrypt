import type { SecureStorage } from '../core/contracts';

export type ConversationProtocolMode = 'legacy' | 'modern';
const RECORD_TYPE = 'conversation-protocol';

export interface ModernConversationRecord {
    version: 1;
    mode: 'modern';
    sessionId?: string;
    localAddress?: string;
    remoteAddress?: string;
    routingProof?: string;
}

export class ConversationModeStore {
    constructor(private readonly storage: SecureStorage) {}

    public async read(conversationId: string): Promise<ModernConversationRecord | undefined> {
        const bytes = await this.storage.read(RECORD_TYPE, conversationId);
        if (!bytes) return undefined;
        const value = JSON.parse(new TextDecoder().decode(bytes)) as ModernConversationRecord;
        if (!value || value.version !== 1 || value.mode !== 'modern' ||
            Object.keys(value).some((key) => !['version', 'mode', 'sessionId', 'localAddress', 'remoteAddress', 'routingProof'].includes(key)) ||
            [value.sessionId, value.localAddress, value.remoteAddress].some((part) => part !== undefined && (typeof part !== 'string' || part.length > 128)) ||
            value.routingProof !== undefined && (typeof value.routingProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.routingProof))) {
            throw new Error('Conversation protocol record is invalid.');
        }
        return value;
    }

    public async write(conversationId: string, update: Omit<ModernConversationRecord, 'version' | 'mode'>): Promise<void> {
        const current = await this.read(conversationId);
        const next: ModernConversationRecord = { version: 1, mode: 'modern', ...current, ...update };
        await this.storage.write(RECORD_TYPE, conversationId,
            new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer);
    }
}
