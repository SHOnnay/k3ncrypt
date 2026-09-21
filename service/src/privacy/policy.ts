import type { PermissionName } from '../platform';
import type { PrivacyPreferences } from './preferences';

export class PrivacyPolicy {
    public constructor(private readonly preferences: PrivacyPreferences) {}
    public assertAnalyticsAllowed(): never { throw new Error('Analytics are disabled.'); }
    public assertExternalMediaAllowed(): void { if (!this.preferences.externalMedia) throw new Error('External media access is disabled.'); }
    public assertPermissionRequest(permission: PermissionName, userAction: boolean, foreground: boolean): void { if (!userAction || !foreground || permission === 'files' && !this.preferences.externalMedia) throw new Error('Privacy policy rejected the request.'); }
}
