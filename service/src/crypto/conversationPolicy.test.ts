import { conversationCreationPolicy } from './conversationPolicy';

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
    process.env.K3NCRYPT_CONVERSATION_POLICY = 'modern-default';
    expect(conversationCreationPolicy()).toBe('modern-default');
  });
});
