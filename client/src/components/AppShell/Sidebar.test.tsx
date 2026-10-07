import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';

const mockUseChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./AppShell.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));

describe('sidebar presentation', () => {
  beforeEach(() => {
    mockUseChat.mockReturnValue({
      channelHash: '', messages: [], conversations: [], syncStatus: 'ready', sessionHealth: 'healthy',
      profileDisplayName: 'Me', protocolMode: 'modern', unavailableConversations: ['CONTACT_REGISTRY_MISSING'],
    });
  });

  it('keeps recovery compact and places diagnostics under advanced details', () => {
    const markup = renderToStaticMarkup(createElement(Sidebar, {
      isWelcomeActive: false, activeSection: 'chats', onNavigate: jest.fn(), onNewConversation: jest.fn(),
      onOpenConversation: jest.fn(), onOpenSettings: jest.fn(),
    }));
    expect(markup).toContain('1 unavailable conversation');
    expect(markup).toContain('Review');
    expect(markup).toContain('These conversations can’t be opened right now. Their saved encrypted data has not been deleted.');
    expect(markup).toContain('<summary>Advanced details</summary>');
    expect(markup).toContain('Diagnostic code: <code>CONTACT_REGISTRY_MISSING</code>');
    expect(markup).not.toContain('Pending invitations appear in Chats');
    expect(markup).not.toContain('conversation-placeholder');
  });
});
