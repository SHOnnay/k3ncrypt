import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatContainer } from './ChatContainer';

const mockUseChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./ChatContainer.css', () => ({}));
jest.mock('./ChatHeader', () => ({ ChatHeader: () => null }));
jest.mock('./MessagesArea', () => ({ MessagesArea: () => null }));
jest.mock('./ChatFooter', () => ({ ChatFooter: () => null }));
jest.mock('../common/Button.css', () => ({}));

describe('empty Chats presentation', () => {
  it('shows a single invitation step when the account has no conversations', () => {
    mockUseChat.mockReturnValue({
      startCall: jest.fn(), startVideoCall: jest.fn(), callLifecycleState: 'idle', callError: undefined,
      conversations: [], channelHash: '', protocolMode: 'modern',
    });
    const markup = renderToStaticMarkup(createElement(ChatContainer, {
      isHidden: false, onNewConversation: jest.fn(), onVerifyContact: jest.fn(),
    }));
    expect(markup).toContain('<h1>No conversations yet</h1>');
    expect(markup).toContain('Invite someone you trust to start a private conversation.');
    expect(markup).toContain('> Invite someone</button>');
    expect(markup).not.toContain('Create or join an invitation');
  });
});
