export type ConversationCreationPolicy = 'legacy-default' | 'modern-explicit' | 'modern-default';

/** Central policy point. Existing conversations always use their persisted mode. */
export const conversationCreationPolicy = (): ConversationCreationPolicy => {
    const configured = (typeof process !== 'undefined' ? process.env.K3NCRYPT_CONVERSATION_POLICY : undefined) as ConversationCreationPolicy | undefined;
    return configured === 'modern-default' || configured === 'modern-explicit' ? configured : 'legacy-default';
};
