import { addUnread, badgeLabel, clearUnread, planIncomingMessage, shouldOfferNotificationPermission, tabTitle, totalUnread, type ReceiveContext } from './alerts';

const base: ReceiveContext = { roomId: 'a', openRoomId: 'a', pageVisible: true, muted: false, soundsEnabled: true, notificationsEnabled: true };

describe('N1 incoming message plan [unit test]', () => {
  it('is silent and read when the chat is open and the page is visible', () => expect(planIncomingMessage(base)).toEqual({ unread: false, sound: false, notify: false }));
  it('plays a sound and counts unread when another chat is open', () => expect(planIncomingMessage({ ...base, openRoomId: 'b' })).toEqual({ unread: true, sound: true, notify: false }));
  it('plays a sound, notifies and counts unread when the tab is in the background', () => expect(planIncomingMessage({ ...base, pageVisible: false })).toEqual({ unread: true, sound: true, notify: true }));
  it('counts unread when the page is hidden even if that chat is the open one', () => expect(planIncomingMessage({ ...base, pageVisible: false, openRoomId: 'a' }).unread).toBe(true));
  it('mute removes sound and notification but keeps the badge', () => expect(planIncomingMessage({ ...base, pageVisible: false, openRoomId: 'b', muted: true })).toEqual({ unread: true, sound: false, notify: false }));
  it('respects the sound and notification settings', () => expect(planIncomingMessage({ ...base, pageVisible: false, soundsEnabled: false, notificationsEnabled: false })).toEqual({ unread: true, sound: false, notify: false }));
});

describe('N1 unread counts and tab title [unit test]', () => {
  it('counts per chat, clears one chat and totals', () => {
    let counts = addUnread({}, 'a'); counts = addUnread(counts, 'a'); counts = addUnread(counts, 'b');
    expect(counts).toEqual({ a: 2, b: 1 }); expect(totalUnread(counts)).toBe(3);
    expect(clearUnread(counts, 'a')).toEqual({ b: 1 }); expect(clearUnread(counts, 'zzz')).toBe(counts);
  });
  it('caps a chat and shortens large badges', () => { let counts = {}; for (let i = 0; i < 1100; i++) counts = addUnread(counts, 'a'); expect(totalUnread(counts)).toBe(999); expect(badgeLabel(100)).toBe('99+'); expect(badgeLabel(7)).toBe('7'); });
  it('puts the total in the tab title only when there is something unread', () => { expect(tabTitle('K3NCRYPT', 0)).toBe('K3NCRYPT'); expect(tabTitle('K3NCRYPT', 3)).toBe('(3) K3NCRYPT'); });
});

describe('N1 notification permission offer [unit test]', () => {
  it('offers once, after the first chat, while permission is undecided', () => {
    expect(shouldOfferNotificationPermission({ permission: 'default', hasChat: true, alreadyOffered: false })).toBe(true);
    expect(shouldOfferNotificationPermission({ permission: 'default', hasChat: false, alreadyOffered: false })).toBe(false);
    expect(shouldOfferNotificationPermission({ permission: 'default', hasChat: true, alreadyOffered: true })).toBe(false);
    expect(shouldOfferNotificationPermission({ permission: 'granted', hasChat: true, alreadyOffered: false })).toBe(false);
    expect(shouldOfferNotificationPermission({ permission: 'denied', hasChat: true, alreadyOffered: false })).toBe(false);
    expect(shouldOfferNotificationPermission({ permission: 'unsupported', hasChat: true, alreadyOffered: false })).toBe(false);
  });
});
