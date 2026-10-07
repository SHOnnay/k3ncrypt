import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatContextType } from '../../types';
import { WorkspaceSection } from './WorkspaceSection';

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
