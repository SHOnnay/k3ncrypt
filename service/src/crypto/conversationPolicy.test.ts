import { conversationCreationPolicy, modeForNewConversation, resolveConversationMode } from './conversationPolicy';

describe('conversation creation policy', () => {
  const previous = process.env.K3NCRYPT_CONVERSATION_POLICY;
  afterEach(() => {
    if (previous === undefined) delete process.env.K3NCRYPT_CONVERSATION_POLICY;
    else process.env.K3NCRYPT_CONVERSATION_POLICY = previous;
  });

  it('keeps legacy creation as the safe default and accepts explicit policy values', () => {
    delete process.env.K3NCRYPT_CONVERSATION_POLICY;
    expect(conversationCreationPolicy()).toBe('legacy-default');
    process.env.K3NCRYPT_CONVERSATION_POLICY = 'modern-explicit';
    expect(conversationCreationPolicy()).toBe('modern-explicit');
    process.env.K3NCRYPT_CONVERSATION_POLICY = 'modern-default-beta';
    expect(conversationCreationPolicy()).toBe('modern-default-beta');
  });

  it('only applies modern-default-beta to new conversations', () => {
    expect(modeForNewConversation('modern-default-beta')).toBe('modern');
    expect(modeForNewConversation('modern-explicit')).toBe('legacy');
    expect(modeForNewConversation('legacy-default')).toBe('legacy');
  });

  it('never migrates a persisted conversation when policy changes', () => {
    expect(resolveConversationMode('modern-default-beta', 'legacy')).toBe('legacy');
    expect(resolveConversationMode('legacy-default', 'modern')).toBe('modern');
    expect(resolveConversationMode('modern-default-beta')).toBe('modern');
    expect(conversationCreationPolicyFor('modern-default')).toBe('legacy-default');
  });
});

const conversationCreationPolicyFor = (value: string) => {
  const previous = process.env.K3NCRYPT_CONVERSATION_POLICY;
  process.env.K3NCRYPT_CONVERSATION_POLICY = value;
  const result = conversationCreationPolicy();
  if (previous === undefined) delete process.env.K3NCRYPT_CONVERSATION_POLICY;
  else process.env.K3NCRYPT_CONVERSATION_POLICY = previous;
  return result;
};
