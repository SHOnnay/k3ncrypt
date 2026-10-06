import type { CallEvent, CallSession } from './contracts';
import { transitionCall } from './stateMachine';
import type { CallRepository } from './repository';
export class CallEventProcessor {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(private readonly repository: CallRepository) {}
  process(callId: string, event: CallEvent, now = Date.now()): Promise<CallSession> {
    const previous = this.queues.get(callId) ?? Promise.resolve();
    const current = previous.then(async () => {
      const session = await this.repository.get(callId);
      if (!session) throw new Error('Unknown call.');
      const updated = transitionCall(session, event, now);
      await this.repository.save(updated);
      return updated;
    });
    const tail = current.then(() => undefined, () => undefined);
    this.queues.set(callId, tail);
    void tail.finally(() => { if (this.queues.get(callId) === tail) this.queues.delete(callId); }).catch(() => undefined);
    return current;
  }
}
