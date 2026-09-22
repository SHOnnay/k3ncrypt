export interface PrivacyPreferences {
  notificationPreviews: boolean;
  analytics: false;
  mediaAutoDownload: boolean;
}

const KEY = 'k3ncrypt:privacy:v1';
export const defaultPrivacyPreferences: PrivacyPreferences = Object.freeze({ notificationPreviews: false, analytics: false, mediaAutoDownload: false });

export const readPrivacyPreferences = (): PrivacyPreferences => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PrivacyPreferences> | null;
    return {
      notificationPreviews: value?.notificationPreviews === true,
      analytics: false,
      mediaAutoDownload: value?.mediaAutoDownload === true,
    };
  } catch { return { ...defaultPrivacyPreferences }; }
};

export const writePrivacyPreferences = (value: PrivacyPreferences): PrivacyPreferences => {
  const enforced: PrivacyPreferences = { notificationPreviews: value.notificationPreviews === true, analytics: false, mediaAutoDownload: value.mediaAutoDownload === true };
  localStorage.setItem(KEY, JSON.stringify(enforced));
  return enforced;
};
