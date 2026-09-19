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
