export interface PrivacyPreferences { readonly analytics: false; readonly backgroundCapture: false; readonly externalMedia: false; readonly minimizeMetadata: boolean; }
export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = Object.freeze({ analytics: false, backgroundCapture: false, externalMedia: false, minimizeMetadata: true });
export const validatePrivacyPreferences = (preferences: PrivacyPreferences): void => { if (preferences.analytics || preferences.backgroundCapture || preferences.externalMedia) throw new Error('Privacy preference rejected.'); };
