import { deliverNotification, notificationPayload } from './notifications';
import { defaultPrivacyPreferences } from './preferences';

describe('product notification privacy', () => {
  it('uses a content-free message notification by default, naming only the local contact name', () => {
    expect(notificationPayload({ kind: 'message', conversationId: 'room', sender: 'Alice', preview: 'send password' }, defaultPrivacyPreferences)).toEqual({ title: 'K3NCRYPT', body: 'New message from Alice', tag: 'k3ncrypt:message:room', silent: false });
    expect(notificationPayload({ kind: 'message', conversationId: 'room', preview: 'send password' }, defaultPrivacyPreferences)?.body).toBe('New message');
  });
  it('bounds the sender name', () => expect(notificationPayload({ kind: 'message', conversationId: 'room', sender: 'x'.repeat(100) }, defaultPrivacyPreferences)?.body).toBe(`New message from ${'x'.repeat(40)}`));
  it('permits a bounded preview only when the user explicitly enables it', () => expect(notificationPayload({ kind: 'message', conversationId: 'room', preview: 'hello' }, { ...defaultPrivacyPreferences, notificationPreviews: true })?.body).toBe('hello'));
  it('suppresses muted conversations and disabled notifications', () => { expect(notificationPayload({ kind: 'group-message', conversationId: 'room' }, { ...defaultPrivacyPreferences, mutedConversations: ['room'] })).toBeUndefined(); expect(deliverNotification({ kind: 'security' }, { ...defaultPrivacyPreferences, notificationsEnabled: false }, { show: jest.fn() })).toBe(false); });
});
