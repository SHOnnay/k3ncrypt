export type MediaPermissionKind = 'microphone' | 'camera';
export type MediaPermissionState = 'unknown' | 'requested' | 'granted' | 'active' | 'released' | 'denied';

export class MediaPermissionTracker {
    private readonly states = new Map<MediaPermissionKind, MediaPermissionState>();
    get(kind: MediaPermissionKind): MediaPermissionState { return this.states.get(kind) ?? 'unknown'; }
    markRequested(kind: MediaPermissionKind): void { this.states.set(kind, 'requested'); }
    markGranted(kind: MediaPermissionKind): void { this.states.set(kind, 'granted'); }
    markActive(kind: MediaPermissionKind): void { this.states.set(kind, 'active'); }
    markReleased(kind: MediaPermissionKind): void { this.states.set(kind, 'released'); }
    markDenied(kind: MediaPermissionKind): void { this.states.set(kind, 'denied'); }
}
