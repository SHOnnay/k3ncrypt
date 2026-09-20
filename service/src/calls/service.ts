import type { CallParticipant, CallSession } from './contracts';
import { DEFAULT_CALL_SECURITY_POLICY, type CallSecurityPolicy } from './callSecurityPolicy';
import { CallAuthorization } from './authorization';
import { CallEventProcessor } from './eventProcessor';
import type { CallRepository } from './repository';
import { generateUUID } from '../utils/uuid';
export class CallService {
  private readonly events: CallEventProcessor;
  constructor(private readonly repository: CallRepository, private readonly authorization: CallAuthorization, private readonly policy: CallSecurityPolicy = DEFAULT_CALL_SECURITY_POLICY, private readonly now: () => number = Date.now) { this.events = new CallEventProcessor(repository); }
  async invite(conversationId: string, participants: readonly [CallParticipant, CallParticipant], identityBinding: string): Promise<CallSession> { if (participants.length !== this.policy.maxParticipants) throw new Error('Invalid call participants.'); const now = this.now(); const session: CallSession = { callId: generateUUID(), conversationId, participants, identityBinding, state: 'idle', createdAt: now, updatedAt: now, expiresAt: now + this.policy.invitationLifetimeMs }; await this.authorization.assertSession(session); await this.repository.save(session); return this.events.process(session.callId, 'invite', now); }
  get(callId: string): Promise<CallSession | undefined> { return this.repository.get(callId); }
  event(callId: string, event: Parameters<CallEventProcessor['process']>[1]): Promise<CallSession> { return this.events.process(callId, event, this.now()); }
}
