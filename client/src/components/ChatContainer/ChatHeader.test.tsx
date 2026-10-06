import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatContextType } from '../../types';
import { ChatHeader } from './ChatHeader';

const mockUseChat = jest.fn();

jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('./SecurityVisibility.css', () => ({}));
jest.mock('./ChatHeader.css', () => ({}));
jest.mock('../common/Button.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));
jest.mock('../common/StatusPill.css', () => ({}));

const verifiedState = {
  isConnected: true,
  channelHash: 'room-1',
  deleteChannel: jest.fn(),
  protocolMode: 'modern',
  sessionHealth: 'healthy',
  conversations: [{ roomId: 'room-1', label: 'Contact' }],
  contactIdentity: { verification: 'verified', changeStatus: 'unchanged' },
};

const renderHeader = (overrides: Record<string, unknown> = {}): string => {
  mockUseChat.mockReturnValue({ ...verifiedState, ...overrides } as unknown as ChatContextType);
  return renderToStaticMarkup(React.createElement(ChatHeader, { onStartCall: () => undefined, onStartVideoCall: () => undefined }));
};

const buttonMarkup = (markup: string, label: string): string => {
  const element = markup.match(new RegExp(`<button\\b(?=[^>]*aria-label="${label}")[^>]*>`));
  if (!element) throw new Error(`Missing button: ${label}`);
  return element[0];
};

describe('ChatHeader call launch controls', () => {
  it('exposes accessible audio and video launches for a verified, connected modern contact', () => {
    const markup = renderHeader();
    expect(buttonMarkup(markup, 'Start audio call')).not.toContain('disabled');
    expect(buttonMarkup(markup, 'Start video call')).not.toContain('disabled');
    expect(markup).not.toContain('call-launch-reason');
  });

  it('blocks both call intents for an unverified or identity-changed contact with an announced reason', () => {
    const unverified = renderHeader({ contactIdentity: { verification: 'unverified', changeStatus: 'unchanged' } });
    expect(buttonMarkup(unverified, 'Start audio call')).toContain('disabled');
    expect(buttonMarkup(unverified, 'Start video call')).toContain('disabled');
    expect(unverified).toContain('Verified contact required before calling.');
    expect(buttonMarkup(unverified, 'Start video call')).toContain('aria-describedby="call-launch-reason"');

    const changed = renderHeader({ contactIdentity: { verification: 'verified', changeStatus: 'changed-pending-review' } });
    expect(buttonMarkup(changed, 'Start video call')).toContain('disabled');
    expect(changed).toContain('identity changed');
  });

  it('reports upgrade, connection, and active-call blocks separately', () => {
    const legacy = renderHeader({ protocolMode: 'legacy' });
    expect(buttonMarkup(legacy, 'Start video call')).toContain('disabled');
    expect(legacy).toContain('Call requires a newer K3NCRYPT version.');

    const disconnected = renderHeader({ isConnected: false });
    expect(disconnected).toContain('Connect to this verified contact');

    mockUseChat.mockReturnValue({ ...verifiedState } as unknown as ChatContextType);
    const busy = renderToStaticMarkup(React.createElement(ChatHeader, { onStartCall: () => undefined, onStartVideoCall: () => undefined, disableStartCall: true }));
    expect(buttonMarkup(busy, 'Start audio call')).toContain('disabled');
    expect(busy).toContain('A call is already in progress.');
  });
});
