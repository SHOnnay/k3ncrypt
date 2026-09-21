import type { PermissionAdapter, PermissionName } from '../platform';

export type PrivacyPermissionState = 'unknown' | 'requested' | 'granted' | 'active' | 'released' | 'denied';
export class ForegroundPermissionBoundary {
    private readonly states = new Map<PermissionName, PrivacyPermissionState>();
    public constructor(private readonly adapter: PermissionAdapter) {}
    public async request(permission: PermissionName, userAction: boolean, foreground = true): Promise<void> { if (!userAction || !foreground) throw new Error('Permission was not granted.'); this.states.set(permission, 'requested'); if (!(await this.adapter.request(permission))) { this.states.set(permission, 'denied'); throw new Error('Permission was not granted.'); } this.states.set(permission, 'granted'); this.states.set(permission, 'active'); }
    public async release(permission: PermissionName): Promise<void> { if (this.states.get(permission) === 'active') await this.adapter.release(permission); this.states.set(permission, 'released'); }
    public isActive(permission: PermissionName): boolean { return this.states.get(permission) === 'active'; }
    public state(permission: PermissionName): PrivacyPermissionState { return this.states.get(permission) ?? 'unknown'; }
    public async releaseCapture(): Promise<void> { await this.release('microphone'); await this.release('camera'); }
}
