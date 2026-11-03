import { useEffect, useRef, useState, type RefObject } from 'react';
import { createQrDecoder, type QrDecoder } from './qrDecoder';

const FRAME_INTERVAL_MS = 150;

/** One camera frame, copied into a canvas sized from that frame, decoded; undefined until a code is read. */
const readFrame = async (element: HTMLVideoElement, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, decoder: QrDecoder): Promise<string | undefined> => {
  if (element.videoWidth === 0 || element.videoHeight === 0) return undefined;
  canvas.width = element.videoWidth; canvas.height = element.videoHeight;
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return decoder.decode({ data: image.data, width: image.width, height: image.height }).catch(() => undefined);
};

/**
 * UX A13: camera QR scanning shared by the check and invitation scanners. Each frame is copied into a canvas
 * sized from that frame (never a stale size), decoded with the built-in detector or zbar, and the first
 * decoded text is handed to onText (which may ask to keep scanning). onTimeout fires once if nothing is read
 * within timeoutMs.
 */
export const useQrCameraScan = (options: {
  active: boolean; video: RefObject<HTMLVideoElement>; /** Return 'continue' to keep scanning after this text. */ onText: (text: string) => void | 'continue'; onError: () => void; onTimeout?: () => void; timeoutMs?: number;
}): { timedOut: boolean } => {
  const { active, video, timeoutMs = 15_000 } = options;
  const callbacks = useRef(options); callbacks.current = options;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (!active) return undefined;
    let cancelled = false; let stream: MediaStream | undefined; let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => { if (!cancelled) { setTimedOut(true); callbacks.current.onTimeout?.(); } }, timeoutMs);
    void (async () => {
      try {
        const { default: zbarWasmUrl } = await import('@undecaf/zbar-wasm/dist/zbar.wasm?url');
        const decoder = await createQrDecoder({ ...(globalThis as object), zbarWasmUrl });
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
        const element = video.current;
        if (cancelled || !element) { stream.getTracks().forEach((track) => track.stop()); return; }
        element.srcObject = stream; await element.play().catch(() => undefined);
        const canvas = document.createElement('canvas'); const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable.');
        const tick = async (): Promise<void> => {
          if (cancelled) return;
          const text = await readFrame(element, canvas, context, decoder);
          if (cancelled) return;
          if (text && callbacks.current.onText(text) !== 'continue') return;
          frameTimer = setTimeout(() => { void tick(); }, FRAME_INTERVAL_MS);
        };
        void tick();
      } catch { if (!cancelled) callbacks.current.onError(); }
    })();
    return () => {
      cancelled = true; clearTimeout(timeout); if (frameTimer) clearTimeout(frameTimer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [active, video, timeoutMs]);
  return { timedOut };
};
