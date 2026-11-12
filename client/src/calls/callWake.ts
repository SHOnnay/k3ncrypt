/**
 * Calling a phone that may be closed. The caller asks the relay for a content-free wake-up; if the contact is not in the
 * room, the caller waits for their phone to wake, unlock and join before any invite is sent. A contact who is present is
 * never delayed, and nothing about the call leaves this device until the invite itself (which is end-to-end encrypted).
 */
export type WakePresence = 'present' | 'absent' | 'unknown';
export interface WakeConversation {
  requestCallWake(kind: 'ring' | 'cancel', wakeId: string): Promise<WakePresence>;
  waitForPeerJoin(timeoutMs: number): { promise: Promise<boolean>; cancel: () => void };
}
export const CALL_WAKE_WAIT_MS = 60_000;
/** The relay forgets a ring after this long, so a later cancel for it would be pointless. */
const RING_MEMORY_MS = 60_000;

type Attempt = { id: string; conversation: WakeConversation; phase: 'asking' | 'waiting' | 'invited'; waiter?: { cancel: () => void }; at: number };

export class CallWakeCoordinator {
  private attempt?: Attempt;
  constructor(private readonly newId: () => string = () => crypto.randomUUID(), private readonly now: () => number = Date.now, private readonly waitMs = CALL_WAKE_WAIT_MS) {}

  /**
   * 'invite': place the invite now. 'no-answer': the contact never appeared. 'cancelled': the person hung up while waiting.
   * `onWaiting` runs once if the call has to wait for the contact's phone.
   */
  async prepare(conversation: WakeConversation, onWaiting: () => void): Promise<'invite' | 'no-answer' | 'cancelled'> {
    const attempt: Attempt = { id: this.newId(), conversation, phase: 'asking', at: this.now() };
    this.attempt = attempt;
    const presence = await conversation.requestCallWake('ring', attempt.id).catch((): WakePresence => 'unknown');
    if (this.attempt !== attempt) return 'cancelled';
    if (presence === 'absent') {
      const waiter = conversation.waitForPeerJoin(this.waitMs);
      attempt.phase = 'waiting'; attempt.waiter = waiter;
      onWaiting();
      const joined = await waiter.promise;
      if (this.attempt !== attempt) return 'cancelled';
      if (!joined) {
        this.attempt = undefined;
        void conversation.requestCallWake('cancel', attempt.id).catch(() => undefined);
        return 'no-answer';
      }
    }
    attempt.phase = 'invited'; attempt.waiter = undefined;
    return 'invite';
  }

  /**
   * The person pressed cancel. 'stopped': no invite had been sent, so there is no call to cancel. 'invited': the normal call
   * cancellation must still run. 'idle': nothing was in progress. A phone that was asked to ring is told to stop.
   */
  cancel(): 'stopped' | 'invited' | 'idle' {
    const attempt = this.attempt;
    if (!attempt) return 'idle';
    this.attempt = undefined;
    attempt.waiter?.cancel();
    if (this.now() - attempt.at <= RING_MEMORY_MS) void attempt.conversation.requestCallWake('cancel', attempt.id).catch(() => undefined);
    return attempt.phase === 'invited' ? 'invited' : 'stopped';
  }

  /** The call connected or ended by other means: there is no ring left to cancel. */
  settle(): void { if (this.attempt?.phase === 'invited') this.attempt = undefined; }
  get waiting(): boolean { return this.attempt?.phase === 'asking' || this.attempt?.phase === 'waiting'; }
}
