import { ForegroundPermissionBoundary } from './permissions';
import { DEFAULT_PRIVACY_PREFERENCES, validatePrivacyPreferences } from './preferences';

describe('privacy boundaries', () => {
    it('keeps analytics and background capture disabled', () => { expect(DEFAULT_PRIVACY_PREFERENCES.analytics).toBe(false); expect(DEFAULT_PRIVACY_PREFERENCES.backgroundCapture).toBe(false); validatePrivacyPreferences(DEFAULT_PRIVACY_PREFERENCES); });
    it('requires explicit user action and releases permissions', async () => { const calls: string[] = []; const boundary = new ForegroundPermissionBoundary({ request: async (permission) => { calls.push(`request:${permission}`); return true; }, release: async (permission) => { calls.push(`release:${permission}`); } }); await expect(boundary.request('microphone', false)).rejects.toThrow(); await boundary.request('microphone', true); expect(boundary.isActive('microphone')).toBe(true); await boundary.release('microphone'); expect(calls).toEqual(['request:microphone', 'release:microphone']); });
});
