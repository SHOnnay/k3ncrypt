import { CallWakeCoordinator, type WakeConversation, type WakePresence } from './callWake';

const conversation = (presence: WakePresence | Promise<WakePresence>) => {
  let finish: (joined: boolean) => void = () => undefined;
  const requests: [string, string][] = [];
  const cancelWait = jest.fn(() => finish(false));
  const value: WakeConversation = {
    requestCallWake: jest.fn(async (kind, id) => { requests.push([kind, id]); return kind === 'ring' ? presence : 'unknown'; }),
    waitForPeerJoin: jest.fn(() => ({ promise: new Promise<boolean>((resolve) => { finish = resolve; }), cancel: cancelWait })),
  };
  return { value, requests, cancelWait, peerJoins: () => finish(true), timesOut: () => finish(false) };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('call wake-up for a contact whose phone may be closed', () => {
  it('never delays a call to someone who is present, or when the relay cannot say', async () => {
    for (const presence of ['present', 'unknown'] as const) {
      const c = conversation(presence); const waiting = jest.fn();
      expect(await new CallWakeCoordinator(() => 'wake-1').prepare(c.value, waiting)).toBe('invite');
      expect(waiting).not.toHaveBeenCalled(); expect(c.value.waitForPeerJoin).not.toHaveBeenCalled();
      expect(c.requests).toEqual([['ring', 'wake-1']]);
    }
  });

  it('treats a failing wake request as unknown and still places the call', async () => {
    const c = conversation('present'); (c.value.requestCallWake as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    expect(await new CallWakeCoordinator(() => 'wake-1').prepare(c.value, jest.fn())).toBe('invite');
  });

  it('waits for an absent contact and sends the invite only after they join', async () => {
    const c = conversation('absent'); const waiting = jest.fn(); const coordinator = new CallWakeCoordinator(() => 'wake-1');
    let decision: string | undefined; void coordinator.prepare(c.value, waiting).then((value) => { decision = value; });
    await flush();
    expect(waiting).toHaveBeenCalledTimes(1); expect(decision).toBeUndefined(); expect(coordinator.waiting).toBe(true);
    c.peerJoins(); await flush();
    expect(decision).toBe('invite'); expect(coordinator.waiting).toBe(false);
    // The invite is out: cancelling now must still run the normal call cancel, and tells a ringing phone to stop.
    expect(coordinator.cancel()).toBe('invited');
    expect(c.requests).toEqual([['ring', 'wake-1'], ['cancel', 'wake-1']]);
  });

  it('gives up with "no answer" and withdraws the ring when the contact never appears', async () => {
    const c = conversation('absent'); const coordinator = new CallWakeCoordinator(() => 'wake-1');
    const pending = coordinator.prepare(c.value, jest.fn()); await flush(); c.timesOut();
    expect(await pending).toBe('no-answer');
    expect(c.requests).toEqual([['ring', 'wake-1'], ['cancel', 'wake-1']]);
    expect(coordinator.cancel()).toBe('idle');
  });

  it('cancelling while waiting sends no invite and withdraws the ring', async () => {
    const c = conversation('absent'); const coordinator = new CallWakeCoordinator(() => 'wake-1');
    const pending = coordinator.prepare(c.value, jest.fn()); await flush();
    expect(coordinator.cancel()).toBe('stopped');
    expect(await pending).toBe('cancelled'); expect(c.cancelWait).toHaveBeenCalledTimes(1);
    expect(c.requests).toEqual([['ring', 'wake-1'], ['cancel', 'wake-1']]);
  });

  it('cancelling while the relay is still answering stops the call before any invite', async () => {
    let answer: (value: WakePresence) => void = () => undefined;
    const c = conversation(new Promise<WakePresence>((resolve) => { answer = resolve; })); const coordinator = new CallWakeCoordinator(() => 'wake-1');
    const pending = coordinator.prepare(c.value, jest.fn()); await flush();
    expect(coordinator.cancel()).toBe('stopped');
    answer('present');
    expect(await pending).toBe('cancelled'); expect(c.value.waitForPeerJoin).not.toHaveBeenCalled();
  });

  it('a new call replaces an old attempt, a settled call has nothing to cancel, and an old ring is not cancelled late', async () => {
    const first = conversation('absent'), second = conversation('present'); let n = 0; let clock = 0;
    const coordinator = new CallWakeCoordinator(() => `wake-${++n}`, () => clock);
    const stale = coordinator.prepare(first.value, jest.fn()); await flush();
    expect(await coordinator.prepare(second.value, jest.fn())).toBe('invite');
    first.peerJoins(); expect(await stale).toBe('cancelled');
    coordinator.settle(); expect(coordinator.cancel()).toBe('idle');
    expect(await coordinator.prepare(second.value, jest.fn())).toBe('invite');
    clock = 61_000; expect(coordinator.cancel()).toBe('invited');
    expect(second.requests.filter(([kind]) => kind === 'cancel')).toEqual([]);
  });
});
