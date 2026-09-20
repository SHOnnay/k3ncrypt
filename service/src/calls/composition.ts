import type { CryptoSession, TransportManager } from '../core/contracts';
import { CallAuthorization } from './authorization';
import type { CallIdentityVerifier, CallParticipant } from './contracts';
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
  remoteParticipant: CallParticipant;
  identity: CallIdentityVerifier;
  replay?: ReplayProtectionStore;
}

/** Sole composition point for calls: raw transports cannot satisfy this boundary. */
export const createAuthenticatedCallComposition = (input: AuthenticatedCallCompositionInput) => {
  if (!input.session.encrypted || !input.session.ready) throw new Error('Authenticated call session is not ready.');
  const signalTransport = new AuthenticatedCallSignalTransport(input.session, input.transport, input.conversationId, input.localIdentityId, input.remoteParticipant, input.identity);
  const signaling = new SecureCallSignaling(input.identity, signalTransport, input.replay);
  const repository = new MemoryCallRepository();
  const service = new CallService(repository, new CallAuthorization(input.identity));
  return Object.freeze({ service, signaling, signalTransport, repository });
};
