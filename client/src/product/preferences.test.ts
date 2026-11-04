import { readPrivacyPreferences, writePrivacyPreferences } from './preferences';

describe('privacy preferences', () => {
  const values = new Map<string, string>();
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      clear: () => values.clear(),
    } });
  });
  beforeEach(() => localStorage.clear());
  it('defaults analytics and previews off', () => expect(readPrivacyPreferences()).toEqual({ notificationsEnabled: true, notificationPreviews: false, mutedConversations: [], blurSensitiveContent: false, screenPrivacy: false, ringtoneEnabled: true, analytics: false, mediaAutoDownload: false, connectionHelper: false }));
  it('never permits analytics through persisted user input', () => {
    localStorage.setItem('k3ncrypt:privacy:v1', JSON.stringify({ analytics: true, notificationPreviews: true, mediaAutoDownload: true }));
    expect(readPrivacyPreferences()).toMatchObject({ analytics: false, notificationPreviews: true, mediaAutoDownload: true });
    expect(writePrivacyPreferences({ ...readPrivacyPreferences(), analytics: false, notificationPreviews: false, mediaAutoDownload: true }).analytics).toBe(false);
  });
  // Calls milestone 3: the connection helper stays off until the user turns it on.
  it('keeps the connection helper off by default and remembers it when turned on', () => {
    localStorage.setItem('k3ncrypt:privacy:v1', 'null');
    expect(readPrivacyPreferences().connectionHelper).toBe(false);
    writePrivacyPreferences({ ...readPrivacyPreferences(), connectionHelper: true });
    expect(readPrivacyPreferences().connectionHelper).toBe(true);
  });
});
