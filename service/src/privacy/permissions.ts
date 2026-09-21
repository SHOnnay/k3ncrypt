import type { PermissionAdapter, PermissionName } from '../platform';

export class ForegroundPermissionBoundary {
    private readonly active = new Set<PermissionName>();
    public constructor(private readonly adapter: PermissionAdapter) {}
    public async request(permission: PermissionName, userAction: boolean): Promise<void> { if (!userAction || !(await this.adapter.request(permission))) throw new Error('Permission was not granted.'); this.active.add(permission); }
    public async release(permission: PermissionName): Promise<void> { if (this.active.delete(permission)) await this.adapter.release(permission); }
    public isActive(permission: PermissionName): boolean { return this.active.has(permission); }
}
