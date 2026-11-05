import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar, resetRowSettleForTest, shouldSettleRows } from './Sidebar';
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
// UX A5: an entry that can't open is explained in plain words with one action (Remove); codes live in Settings → Advanced.
it('lists a chat that cannot open in plain words with Remove, without codes or technical details', () => {
  const html = render('CONTACT_REGISTRY_MISSING');
  expect(html).toContain('Needs attention');
  expect(html).toContain('unavailable-conversation-action');
  expect(html).toContain('Part of this chat’s saved data is missing, so it can’t open.');
  expect(html).toContain('aria-label="Remove conversation Saved friend"');
  expect(html).not.toContain('CONTACT_REGISTRY_MISSING');
  expect(html).not.toContain('Technical details');
  expect(html).not.toContain('Unavailable Conversations');
  expect(html).not.toContain('Local data status');
  expect(html).not.toContain('Contact saved · reconnection paused');
});
it('does not say Review connection for saved chats just because device sync is blocked', () => {
  mockUseChat.mockReturnValue({ conversations: [descriptor], unavailableConversations: [], messages: [], accountState: 'ready',
    profileDisplayName: 'Synthetic owner', syncStatus: 'blocked', protocolMode: 'modern', sessionHealth: 'healthy', channelHash: 'another-room' });
  const html = renderToStaticMarkup(React.createElement(Sidebar, { isWelcomeActive: true, activeSection: 'chats', onNavigate: () => undefined,
    onNewConversation: () => undefined, onOpenConversation: () => undefined, onOpenSettings: () => undefined }));
  expect(html).toContain('Saved friend');
  expect(html).not.toContain('Review connection');
});
it('explains an open chat whose secure connection needs renewing', () => {
  mockUseChat.mockReturnValue({ conversations: [descriptor], unavailableConversations: [], messages: [], accountState: 'ready',
    profileDisplayName: 'Synthetic owner', syncStatus: 'ready', protocolMode: 'modern', sessionHealth: 'unhealthy', channelHash: descriptor.roomId });
  const html = renderToStaticMarkup(React.createElement(Sidebar, { isWelcomeActive: false, activeSection: 'chats', onNavigate: () => undefined,
    onNewConversation: () => undefined, onOpenConversation: () => undefined, onOpenSettings: () => undefined }));
  expect(html).toContain('Secure connection needs renewing');
  expect(html).not.toContain('Review connection');
});

// Item 4: nothing about contacts while locked; contact data present in state must still not render before ready.
const renderState = (accountState: 'checking' | 'locked' | 'new' | 'ready') => {
  mockUseChat.mockReturnValue({ conversations: [descriptor], unavailableConversations: [conversationDiagnostic(descriptor, 'CONTACT_REGISTRY_MISSING')],
    messages: [], accountState, profileDisplayName: 'Synthetic owner', syncStatus: 'ready' });
  return renderToStaticMarkup(React.createElement(Sidebar, { isWelcomeActive: true, activeSection: 'chats', onNavigate: () => undefined,
    onNewConversation: () => undefined, onOpenConversation: () => undefined, onOpenSettings: () => undefined }));
};
it.each(['locked', 'checking'] as const)('shows a neutral %s state with no contact data and nothing clickable', (state) => {
  const html = renderState(state);
  expect(html).toContain('Unlock to see your chats');
  expect(html).not.toContain('Saved friend');
  expect(html).not.toContain('Synthetic owner');
  expect(html).not.toContain('conversation-row');
  expect(html).not.toContain('Unavailable Conversations');
  expect(html).not.toContain('No chats yet');
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.every((button) => button.includes('disabled'))).toBe(true);
});
it('shows saved contacts once the account is ready', () => {
  const html = renderState('ready');
  expect(html).toContain('Saved friend');
  expect(html).not.toContain('Unlock to see your chats');
});

it('settles chat rows only in the first second after they appear', () => {
  resetRowSettleForTest();
  expect(shouldSettleRows(false, 0)).toBe(false);
  expect(shouldSettleRows(true, 5_000)).toBe(true);
  expect(shouldSettleRows(true, 5_900)).toBe(true);
  expect(shouldSettleRows(true, 6_000)).toBe(false);
  expect(shouldSettleRows(true, 60_000)).toBe(false);
});
it('marks rows for the settle animation with their position', () => {
  resetRowSettleForTest();
  const html = render('NETWORK_FAILURE');
  expect(html).toContain('conversation-row--settle'); expect(html).toContain('--row-index:0');
});
