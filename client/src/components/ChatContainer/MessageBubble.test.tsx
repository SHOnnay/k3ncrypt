import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FILE_PREFIX } from '@chat-e2ee/service';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../../types/index';

const mockUseChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
const mockFiles: { queued: string[] } = { queued: [] };
jest.mock('../../context/FileContext', () => ({ useFiles: () => ({ download: undefined, queued: mockFiles.queued, previews: { release: jest.fn(), add: jest.fn() }, receive: jest.fn(), cancel: jest.fn() }) }));
jest.mock('../../context/MediaContext', () => ({ useMedia: () => ({ receive: jest.fn() }) }));
jest.mock('./MessageBubble.css', () => ({}));
jest.mock('./SecurityVisibility.css', () => ({}));

const v2File: Message = { id: 'f', sender: 'contact', type: 'received', text: 'Protected file', timestamp: new Date(1), media: { kind: 'file', size: 2048, reference: `${FILE_PREFIX}opaque` } };
const v1Media: Message = { id: 'm', sender: 'contact', type: 'received', text: 'Photo', timestamp: new Date(1), media: { kind: 'image', reference: 'k3ncrypt-media-v1:opaque' } };
const render = (message: Message, contactIdentity: unknown) => {
  mockUseChat.mockReturnValue({ retryMessage: jest.fn(), protocolMode: 'modern', channelHash: 'room', plaintextSession: { isCurrent: () => true }, contactIdentity });
  return renderToStaticMarkup(createElement(MessageBubble, { message }));
};

// Invariant: calls and file transfer require a verified, unchanged identity (P0-1, P0-1b).
describe('received file and media trust presentation', () => {
  it.each([
    ['unverified', { verification: 'unverified', changeStatus: 'unchanged' }, 'Check it’s really your contact to open this file.'],
    ['identity changed', { verification: 'unverified', changeStatus: 'changed-pending-review' }, 'Your contact’s security number changed. Check again to open this file.'],
    ['unknown contact', undefined, 'Check it’s really your contact to open this file.'],
  ])('offers no open action for a %s contact', (_label, contact, note) => {
    for (const message of [v2File, v1Media]) {
      const markup = render(message, contact);
      expect(markup).toContain(note);
      expect(markup).not.toContain('Download protected file');
      expect(markup).not.toContain('Open protected');
    }
  });

  it('offers the open action only for a verified, unchanged contact', () => {
    const contact = { verification: 'verified', changeStatus: 'unchanged' };
    expect(render(v2File, contact)).toContain('aria-label="Download protected file"');
    expect(render(v1Media, contact)).toContain('Open protected image');
    expect(render(v2File, contact)).not.toContain('Check it’s really');
  });
});

// UX A2: a queued download shows that it is waiting, never a raw error.
it('shows a queued file as Waiting with its action disabled', () => {
  mockFiles.queued = [`${FILE_PREFIX}opaque`];
  try {
    const markup = render(v2File, { verification: 'verified', changeStatus: 'unchanged' });
    expect(markup).toContain('Waiting…');
    expect(markup).toMatch(/<button[^>]*disabled[^>]*aria-label="Waiting for another file to finish"/);
    expect(markup).not.toContain('Another file operation');
  } finally { mockFiles.queued = []; }
});

it('renders a call as one compact row with direction, duration and time, without "On this device"', () => {
  const call: Message = { id: 'local-call:1', sender: 'local-call-history', type: 'received', text: 'Voice call', timestamp: new Date(Date.UTC(2026, 10, 3, 9, 5)),
    callEvent: { mode: 'audio', outcome: 'completed', direction: 'outgoing', durationSeconds: 125 } };
  const markup = render(call, undefined);
  expect(markup).toContain('aria-label="Local call history"');
  expect(markup).toContain('call-row call-row--outgoing');
  expect(markup).toContain('Outgoing voice call'); expect(markup).toContain('2:05');
  expect(markup).not.toContain('On this device'); expect(markup).not.toContain(' min ');
});

// UX A9: the card shows the file name and a type badge once known.
it('shows the remembered file name and type badge on the card', () => {
  mockUseChat.mockReturnValue({ retryMessage: jest.fn(), protocolMode: 'modern', channelHash: 'room', plaintextSession: { isCurrent: () => true },
    contactIdentity: { verification: 'verified', changeStatus: 'unchanged' }, fileDetailsForReference: () => ({ name: 'Quarterly report.pdf', mimeType: 'application/pdf' }) });
  const markup = renderToStaticMarkup(createElement(MessageBubble, { message: v2File }));
  expect(markup).toContain('Quarterly report.pdf'); expect(markup).toContain('message-file-badge'); expect(markup).toContain('>PDF<');
  expect(markup).not.toContain('>Protected file<');
});
it('says a received file name appears after download when it is not known yet', () => {
  const markup = render(v2File, { verification: 'verified', changeStatus: 'unchanged' });
  expect(markup).toContain('Protected file'); expect(markup).toContain('>FILE<');
});
