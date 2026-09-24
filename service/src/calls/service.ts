import type { CallParticipant, CallSession } from './contracts';
import { DEFAULT_CALL_SECURITY_POLICY, type CallSecurityPolicy } from './callSecurityPolicy';
import { CallAuthorization } from './authorization';
import { CallEventProcessor } from './eventProcessor';
import type { CallRepository } from './repository';
import { generateUUID } from '../utils/uuid';
import type { CallMediaMode } from './contracts';
export class CallService {
  private readonly events: CallEventProcessor;
  constructor(private readonly repository: CallRepository, private readonly authorization: CallAuthorization, private readonly policy: CallSecurityPolicy = DEFAULT_CALL_SECURITY_POLICY, private readonly now: () => number = Date.now) { this.events = new CallEventProcessor(repository); }
  async invite(conversationId: string, participants: readonly [CallParticipant, CallParticipant], identityBinding: string, mediaMode: CallMediaMode = 'audio'): Promise<CallSession> { if (participants.length !== this.policy.maxParticipants) throw new Error('Invalid call participants.'); if (mediaMode !== 'audio' && mediaMode !== 'video') throw new Error('Invalid call media mode.'); const now = this.now(); const session: CallSession = { callId: generateUUID(), conversationId, participants, identityBinding, mediaMode, state: 'idle', createdAt: now, updatedAt: now, expiresAt: now + this.policy.invitationLifetimeMs }; await this.authorization.assertSession(session); await this.repository.save(session); return this.events.process(session.callId, 'invite', now); }
  async receiveInvite(session: CallSession): Promise<CallSession> { if (session.state !== 'inviting') throw new Error('Invalid incoming call.'); await this.authorization.assertSession(session); await this.repository.save(session); return this.events.process(session.callId, 'invite', this.now()); }
  get(callId: string): Promise<CallSession | undefined> { return this.repository.get(callId); }
  event(callId: string, event: Parameters<CallEventProcessor['process']>[1]): Promise<CallSession> { return this.events.process(callId, event, this.now()); }
}
