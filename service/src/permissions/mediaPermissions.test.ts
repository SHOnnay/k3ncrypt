import { MediaPermissionTracker } from './mediaPermissions';

it('tracks explicit permission lifecycle without accessing browser devices', () => {
    const tracker = new MediaPermissionTracker();
    expect(tracker.get('microphone')).toBe('unknown');
    tracker.markRequested('microphone');
    tracker.markGranted('microphone');
    tracker.markActive('microphone');
    tracker.markReleased('microphone');
    expect(tracker.get('microphone')).toBe('released');
    expect(tracker.get('camera')).toBe('unknown');
});

it('retains a denied permission state without marking capture active', () => {
    const tracker = new MediaPermissionTracker();
    tracker.markRequested('camera');
    tracker.markDenied('camera');
    expect(tracker.get('camera')).toBe('denied');
});
