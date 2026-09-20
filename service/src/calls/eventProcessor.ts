import type { CallEvent, CallSession } from './contracts';
import { transitionCall } from './stateMachine';
import type { CallRepository } from './repository';
export class CallEventProcessor {
  constructor(private readonly repository: CallRepository) {}
  async process(callId: string, event: CallEvent, now = Date.now()): Promise<CallSession> { const session = await this.repository.get(callId); if (!session) throw new Error('Unknown call.'); const updated = transitionCall(session, event, now); await this.repository.save(updated); return updated; }
}
