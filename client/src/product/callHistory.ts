import type { CallSession } from '@chat-e2ee/service';
import type { Message } from '../types';
export type LocalCallEvent = { mode: 'audio' | 'video'; outcome: 'completed' | 'missed' | 'declined' | 'canceled' | 'failed'; direction: 'incoming' | 'outgoing'; durationSeconds?: number };
export const callEventLabel = (event: LocalCallEvent): string => {
  const kind = event.mode === 'video' ? 'Video call' : 'Voice call';
  return event.outcome === 'completed' ? kind : event.outcome === 'missed' ? `Missed ${kind.toLowerCase()}` : event.outcome === 'declined' ? 'Declined call' : event.outcome === 'canceled' ? 'Canceled call' : 'Failed call';
};
/** UX A7/A8: one-line row text. Shown from the stored event, so older saved history uses it too. */
export type CallRowTone = 'outgoing' | 'incoming' | 'missed' | 'declined' | 'failed';
export const formatCallDuration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const callRowSummary = (event: LocalCallEvent): { title: string; duration?: string; tone: CallRowTone } => {
  const kind = event.mode === 'video' ? 'video call' : 'voice call';
  const lead = event.outcome === 'missed' ? 'Missed' : event.outcome === 'declined' ? 'Declined' : event.outcome === 'canceled' ? 'Canceled'
    : event.outcome === 'failed' ? 'Failed' : event.direction === 'incoming' ? 'Incoming' : 'Outgoing';
  const tone: CallRowTone = event.outcome === 'missed' ? 'missed' : event.outcome === 'declined' ? 'declined' : event.outcome === 'failed' ? 'failed' : event.direction;
  return { title: `${lead} ${kind}`, duration: event.outcome === 'completed' && event.durationSeconds !== undefined ? formatCallDuration(event.durationSeconds) : undefined, tone };
};
export const validLocalCallEvent = (value: unknown): value is LocalCallEvent => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return Object.keys(e).every(key => ['mode', 'outcome', 'direction', 'durationSeconds'].includes(key)) && ['audio', 'video'].includes(String(e.mode)) && ['completed', 'missed', 'declined', 'canceled', 'failed'].includes(String(e.outcome)) && ['incoming', 'outgoing'].includes(String(e.direction)) && (e.durationSeconds === undefined || Number.isSafeInteger(e.durationSeconds) && Number(e.durationSeconds) >= 0);
};
/** Local observations only; never emits a wire message or peer receipt. */
export class LocalCallHistory {
  private readonly calls = new Map<string, { roomId: string; identityBinding: string; direction: LocalCallEvent['direction']; connectedAt?: number; finished?: boolean; failed?: boolean }>();
  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}
  failed(id: string): void { const call = this.calls.get(id); if (call && !call.finished) call.failed = true; }
  connected(id: string): void { const call = this.calls.get(id); if (call && !call.finished) call.connectedAt ??= this.monotonicNow(); }
  observe(session: CallSession): Message | undefined {
    const terminal = ['ended', 'rejected', 'cancelled', 'expired', 'failed'].includes(session.state);
    let call = this.calls.get(session.callId);
    // A terminal callback alone cannot establish a locally observed call or
    // move an existing observation to a different room or identity session.
    if (call && (call.roomId !== session.conversationId || call.identityBinding !== session.identityBinding)) return undefined;
    if (!call) {
      if (terminal) return undefined;
      call = { roomId: session.conversationId, identityBinding: session.identityBinding, direction: session.state === 'ringing' ? 'incoming' : 'outgoing' };
      this.calls.set(session.callId, call);
    }
    if (session.state === 'connected') this.connected(session.callId);
    if (!terminal || call.finished) return undefined;
    call.finished = true;
    const outcome: LocalCallEvent['outcome'] = session.state === 'rejected' ? 'declined' : session.state === 'failed' || call.failed ? 'failed' : call.connectedAt !== undefined ? 'completed' : call.direction === 'incoming' ? 'missed' : 'canceled';
    const event: LocalCallEvent = { mode: session.mediaMode, outcome, direction: call.direction, ...(call.connectedAt === undefined ? {} : { durationSeconds: Math.max(0, Math.floor((this.monotonicNow() - call.connectedAt) / 1000)) }) };
    if (this.calls.size > 2000) { const oldest = this.calls.keys().next().value; if (oldest) this.calls.delete(oldest); }
    return { id: `local-call:${session.callId}`, sender: 'local-call-history', type: 'received', text: callEventLabel(event), timestamp: new Date(session.updatedAt), callEvent: event };
  }
}

/** UX A8: one entry on the Calls page, read from a saved chat's local encrypted history. */
export interface CallHistoryEntry { id: string; roomId: string; name: string; timestamp: Date; event: LocalCallEvent; }
export const CALL_HISTORY_LIMIT = 200;
export const buildCallHistory = (rooms: readonly { roomId: string; name: string; messages: readonly Message[] }[]): CallHistoryEntry[] =>
  rooms.flatMap(({ roomId, name, messages }) => messages.flatMap((message) => message.callEvent && validLocalCallEvent(message.callEvent)
    ? [{ id: message.id, roomId, name, timestamp: message.timestamp, event: message.callEvent }] : []))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, CALL_HISTORY_LIMIT);
