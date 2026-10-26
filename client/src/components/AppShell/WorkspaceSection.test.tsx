import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatContextType } from '../../types';
import { WorkspaceSection } from './WorkspaceSection';
import { conversationDiagnostic } from '../../product/conversationEligibility';

const mockUseChat = jest.fn();

jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./WorkspaceSection.css', () => ({}));
jest.mock('../common/Button.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));

const verifiedState = {
  conversations: [{ roomId: 'room-1', label: 'Contact' }],
  channelHash: 'room-1',
  isConnected: true,
  sessionHealth: 'healthy',
  protocolMode: 'modern',
  contactIdentity: { verification: 'verified', changeStatus: 'unchanged' },
  startCall: jest.fn().mockResolvedValue(undefined),
  startVideoCall: jest.fn().mockResolvedValue(undefined),
  callLifecycleState: 'idle', callActive: false,
  setContactNickname: jest.fn(),
};

const renderCalls = (overrides: Record<string, unknown> = {}): string => {
  mockUseChat.mockReturnValue({ ...verifiedState, ...overrides } as unknown as ChatContextType);
  return renderToStaticMarkup(React.createElement(WorkspaceSection, { section: 'calls', onOpenConversation: () => undefined, onNewConversation: () => undefined }));
};

const buttonMarkup = (markup: string, label: string): string => {
  const escaped = markup.match(new RegExp(`<button\\b(?=[^>]*aria-label="${label}")[^>]*>`));
  if (!escaped) throw new Error(`Missing button: ${label}`);
  return escaped[0];
};

it('separates actual verified contacts from invitations, unavailable and archived records without trusting a label', () => {
  const saved = { version: 1 as const, roomId: '00000000-0000-4000-8000-000000000001', label: 'Known friend', controlCapability: 'a'.repeat(43), updatedAt: 1, remoteAddress: 'saved-peer-address' };
  const pending = { ...saved, roomId: '00000000-0000-4000-8000-000000000002', label: 'Unaccepted invitation', relationship: 'invitation' as const, remoteAddress: undefined };
  const unknown = { ...saved, roomId: '00000000-0000-4000-8000-000000000003', label: 'Unknown saved label' };
  const archived = { ...saved, roomId: '00000000-0000-4000-8000-000000000004', label: 'Archived test', locallyArchived: true };
  mockUseChat.mockReturnValue({ ...verifiedState, accountState: 'ready', conversations: [saved, pending, unknown, archived], savedContactVerification: { [saved.roomId]: 'verified' }, unavailableConversations: [conversationDiagnostic(unknown, 'CONTACT_REGISTRY_MISSING'), { label: 'Invalid saved entry', state: 'local-incomplete', code: 'CONVERSATION_RECORD_INVALID' }] });
  const html = renderToStaticMarkup(React.createElement(WorkspaceSection, { section: 'contacts', onOpenConversation: () => undefined, onNewConversation: () => undefined }));
  expect((html.match(/class="workspace-contact"/g) ?? [])).toHaveLength(1);
  expect(html).toContain('Verified on this device');
  expect(html).toContain('These are invitations, not established contacts.');
  expect(html).toContain('matching local contact identity is unavailable');
  expect(html).toContain('<summary>Technical details</summary><small>CONTACT_REGISTRY_MISSING');
  expect(html).toContain('Archived conversations (1)');
  expect(html).toContain('Restore conversation Archived test');
  expect(html).not.toContain('Archive conversation Invalid saved entry');
});

describe('Calls workspace launch controls', () => {
  it('exposes both verified call intents on the Calls page', () => {
    const markup = renderCalls();
    expect(markup).toContain('Voice call');
    expect(markup).toContain('Video call');
    expect(buttonMarkup(markup, 'Start audio call')).not.toContain('disabled');
    expect(buttonMarkup(markup, 'Start video call')).not.toContain('disabled');
  });

  it('does not let terminal status copy block another call', () => {
    for (const state of ['ended', 'rejected', 'cancelled', 'timeout', 'ice-failed', 'media-denied', 'signaling-failed']) {
      expect(buttonMarkup(renderCalls({ callLifecycleState: state, callActive: false }), 'Start audio call')).not.toContain('disabled');
    }
  });

  it('blocks unverified, changed, unhealthy, disconnected, and incompatible contacts', () => {
    const states: Array<[Record<string, unknown>, string]> = [
      [{ contactIdentity: { verification: 'unverified', changeStatus: 'unchanged' } }, 'Verify this contact before calling.'],
      [{ contactIdentity: { verification: 'verified', changeStatus: 'changed-pending-review' } }, 'identity changed'],
      [{ contactIdentity: undefined }, 'K3NCRYPT could not check this contact’s verification'],
      [{ isConnected: false }, 'Reconnect to this verified contact'],
      [{ sessionHealth: 'renewal-pending' }, 'Reconnect to this verified contact'],
      [{ protocolMode: 'legacy' }, 'newer K3NCRYPT version'],
      [{ callLifecycleState: 'connected', callActive: true }, 'already in progress'],
    ];
    for (const [overrides, message] of states) {
      const markup = renderCalls(overrides);
      expect(buttonMarkup(markup, 'Start audio call')).toContain('disabled');
      expect(buttonMarkup(markup, 'Start video call')).toContain('disabled');
      expect(markup.toLowerCase()).toContain(message.toLowerCase());
    }
  });
});
