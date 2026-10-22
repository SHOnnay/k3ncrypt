import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';
import { conversationDiagnostic } from '../../product/conversationEligibility';
const mockUseChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./AppShell.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));
const descriptor = { version: 1 as const, roomId: '11111111-1111-4111-8111-111111111111', controlCapability: 'a'.repeat(43),
  remoteAddress: 'synthetic-peer', remoteIdentityCommitment: 'K3 ' + 'A'.repeat(43), label: 'Saved friend', updatedAt: 1,
  relationship: 'accepted' as const, bootstrapState: 'ESTABLISHED' as const };
function render(code: 'CONVERSATION_PREKEY_UNAVAILABLE' | 'CONTACT_REGISTRY_MISSING' | 'NETWORK_FAILURE') {
  mockUseChat.mockReturnValue({ conversations: [descriptor], unavailableConversations: [conversationDiagnostic(descriptor, code)],
    messages: [], accountState: 'ready', profileDisplayName: 'Synthetic owner', syncStatus: 'blocked' });
  return renderToStaticMarkup(React.createElement(Sidebar, { isWelcomeActive: true, activeSection: 'chats', onNavigate: () => undefined,
    onNewConversation: () => undefined, onOpenConversation: () => undefined, onOpenSettings: () => undefined }));
}
it('keeps the real saved-contact row visible with truthful paused copy and no duplicate unavailable entry', () => {
  const html = render('CONVERSATION_PREKEY_UNAVAILABLE');
  expect(html).toContain('conversation-row'); expect(html).toContain('Saved friend');
  expect(html).toContain('Contact saved · reconnection paused');
  expect(html).not.toContain('No trusted contacts yet');
  expect(html).not.toContain('unavailable-conversation-action');
  expect(html).not.toContain('Conversation open');
});
it('retains a saved row during temporary network failure without reporting connection success', () => {
  const html = render('NETWORK_FAILURE');
  expect(html).toContain('Disconnected — retry opening'); expect(html).not.toContain('No trusted contacts yet');
});
it('does not hide a genuine missing registry diagnosis or present it as a usable chat', () => {
  const html = render('CONTACT_REGISTRY_MISSING');
  expect(html).toContain('unavailable-conversation-action');
  expect(html).toContain('CONTACT_REGISTRY_MISSING');
  expect(html).not.toContain('Contact saved · reconnection paused');
});
