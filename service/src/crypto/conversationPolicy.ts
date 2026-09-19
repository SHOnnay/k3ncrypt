export type ConversationCreationPolicy = 'legacy-default' | 'modern-explicit' | 'modern-default';
export type PersistedConversationMode = 'legacy' | 'modern';

/** Central policy point. Existing conversations always use their persisted mode. */
export const conversationCreationPolicy = (): ConversationCreationPolicy => {
    const configured = (typeof process !== 'undefined' ? process.env.K3NCRYPT_CONVERSATION_POLICY : undefined) as ConversationCreationPolicy | undefined;
    return configured === 'modern-default' || configured === 'modern-explicit' ? configured : 'legacy-default';
};

/** Selects a mode only for a conversation that has no persisted mode yet. */
export const modeForNewConversation = (
    policy: ConversationCreationPolicy = conversationCreationPolicy(),
): PersistedConversationMode => policy === 'modern-default' ? 'modern' : 'legacy';

/** Persisted mode is authoritative; policy changes never migrate existing conversations. */
export const resolveConversationMode = (
    policy: ConversationCreationPolicy,
    persistedMode?: PersistedConversationMode,
): PersistedConversationMode => persistedMode ?? modeForNewConversation(policy);
