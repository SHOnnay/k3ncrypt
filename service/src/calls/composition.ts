import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import type { CryptoSession, TransportManager } from '../core/contracts';
import { CallAuthorization } from './authorization';
import type { CallEvent, CallIdentityVerifier, CallParticipant, CallSession, CallSignal, CallSignalKind } from './contracts';
import { MemoryCallRepository } from './repository';
import { CallService } from './service';
import { AuthenticatedCallSignalTransport } from './authenticatedTransport';
import type { ReplayProtectionStore } from './replayProtection';
import { SecureCallSignaling } from './signaling';
import { signalDigest } from './signalBinding';
import { generateUUID } from '../utils/uuid';

const TERMINAL_SIGNAL_WAIT_MS = 3_000;

const callSignalDiagnostic = (category: 'device-trust-rejected' | 'invite-binding-rejected' | 'session-binding-rejected' | 'media-listener-missing' | 'media-handler-rejected' | 'call-state-transition-rejected'): void => {
  if (testDiagnosticsEnabled()) console.info(`k3ncrypt-call-failure:${category}`);
};

export interface AuthenticatedCallCompositionInput {
  session: CryptoSession;
  transport: TransportManager;
  conversationId: string;
  localIdentityId: string;
  /** Routing participant id; kept separate from the verified identity id. */
  localParticipantId?: string;
  remoteParticipant: CallParticipant;
  identity: CallIdentityVerifier;
  replay?: ReplayProtectionStore;
  deviceTrust: { assertTrusted(): Promise<void> };
}
export interface AuthenticatedCallComposition {
  readonly service: CallService;
  readonly signaling: SecureCallSignaling;
  readonly signalTransport: AuthenticatedCallSignalTransport;
  readonly repository: MemoryCallRepository;
  /** Starts a call only after the authenticated identity binding is derived. */
  readonly assertVerifiedContact?: () => Promise<void>;
  readonly invite: (mediaMode?: 'audio' | 'video') => Promise<CallSession>;
  readonly accept: (callId: string) => Promise<CallSession>;
  readonly reject: (callId: string) => Promise<CallSession>;
  readonly cancel: (callId: string) => Promise<CallSession>;
  /** Ends an established call with the existing authenticated terminal event. */
  readonly end: (callId: string) => Promise<CallSession | undefined>;
  readonly onCallUpdate: (listener: (session: CallSession) => void) => () => void;
  readonly sendMediaSignal: (callId: string, event: 'connect' | 'connected' | 'reconnect', kind: Exclude<CallSignalKind, 'control'>, payload: unknown) => Promise<void>;
  readonly onMediaSignal: (listener: (session: CallSession, signal: CallSignal) => Promise<void>) => () => void;
}

/** Sole composition point for calls: raw transports cannot satisfy this boundary. */
export const createAuthenticatedCallComposition = (input: AuthenticatedCallCompositionInput): AuthenticatedCallComposition => {
  if (!input.session.encrypted || !input.session.ready) throw new Error('Authenticated call session is not ready.');
  if (!input.deviceTrust) throw new Error('Authenticated device trust is unavailable.');
  const signalTransport = new AuthenticatedCallSignalTransport(input.session, input.transport, input.conversationId, input.localIdentityId, input.remoteParticipant, input.identity);
  const signaling = new SecureCallSignaling(input.identity, signalTransport, input.replay);
  const repository = new MemoryCallRepository();
  const service = new CallService(repository, new CallAuthorization(input.identity));
  const listeners = new Set<(session: CallSession) => void>();
  const mediaListeners = new Set<(session: CallSession, signal: CallSignal) => Promise<void>>();
  const sequences = new Map<string, number>();
  const endings = new Map<string, Promise<CallSession | undefined>>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const localParticipant: CallParticipant = {
    participantId: input.localParticipantId ?? input.localIdentityId,
    identityId: input.localIdentityId,
    verification: 'verified',
  };
  const assertVerifiedContact = async (): Promise<void> => {
    await input.deviceTrust.assertTrusted();
    for (const participant of [localParticipant, input.remoteParticipant]) {
      if (!await input.identity.isParticipant(input.conversationId, participant.participantId) || await input.identity.getVerification(participant.participantId) !== 'verified') throw new Error('Verification required for calls.');
    }
  };
  const sendEvent = async (session: CallSession, event: CallEvent, sequence: number, kind: CallSignalKind = 'control', payload?: unknown): Promise<void> => {
    await assertVerifiedContact();
    if (event === 'heartbeat' || event === 'expire') {
      throw new Error('Unsupported call signal event.');
    }
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: session.callId,
      conversationId: session.conversationId,
      sender: localParticipant,
      receiverIdentityId: session.participants.find((item) => item.identityId !== localParticipant.identityId)?.identityId ?? '',
      mediaMode: session.mediaMode,
      nonce: generateUUID(),
      event,
      kind,
      payload,
      sequence,
      timestamp: Date.now(),
      expiresAt: session.expiresAt,
      identityBinding: session.identityBinding,
    };
    await signaling.send(session, { ...unsigned, payloadDigest: await signalDigest(unsigned) });
  };
  const clearExpiry = (callId: string): void => {
    const timer = expiryTimers.get(callId);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(callId);
  };
  const notify = (session: CallSession): void => {
    if (!['inviting', 'ringing'].includes(session.state)) clearExpiry(session.callId);
    listeners.forEach((listener) => listener(session));
  };
  const scheduleExpiry = (session: CallSession): void => {
    clearExpiry(session.callId);
    const timer = setTimeout(() => {
      void (async () => {
        const current = await service.get(session.callId);
        if (!current || !['inviting', 'ringing'].includes(current.state)) return;
        try {
          const expired = await service.event(session.callId, 'expire');
          notify(expired);
        } catch {
          // A concurrent accept/cancel may win the terminal transition.
        } finally {
          clearExpiry(session.callId);
        }
      })();
    }, Math.max(0, session.expiresAt - Date.now() + 1));
    // Browser timers return a number; Node timers expose unref(). Avoid keeping
    // test runners or short-lived service processes alive for an unanswered call.
    (timer as unknown as { unref?: () => void }).unref?.();
    expiryTimers.set(session.callId, timer);
  };
  const unsubscribeSignals = signaling.onSignal(async (signal) => {
    try { await assertVerifiedContact(); } catch { callSignalDiagnostic('device-trust-rejected'); throw new Error('Call device trust rejected.'); }
    const existing = await repository.get(signal.callId);
    if (!existing) {
      if (signal.event !== 'invite' || signal.receiverIdentityId !== localParticipant.identityId || signal.mediaMode !== 'audio' && signal.mediaMode !== 'video' || signal.identityBinding !== await input.identity.identityBinding(input.conversationId, [localParticipant, input.remoteParticipant])) { callSignalDiagnostic('invite-binding-rejected'); throw new Error('Unknown call.'); }
      const incoming: CallSession = {
        callId: signal.callId,
        conversationId: signal.conversationId,
        participants: [localParticipant, input.remoteParticipant],
        mediaMode: signal.mediaMode,
        identityBinding: signal.identityBinding,
        state: 'inviting',
        createdAt: signal.timestamp,
        updatedAt: signal.timestamp,
        expiresAt: signal.expiresAt,
      };
      const received = await service.receiveInvite(incoming);
      scheduleExpiry(received);
      notify(received);
      return;
    }
    if (signal.conversationId !== existing.conversationId || signal.identityBinding !== existing.identityBinding || signal.receiverIdentityId !== localParticipant.identityId || signal.mediaMode !== existing.mediaMode) { callSignalDiagnostic('session-binding-rejected'); throw new Error('Call signal binding rejected.'); }
    if (signal.kind && signal.kind !== 'control') {
      if (mediaListeners.size === 0) { callSignalDiagnostic('media-listener-missing'); throw new Error('Call media handler unavailable.'); }
      try { for (const listener of mediaListeners) await listener(existing, signal); } catch { callSignalDiagnostic('media-handler-rejected'); throw new Error('Call media handler rejected.'); }
      return;
    }
    let updated: CallSession;
    try { updated = await service.event(signal.callId, signal.event); } catch { callSignalDiagnostic('call-state-transition-rejected'); throw new Error('Call state transition rejected.'); }
    notify(updated);
  });
  const invite = async (mediaMode: 'audio' | 'video' = 'audio'): Promise<CallSession> => {
    await assertVerifiedContact();
    const participants: readonly [CallParticipant, CallParticipant] = [
      localParticipant,
      input.remoteParticipant,
    ];
    const binding = await input.identity.identityBinding(input.conversationId, participants);
    const session = await service.invite(input.conversationId, participants, binding, mediaMode);
    await sendEvent(session, 'invite', 1);
    sequences.set(session.callId, 1);
    scheduleExpiry(session);
    notify(session);
    return session;
  };
  const respond = async (callId: string, event: 'accept' | 'reject' | 'cancel'): Promise<CallSession> => {
    await assertVerifiedContact();
    const session = await service.event(callId, event);
    const sequence = (sequences.get(callId) ?? 0) + 1;
    sequences.set(callId, sequence);
    // Commit the local terminal state before waiting for a best-effort remote
    // cancellation delivery. A stalled relay must not leave the UI ringing.
    if (event === 'cancel') notify(session);
    await sendEvent(session, event, sequence);
    if (event !== 'cancel') notify(session);
    return session;
  };
  const end = (callId: string): Promise<CallSession | undefined> => {
    const ongoing = endings.get(callId);
    if (ongoing) return ongoing;
    const ending = (async (): Promise<CallSession | undefined> => {
      const current = await service.get(callId);
      if (!current || ['ended', 'rejected', 'cancelled', 'expired', 'failed'].includes(current.state)) return current;
      const event: 'end' | 'cancel' = ['connected', 'reconnecting'].includes(current.state) ? 'end' : 'cancel';
      const updated = await service.event(callId, event);
      const sequence = (sequences.get(callId) ?? 0) + 1;
      sequences.set(callId, sequence);
      // Update local state immediately, but keep the authenticated call context
      // alive until the existing terminal signal has been attempted.
      notify(updated);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          sendEvent(current, event, sequence),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, TERMINAL_SIGNAL_WAIT_MS); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      return updated;
    })();
    endings.set(callId, ending);
    void ending.finally(() => { if (endings.get(callId) === ending) endings.delete(callId); }).catch(() => undefined);
    return ending;
  };
  const onCallUpdate = (listener: (session: CallSession) => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  const sendMediaSignal = async (callId: string, event: 'connect' | 'connected' | 'reconnect', kind: Exclude<CallSignalKind, 'control'>, payload: unknown): Promise<void> => {
    const session = await repository.get(callId); if (!session) throw new Error('Unknown call.');
    const sequence = (sequences.get(callId) ?? 1) + 1; sequences.set(callId, sequence);
    await sendEvent(session, event, sequence, kind, payload);
  };
  const onMediaSignal = (listener: (session: CallSession, signal: CallSignal) => Promise<void>): (() => void) => { mediaListeners.add(listener); return () => mediaListeners.delete(listener); };
  // Keep the transport listener alive for the lifetime of the composition.
  void unsubscribeSignals;
  return Object.freeze({ assertVerifiedContact, service, signaling, signalTransport, repository, invite, accept: (id: string) => respond(id, 'accept'), reject: (id: string) => respond(id, 'reject'), cancel: (id: string) => respond(id, 'cancel'), end, onCallUpdate, sendMediaSignal, onMediaSignal });
};
