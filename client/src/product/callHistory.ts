import type { CallSession } from '@chat-e2ee/service';
import type { Message } from '../types';
export type LocalCallEvent = { mode: 'audio' | 'video'; outcome: 'completed' | 'missed' | 'declined' | 'canceled' | 'failed'; direction: 'incoming' | 'outgoing'; durationSeconds?: number };
export const callEventLabel = (event: LocalCallEvent): string => {
  const kind = event.mode === 'video' ? 'Video call' : 'Voice call';
  return event.outcome === 'completed' ? kind : event.outcome === 'missed' ? `Missed ${kind.toLowerCase()}` : event.outcome === 'declined' ? 'Declined call' : event.outcome === 'canceled' ? 'Canceled call' : 'Failed call';
};
export const validLocalCallEvent = (value: unknown): value is LocalCallEvent => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return Object.keys(e).every(key => ['mode', 'outcome', 'direction', 'durationSeconds'].includes(key)) && ['audio', 'video'].includes(String(e.mode)) && ['completed', 'missed', 'declined', 'canceled', 'failed'].includes(String(e.outcome)) && ['incoming', 'outgoing'].includes(String(e.direction)) && (e.durationSeconds === undefined || Number.isSafeInteger(e.durationSeconds) && Number(e.durationSeconds) >= 0);
};
/** Local observations only; never emits a wire message or peer receipt. */
export class LocalCallHistory {
  private readonly calls = new Map<string, { direction: LocalCallEvent['direction']; connectedAt?: number; finished?: boolean; failed?: boolean }>();
  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}
  failed(id: string): void { const call = this.calls.get(id); if (call && !call.finished) call.failed = true; }
  connected(id: string): void { const call = this.calls.get(id); if (call && !call.finished) call.connectedAt ??= this.monotonicNow(); }
  observe(session: CallSession): Message | undefined {
    let call = this.calls.get(session.callId);
    if (!call) { call = { direction: session.state === 'ringing' ? 'incoming' : 'outgoing' }; this.calls.set(session.callId, call); }
    if (session.state === 'connected') this.connected(session.callId);
    if (!['ended', 'rejected', 'cancelled', 'expired', 'failed'].includes(session.state) || call.finished) return undefined;
    call.finished = true;
    const outcome: LocalCallEvent['outcome'] = session.state === 'rejected' ? 'declined' : session.state === 'failed' || call.failed ? 'failed' : call.connectedAt !== undefined ? 'completed' : call.direction === 'incoming' ? 'missed' : 'canceled';
    const event: LocalCallEvent = { mode: session.mediaMode, outcome, direction: call.direction, ...(call.connectedAt === undefined ? {} : { durationSeconds: Math.max(0, Math.floor((this.monotonicNow() - call.connectedAt) / 1000)) }) };
    if (this.calls.size > 2000) { const oldest = this.calls.keys().next().value; if (oldest) this.calls.delete(oldest); }
    return { id: `local-call:${session.callId}`, sender: 'local-call-history', type: 'received', text: callEventLabel(event), timestamp: new Date(session.updatedAt), callEvent: event };
  }
}
