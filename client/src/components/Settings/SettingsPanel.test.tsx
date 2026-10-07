import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsPanel } from './SettingsPanel';
const mockChat = jest.fn();
jest.mock('../../context/ChatContext', () => ({ useChat: () => mockChat() }));
jest.mock('../../theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'paper' }) }));
jest.mock('./SettingsPanel.css', () => ({}));
jest.mock('../common/Avatar.css', () => ({}));
jest.mock('../common/StatusPill.css', () => ({}));
jest.mock('../common/ThemeSwitcher.css', () => ({}));
it('does not offer ineffective Web native-screen or automatic-media controls', () => {
  mockChat.mockReturnValue({ profileDisplayName: 'Alice', protocolMode: 'modern', accountState: 'ready', permissionStatus: { microphone: 'unknown', camera: 'unknown' }, privacyPreferences: { notificationPreviews: false, blurSensitiveContent: false, mutedConversations: [] } });
  const markup = renderToStaticMarkup(createElement(SettingsPanel, { isOpen: true, initialView: 'privacy', onClose: () => undefined }));
  expect(markup).not.toContain('Screen privacy');
  expect(markup).not.toContain('Media auto-download');
  expect(markup).toContain('Blur sensitive content');
});
