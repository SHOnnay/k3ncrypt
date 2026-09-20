import type { CryptoSession, TransportManager } from '../core/contracts';
import { CallAuthorization } from './authorization';
import type { CallEvent, CallIdentityVerifier, CallParticipant, CallSession, CallSignal, CallSignalKind } from './contracts';
import { MemoryCallRepository } from './repository';
import { CallService } from './service';
import { AuthenticatedCallSignalTransport } from './authenticatedTransport';
import type { ReplayProtectionStore } from './replayProtection';
import { SecureCallSignaling } from './signaling';
import { signalDigest } from './signalBinding';

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
  readonly invite: () => Promise<CallSession>;
  readonly accept: (callId: string) => Promise<CallSession>;
  readonly reject: (callId: string) => Promise<CallSession>;
  readonly cancel: (callId: string) => Promise<CallSession>;
  readonly onCallUpdate: (listener: (session: CallSession) => void) => () => void;
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
  const localParticipant: CallParticipant = {
    participantId: input.localParticipantId ?? input.localIdentityId,
    identityId: input.localIdentityId,
    verification: 'verified',
  };
  const sendEvent = async (session: CallSession, event: CallEvent, sequence: number, kind: CallSignalKind = 'control', payload?: unknown): Promise<void> => {
    await input.deviceTrust?.assertTrusted();
    if (event === 'heartbeat' || event === 'expire' || event === 'fail' || event === 'connect' || event === 'connected' || event === 'reconnect') {
      throw new Error('Unsupported call signal event.');
    }
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: session.callId,
      conversationId: session.conversationId,
      sender: localParticipant,
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
  const notify = (session: CallSession): void => { listeners.forEach((listener) => listener(session)); };
  const unsubscribeSignals = signaling.onSignal(async (signal) => {
    const existing = await repository.get(signal.callId);
    if (!existing) {
      if (signal.event !== 'invite' || signal.identityBinding !== await input.identity.identityBinding(input.conversationId, [localParticipant, input.remoteParticipant])) throw new Error('Unknown call.');
      const incoming: CallSession = {
        callId: signal.callId,
        conversationId: signal.conversationId,
        participants: [localParticipant, input.remoteParticipant],
        identityBinding: signal.identityBinding,
        state: 'inviting',
        createdAt: signal.timestamp,
        updatedAt: signal.timestamp,
        expiresAt: signal.expiresAt,
      };
      const received = await service.receiveInvite(incoming);
      notify(received);
      return;
    }
    if (signal.conversationId !== existing.conversationId || signal.identityBinding !== existing.identityBinding) throw new Error('Call signal binding rejected.');
    const updated = await service.event(signal.callId, signal.event);
    notify(updated);
  });
  const invite = async (): Promise<CallSession> => {
    await input.deviceTrust?.assertTrusted();
    const participants: readonly [CallParticipant, CallParticipant] = [
      localParticipant,
      input.remoteParticipant,
    ];
    const binding = await input.identity.identityBinding(input.conversationId, participants);
    const session = await service.invite(input.conversationId, participants, binding);
    await sendEvent(session, 'invite', 1);
    notify(session);
    return session;
  };
  const respond = async (callId: string, event: 'accept' | 'reject' | 'cancel'): Promise<CallSession> => {
    await input.deviceTrust?.assertTrusted();
    const session = await service.event(callId, event);
    await sendEvent(session, event, session.updatedAt === session.createdAt ? 1 : 2);
    notify(session);
    return session;
  };
  const onCallUpdate = (listener: (session: CallSession) => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  // Keep the transport listener alive for the lifetime of the composition.
  void unsubscribeSignals;
  return Object.freeze({ service, signaling, signalTransport, repository, invite, accept: (id: string) => respond(id, 'accept'), reject: (id: string) => respond(id, 'reject'), cancel: (id: string) => respond(id, 'cancel'), onCallUpdate });
};
