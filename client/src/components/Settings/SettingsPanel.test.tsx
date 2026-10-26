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
const state = { channelHash: 'room', profileDisplayName: 'Alice', protocolMode: 'modern', ownFingerprint: 'local-identity', accountState: 'ready', conversations: [], syncStatus: 'ready', sessionHealth: 'healthy', permissionStatus: { microphone: 'unknown', camera: 'denied' }, privacyPreferences: { notificationsEnabled: true, notificationPreviews: false, blurSensitiveContent: false, mutedConversations: [] } };
const render = (initialView: 'privacy' | 'devices' | 'network' | 'verification') => renderToStaticMarkup(createElement(SettingsPanel, { isOpen: true, initialView, onClose: () => undefined }));
beforeEach(() => mockChat.mockReturnValue(state));
it('separates implemented preferences from fixed properties and permission reports', () => {
  const markup = render('privacy');
  for (const heading of ['App protection', 'Notifications and previews', 'Screen privacy', 'Browser permissions', 'Data and external connections']) expect(markup).toContain(heading);
  expect(markup).not.toContain('Media auto-download');
  expect(markup).not.toContain('voice-note action');
  expect(markup).toContain('Not reported'); expect(markup).toContain('Blocked');
  expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(3);
  expect(markup).toContain('does not lock the vault or prevent screenshots');
});
it('never calls an HTTP service connection ready solely because device trust is ready', () => {
  mockChat.mockReturnValue({ ...state, isConnected: true, contactIdentity: { identityId: 'authenticated-peer', verification: 'unverified', changeStatus: 'unchanged' } });
  const markup = render('network');
  expect(markup).toContain('Service reachability'); expect(markup).toContain('Not checked');
  expect(markup).toContain('Encrypted session available'); expect(markup).toContain('Last device authorization check');
  expect(markup).not.toContain('Secure conversation connected'); expect(markup).not.toContain('>Online<');
});
it('identifies this device by full identity instead of a routing address and never offers self-revoke', () => {
  mockChat.mockReturnValue({ ...state, userId: 'routing-address', deviceLifecycleState: { list: { devices: [
    { deviceId: 'different-device-id', publicIdentityReference: 'local-identity', state: 'active' },
    { deviceId: 'device-revoked', publicIdentityReference: 'old-identity', state: 'revoked' },
    { deviceId: 'device-pending', publicIdentityReference: 'pending-identity', state: 'approved_pending_confirmation' },
  ] } } });
  const markup = render('devices');
  expect(markup).toContain('This device'); expect(markup).toContain('Self-revocation is not offered here');
  expect(markup).not.toContain('Approved device'); expect(markup).toContain('Revoked'); expect(markup).toContain('confirmation needed');
  expect((markup.match(/>Revoke<\/button>/g) ?? []).length).toBe(1);
  expect(markup).toContain('Guided device setup is not available');
});
it('does not invent an empty device list on read failure', () => {
  expect(render('devices')).toContain('Device list unavailable');
});
it('does not imply an unopened vault has working verification', () => {
  mockChat.mockReturnValue({ ...state, ownFingerprint: undefined, accountState: 'locked' });
  expect(render('verification')).toContain('Unlock your vault');
  expect(render('verification')).not.toContain('Mark as verified');
});

it('does not equate an open invitation with an established encrypted conversation', () => {
  mockChat.mockReturnValue({ ...state, isConnected: true });
  expect(render('network')).toContain('Waiting for acceptance');
  expect(render('network')).not.toContain('Encrypted session available');
});
it('explains missing identity for an established saved conversation as unavailable, not a fresh invitation', () => {
  mockChat.mockReturnValue({ ...state, ownFingerprint: 'K3 AAAA CCCC_DDDD', conversations: [{ roomId: 'room', label: 'Saved peer', relationship: 'accepted' }] });
  expect(render('verification')).toContain('Temporarily unavailable');
  expect(render('verification')).not.toContain('Mark as verified');
});

it('hides cached identity comparison and device metadata when the vault is locked', () => {
  mockChat.mockReturnValue({ ...state, accountState: 'locked', deviceLifecycleState: { list: { devices: [{ deviceId: 'retained-private-device', publicIdentityReference: 'local-identity', state: 'active' }] } } });
  expect(render('verification')).not.toContain('Your verification QR payload');
  expect(render('devices')).not.toContain('retained-private-device');
  expect(render('devices')).toContain('Unlock required');
});

it('does not attach another room’s failed selection to the current conversation readiness', () => {
  mockChat.mockReturnValue({ ...state, isConnected: true, contactIdentity: { identityId: 'authenticated-peer', verification: 'unverified', changeStatus: 'unchanged' }, conversationOpenError: { roomId: 'other-room', code: 'CONVERSATION_ROOM_REMOVED' } });
  expect(render('network')).toContain('Encrypted session available');
  expect(render('network')).not.toContain('Recovery needed');
});
