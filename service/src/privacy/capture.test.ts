import { BrowserCaptureController } from './capture';

describe('browser capture privacy boundary', () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    afterEach(() => {
        if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
        else Reflect.deleteProperty(globalThis, 'navigator');
    });
    it('stops late tracks when cancelled while permission is pending', async () => {
        let resolve!: (stream: MediaStream) => void;
        const pending = new Promise<MediaStream>((done) => { resolve = done; });
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => pending } } });
        const stop = jest.fn();
        const controller = new BrowserCaptureController();
        const request = controller.request({ audio: true });
        controller.release();
        resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
        await expect(request).rejects.toThrow('unavailable');
        expect(stop).toHaveBeenCalledTimes(1);
    });
    it('releases active capture and can retry after permission failure', async () => {
        const stop = jest.fn();
        const getUserMedia = jest.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue({ getTracks: () => [{ stop }] });
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
        const controller = new BrowserCaptureController();
        await expect(controller.request({ audio: true })).rejects.toThrow('unavailable');
        await controller.request({ audio: true });
        controller.release();
        controller.release();
        expect(stop).toHaveBeenCalledTimes(1);
    });
    it('stops active capture on backgrounding and rejects background requests', async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const listeners = new Set<() => void>();
        const fakeDocument = { visibilityState: 'visible', addEventListener: (_event: string, listener: () => void) => listeners.add(listener), removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener) };
        Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
        const stop = jest.fn();
        const getUserMedia = jest.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
        try {
            const controller = new BrowserCaptureController();
            await controller.request({ audio: true });
            fakeDocument.visibilityState = 'hidden';
            [...listeners].forEach((listener) => listener());
            expect(stop).toHaveBeenCalledTimes(1);
            await expect(controller.request({ video: true })).rejects.toThrow('unavailable');
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        } finally {
            if (original) Object.defineProperty(globalThis, 'document', original);
            else Reflect.deleteProperty(globalThis, 'document');
        }
    });
});
