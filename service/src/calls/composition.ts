import type { CryptoSession, TransportManager } from '../core/contracts';
import { CallAuthorization } from './authorization';
import type { CallIdentityVerifier, CallParticipant, CallSession } from './contracts';
import { MemoryCallRepository } from './repository';
import { CallService } from './service';
import { AuthenticatedCallSignalTransport } from './authenticatedTransport';
import type { ReplayProtectionStore } from './replayProtection';
import { SecureCallSignaling } from './signaling';

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
}
export interface AuthenticatedCallComposition {
  readonly service: CallService;
  readonly signaling: SecureCallSignaling;
  readonly signalTransport: AuthenticatedCallSignalTransport;
  readonly repository: MemoryCallRepository;
  /** Starts a call only after the authenticated identity binding is derived. */
  readonly invite: () => Promise<CallSession>;
}

/** Sole composition point for calls: raw transports cannot satisfy this boundary. */
export const createAuthenticatedCallComposition = (input: AuthenticatedCallCompositionInput): AuthenticatedCallComposition => {
  if (!input.session.encrypted || !input.session.ready) throw new Error('Authenticated call session is not ready.');
  const signalTransport = new AuthenticatedCallSignalTransport(input.session, input.transport, input.conversationId, input.localIdentityId, input.remoteParticipant, input.identity);
  const signaling = new SecureCallSignaling(input.identity, signalTransport, input.replay);
  const repository = new MemoryCallRepository();
  const service = new CallService(repository, new CallAuthorization(input.identity));
  const invite = async (): Promise<CallSession> => {
    const participants: readonly [CallParticipant, CallParticipant] = [
      { participantId: input.localParticipantId ?? input.localIdentityId, identityId: input.localIdentityId, verification: 'verified' },
      input.remoteParticipant,
    ];
    const binding = await input.identity.identityBinding(input.conversationId, participants);
    return service.invite(input.conversationId, participants, binding);
  };
  return Object.freeze({ service, signaling, signalTransport, repository, invite });
};
