import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
const allowedStages = new Set([
  'peer-connection-create-start', 'peer-connection-created', 'peer-connection-create-failed', 'peer-connection-closed',
  'set-local-description-start', 'set-local-description-complete', 'set-local-description-failed',
  'set-remote-description-start', 'set-remote-description-complete', 'set-remote-description-failed',
  'ice-gathering-start', 'ice-gathering-complete', 'first-local-candidate', 'first-remote-candidate-received',
  'add-ice-candidate-succeeded', 'add-ice-candidate-failed', 'ice-checking-start', 'ice-connected',
  'ice-disconnected', 'ice-failure', 'candidate-pair-selected', 'candidate-pair-not-selected',
]);

export type IceHealthSnapshot = {
  peerState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  pageVisibility: 'visible' | 'hidden';
  selectedPair: 'active' | 'inactive' | 'unknown';
  consentRequestsSent: number | null;
  consentResponsesReceived: number | null;
  audioInboundPackets: number;
  audioInboundBytes: number;
  audioOutboundPackets: number;
  audioOutboundBytes: number;
};

/** Debug-only state and aggregate counters. It intentionally excludes candidate addresses and media payload. */
export const traceIceHealthSnapshot = (snapshot: IceHealthSnapshot): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined') return;
  const states = new Set(['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']);
  if (!states.has(snapshot.peerState) || !states.has(snapshot.iceState) || !new Set(['stable', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed']).has(snapshot.signalingState)) return;
  const counters = [snapshot.consentRequestsSent, snapshot.consentResponsesReceived, snapshot.audioInboundPackets, snapshot.audioInboundBytes, snapshot.audioOutboundPackets, snapshot.audioOutboundBytes];
  if (counters.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))) return;
  const root = document.documentElement;
  const startedAt = Number(root.dataset.k3ncryptIceTimingStart);
  if (!Number.isFinite(startedAt)) return;
  const rows = root.dataset.k3ncryptIceHealthTrace?.split('|').filter(Boolean) ?? [];
  if (rows.length >= 48) return;
  const elapsed = Math.max(0, performance.now() - startedAt).toFixed(0);
  rows.push(`${elapsed};page=${snapshot.pageVisibility};pc=${snapshot.peerState};ice=${snapshot.iceState};signal=${snapshot.signalingState};pair=${snapshot.selectedPair};consentSent=${snapshot.consentRequestsSent ?? 'na'};consentReplies=${snapshot.consentResponsesReceived ?? 'na'};audioInPackets=${snapshot.audioInboundPackets};audioInBytes=${snapshot.audioInboundBytes};audioOutPackets=${snapshot.audioOutboundPackets};audioOutBytes=${snapshot.audioOutboundBytes}`);
  root.dataset.k3ncryptIceHealthTrace = rows.join('|');
};

/** Debug-only elapsed timing for ICE investigation. Stores only fixed stage labels and elapsed time. */
export const beginIceTimingTrace = (): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined') return;
  document.documentElement.dataset.k3ncryptIceTimingStart = String(performance.now());
  document.documentElement.dataset.k3ncryptIceTimingTrace = '';
};

export const traceIceTiming = (stage: string): void => {
  if (!testDiagnosticsEnabled() || typeof document === 'undefined' || !allowedStages.has(stage)) return;
  const root = document.documentElement;
  const startedAt = Number(root.dataset.k3ncryptIceTimingStart);
  if (!Number.isFinite(startedAt)) return;
  const events = root.dataset.k3ncryptIceTimingTrace?.split(',').filter(Boolean) ?? [];
  if (events.length >= 160) return;
  events.push(`${stage}@${Math.max(0, performance.now() - startedAt).toFixed(1)}ms`);
  root.dataset.k3ncryptIceTimingTrace = events.join(',');
};
