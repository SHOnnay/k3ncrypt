export interface PrivacyPreferences {
  notificationsEnabled: boolean;
  notificationPreviews: boolean;
  mutedConversations: readonly string[];
  blurSensitiveContent: boolean;
  screenPrivacy: boolean;
  ringtoneEnabled: boolean;
  analytics: false;
  mediaAutoDownload: boolean;
}

const KEY = 'k3ncrypt:privacy:v1';
export const defaultPrivacyPreferences: PrivacyPreferences = Object.freeze({ notificationsEnabled: true, notificationPreviews: false, mutedConversations: [], blurSensitiveContent: false, screenPrivacy: false, ringtoneEnabled: true, analytics: false, mediaAutoDownload: false });

export const readPrivacyPreferences = (): PrivacyPreferences => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PrivacyPreferences> | null;
    return {
      notificationsEnabled: value?.notificationsEnabled !== false,
      notificationPreviews: value?.notificationPreviews === true,
      mutedConversations: Array.isArray(value?.mutedConversations) ? value!.mutedConversations.filter((id): id is string => typeof id === 'string').slice(0, 100) : [],
      blurSensitiveContent: value?.blurSensitiveContent === true,
      screenPrivacy: value?.screenPrivacy === true,
      ringtoneEnabled: value?.ringtoneEnabled !== false,
      analytics: false,
      mediaAutoDownload: value?.mediaAutoDownload === true,
    };
  } catch { return { ...defaultPrivacyPreferences }; }
};

export const writePrivacyPreferences = (value: PrivacyPreferences): PrivacyPreferences => {
  const enforced: PrivacyPreferences = { notificationsEnabled: value.notificationsEnabled !== false, notificationPreviews: value.notificationPreviews === true, mutedConversations: Array.from(new Set(value.mutedConversations.filter((id) => typeof id === 'string'))).slice(0, 100), blurSensitiveContent: value.blurSensitiveContent === true, screenPrivacy: value.screenPrivacy === true, ringtoneEnabled: value.ringtoneEnabled !== false, analytics: false, mediaAutoDownload: value.mediaAutoDownload === true };
  localStorage.setItem(KEY, JSON.stringify(enforced));
  return enforced;
};
