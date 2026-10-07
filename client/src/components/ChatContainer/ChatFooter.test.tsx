import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatFooter } from './ChatFooter';

const mockUseChat = jest.fn();
const mockUseFiles = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockUseChat() }));
jest.mock('../../context/FileContext', () => ({ useFiles: () => mockUseFiles() }));
jest.mock('./ChatFooter.css', () => ({}));
jest.mock('../common/Button.css', () => ({}));

describe('Web chat composer', () => {
  it('uses a labeled multi-line composer and keeps file size information next to it', () => {
    mockUseChat.mockReturnValue({ sendMessage: jest.fn(), sessionHealth: 'healthy', contactIdentity: { verification: 'verified', changeStatus: 'unchanged' } });
    mockUseFiles.mockReturnValue({ transfer: { phase: 'RestartRequired', bytes: 0, total: 0 }, sendFile: jest.fn(), retry: jest.fn(), cancel: jest.fn(), receive: jest.fn() });
    const markup = renderToStaticMarkup(createElement(ChatFooter, { onVerifyContact: () => undefined }));
    expect(markup).toContain('<textarea');
    expect(markup).toContain('aria-label="Write a message"');
    expect(markup).toContain('Attach a photo or file, up to 8 MiB');
    expect(markup).toContain('Photos and files up to 8 MiB');
    expect(markup).toContain('aria-label="Send message"');
  });

  it('offers an explicit verification action for an unverified contact', () => {
    mockUseChat.mockReturnValue({ sendMessage: jest.fn(), sessionHealth: 'healthy', contactIdentity: { verification: 'unverified', changeStatus: 'unchanged' } });
    mockUseFiles.mockReturnValue({ transfer: { phase: 'RestartRequired', bytes: 0, total: 0 }, sendFile: jest.fn(), retry: jest.fn(), cancel: jest.fn(), receive: jest.fn() });
    const markup = renderToStaticMarkup(createElement(ChatFooter, { onVerifyContact: () => undefined }));
    expect(markup).toContain('Invitation accepted');
    expect(markup).toContain('Verify this contact');
  });
});
