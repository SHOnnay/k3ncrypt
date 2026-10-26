import { useCallback, useEffect, useRef, useState } from 'react';
import { getRuntimeConfig } from '../../config/runtimeConfig';
export type ServiceReachability = 'unchecked' | 'checking' | 'reachable' | 'not-ready' | 'unavailable' | 'offline';
/** One bounded, read-only readiness check. No room, token, or identity is sent. Not socket or delivery evidence. */
export function useServiceReachability(enabled: boolean) {
  const [status, setStatus] = useState<ServiceReachability>('unchecked');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const check = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const current = ++generation.current;
      controller?.abort(); clearTimeout(deadline);
      if (!navigator.onLine) { setStatus('offline'); return; }
      controller = new AbortController();
      const signal = controller.signal;
      setStatus('checking');
      deadline = setTimeout(() => controller?.abort(), 5000);
      void fetch(`${getRuntimeConfig().baseUrl}/api/ready`, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
        .then(async response => {
          let ready = false;
          const reader = response.body?.getReader();
          if (response.status === 200 && response.headers.get('content-type')?.includes('application/json') && reader) {
            let length = 0; let text = ''; const decoder = new TextDecoder();
            try {
              while (true) {
                const part = await reader.read(); if (part.done) break;
                length += part.value.byteLength;
                if (length > 4096) break;
                text += decoder.decode(part.value, { stream: true });
              }
              if (length <= 4096) ready = JSON.parse(text + decoder.decode())?.status === 'ready';
            } finally { await reader.cancel(); reader.releaseLock(); }
          } else { await reader?.cancel(); reader?.releaseLock(); }
          if (generation.current === current) setStatus(ready ? 'reachable' : 'not-ready');
        }).catch(() => { if (generation.current === current) setStatus(navigator.onLine ? 'unavailable' : 'offline'); })
        .finally(() => { if (generation.current === current) clearTimeout(deadline); });
    };
    run();
    window.addEventListener('online', run); window.addEventListener('offline', run);
    return () => { ++generation.current; controller?.abort(); clearTimeout(deadline); window.removeEventListener('online', run); window.removeEventListener('offline', run); };
  }, [enabled, attempt]);
  return { status, check };
}
