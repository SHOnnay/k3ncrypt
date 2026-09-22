import { deliverNotification, notificationPayload } from './notifications';
import { defaultPrivacyPreferences } from './preferences';

describe('product notification privacy', () => {
  it('uses a generic private message notification by default', () => expect(notificationPayload({ kind: 'message', conversationId: 'room', sender: 'Alice', preview: 'send password' }, defaultPrivacyPreferences)).toEqual({ title: 'K3NCRYPT', body: 'New message', tag: 'k3ncrypt:message:room', silent: false }));
  it('permits a bounded preview only when the user explicitly enables it', () => expect(notificationPayload({ kind: 'message', conversationId: 'room', preview: 'hello' }, { ...defaultPrivacyPreferences, notificationPreviews: true })?.body).toBe('hello'));
  it('suppresses muted conversations and disabled notifications', () => { expect(notificationPayload({ kind: 'group-message', conversationId: 'room' }, { ...defaultPrivacyPreferences, mutedConversations: ['room'] })).toBeUndefined(); expect(deliverNotification({ kind: 'security' }, { ...defaultPrivacyPreferences, notificationsEnabled: false }, { show: jest.fn() })).toBe(false); });
});
