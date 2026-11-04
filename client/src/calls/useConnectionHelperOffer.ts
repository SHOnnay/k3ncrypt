import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { connectionStalled } from './connectionHelper';

/**
 * Calls milestone 3: when a call is stuck on "Connecting" (or its connection failed) with the connection helper
 * off, offer to turn it on and call again in one tap.
 */
export function useConnectionHelperOffer(): { offer: boolean; busy: boolean; turnOnAndRetry: () => Promise<void> } {
  const { callLifecycleState, callMediaMode, privacyPreferences, updatePrivacyPreferences, endCall, startCall, startVideoCall } = useChat();
  const [since, setSince] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSince(callLifecycleState === 'connecting' ? Date.now() : undefined); }, [callLifecycleState]);
  useEffect(() => {
    if (since === undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);
  const offer = connectionStalled(callLifecycleState, since ?? now, now, privacyPreferences.connectionHelper);
  const turnOnAndRetry = async () => {
    setBusy(true);
    try {
      updatePrivacyPreferences({ connectionHelper: true });
      const mode = callMediaMode;
      if (callLifecycleState === 'connecting') await endCall().catch(() => undefined);
      // The ended call clears a moment later; try a few times before giving up.
      for (let attempt = 0; attempt < 10; attempt++) {
        try { await (mode === 'video' ? startVideoCall() : startCall()); return; }
        catch (error) { if (!/already active|ringing/i.test(error instanceof Error ? error.message : '')) throw error; await new Promise((resolve) => setTimeout(resolve, 300)); }
      }
    } finally { setBusy(false); }
  };
  return { offer, busy, turnOnAndRetry };
}
