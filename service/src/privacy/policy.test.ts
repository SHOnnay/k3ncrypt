import { ForegroundPermissionBoundary } from './permissions';
import { PrivacyPolicy } from './policy';
import { DEFAULT_PRIVACY_PREFERENCES } from './preferences';

describe('production privacy policy', () => {
    it('rejects analytics, external media, and background capture', async () => { const policy = new PrivacyPolicy(DEFAULT_PRIVACY_PREFERENCES); expect(() => policy.assertAnalyticsAllowed()).toThrow(); expect(() => policy.assertExternalMediaAllowed()).toThrow(); expect(() => policy.assertPermissionRequest('camera', true, false)).toThrow(); const boundary = new ForegroundPermissionBoundary({ request: async () => true, release: async () => undefined }); await expect(boundary.request('microphone', true, false)).rejects.toThrow(); expect(boundary.state('microphone')).toBe('unknown'); });
    it('tracks and releases camera and microphone access', async () => { const released: string[] = []; const boundary = new ForegroundPermissionBoundary({ request: async () => true, release: async (permission) => { released.push(permission); } }); await boundary.request('microphone', true); await boundary.request('camera', true); await boundary.releaseCapture(); expect(released.sort()).toEqual(['camera', 'microphone']); expect(boundary.isActive('camera')).toBe(false); });
});
