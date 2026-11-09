import { WakeDispatcher, classifyWakeFailure, type WakeRegistrationStore, type WakeProvider } from './wakeDispatcher';
import { wakePayload, type PushRow } from './privateWake';
import type { DeviceLifecycleRecord } from '../security/deviceTrust';

const start = 1_800_000_000_000;
const row = (id = 'synthetic-hash'): PushRow => ({ _id: id, token: 'synthetic-token', accountIdentityReference: 'synthetic-account', deviceId: 'synthetic-device', deviceIdentityReference: 'synthetic-identity', trustEpoch: 1, updatedAt: new Date(start) });
const record = (): DeviceLifecycleRecord => ({ accountIdentityReference: 'synthetic-account', deviceId: 'synthetic-device', deviceIdentityReference: 'synthetic-identity', verificationKeyReference: 'synthetic-key', trustEpoch: 1, state: 'active', createdAt: start, lastTrustUpdate: start });
const harness = (provider: WakeProvider = jest.fn(async () => {})) => {
  let clock = start; let enabled = true;
  const store: WakeRegistrationStore = {
    isCurrent: jest.fn(async () => true), removeObserved: jest.fn(async () => true), readActive: jest.fn(async () => record()),
  };
  const pause = jest.fn(async (millis: number) => { clock += millis; });
  const dispatcher = new WakeDispatcher(store, provider, () => enabled, wakePayload, () => clock, pause);
  return { dispatcher, store, provider, pause, advance: (millis: number) => { clock += millis; }, disable: () => { enabled = false; } };
};
const failure = (code: string) => Object.assign(new Error('synthetic private error; never exported'), { code });

afterEach(() => { jest.useRealTimers(); });

test('disabled performs no storage/provider work', async () => {
  const h = harness(); h.disable(); expect(await h.dispatcher.dispatch(row())).toBe('disabled');
  expect(h.store.isCurrent).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled();
});
test('accepted provider send is throttled, but is not a device-delivery acknowledgement', async () => {
  const h = harness(); expect(await h.dispatcher.dispatch(row())).toBe('accepted');
  expect(await h.dispatcher.dispatch(row())).toBe('throttled'); expect(h.provider).toHaveBeenCalledTimes(1);
  const data = (h.provider as jest.Mock).mock.calls[0][1];
  expect(Object.keys(data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
  expect(JSON.stringify(data)).not.toMatch(/token|synthetic|room|identity|sender|key/i);
  h.advance(30_000); expect(await h.dispatcher.dispatch(row())).toBe('accepted');
});
test('failed attempts never install a successful-send throttle', async () => {
  const provider = jest.fn().mockRejectedValueOnce(failure('messaging/invalid-argument')).mockResolvedValue(undefined);
  const h = harness(provider); expect(await h.dispatcher.dispatch(row())).toBe('failed');
  expect(await h.dispatcher.dispatch(row())).toBe('accepted'); expect(provider).toHaveBeenCalledTimes(2);
  expect(h.store.removeObserved).not.toHaveBeenCalled();
});
test('transient retries reuse one wake event, reduce TTL, and stop after three attempts', async () => {
  const provider = jest.fn().mockRejectedValue(failure('messaging/server-unavailable'));
  const h = harness(provider); expect(await h.dispatcher.dispatch(row())).toBe('failed');
  expect(provider).toHaveBeenCalledTimes(3); expect(h.pause.mock.calls).toEqual([[250], [500]]);
  expect(new Set(provider.mock.calls.map((call) => call[1].eventId)).size).toBe(1);
  expect(provider.mock.calls.map((call) => call[2])).toEqual([60_000, 59_750, 59_250]);
  expect(h.dispatcher.snapshot()).toMatchObject({ attempted: 3, failed: 1, accepted: 0 });
});
test('a transient failure followed by success records only observed provider acceptance', async () => {
  const provider = jest.fn().mockRejectedValueOnce(failure('messaging/internal-error')).mockResolvedValue(undefined);
  const h = harness(provider); expect(await h.dispatcher.dispatch(row())).toBe('accepted');
  expect(h.dispatcher.snapshot()).toMatchObject({ attempted: 2, accepted: 1, failed: 0 });
});
test.each(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'])('only definitive token error %s retires exactly observed registration', async (code) => {
  const h = harness(jest.fn(async () => { throw failure(code); }));
  expect(await h.dispatcher.dispatch(row())).toBe('rejected');
  expect(h.store.removeObserved).toHaveBeenCalledWith(row()); expect(h.dispatcher.snapshot().retired).toBe(1);
});
test.each(['messaging/invalid-argument', 'messaging/mismatched-credential', 'messaging/authentication-error', 'unknown'])('configuration/payload/unknown error %s never deletes tokens', async (code) => {
  const h = harness(jest.fn(async () => { throw failure(code); }));
  expect(await h.dispatcher.dispatch(row())).toBe('failed'); expect(h.provider).toHaveBeenCalledTimes(1);
  expect(h.store.removeObserved).not.toHaveBeenCalled();
});
test('quota errors do not cause rapid retries or token deletion', async () => {
  const h = harness(jest.fn(async () => { throw failure('messaging/quota-exceeded'); }));
  expect(await h.dispatcher.dispatch(row())).toBe('failed'); expect(h.provider).toHaveBeenCalledTimes(1);
  expect(h.pause).not.toHaveBeenCalled(); expect(h.store.removeObserved).not.toHaveBeenCalled();
});
test('timeout is bounded, never retires token, and retains slot until uncancelable send settles', async () => {
  jest.useFakeTimers(); let finish!: () => void;
  const provider = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const h = harness(provider); const work = h.dispatcher.dispatch(row());
  await jest.advanceTimersByTimeAsync(5_000);
  expect(await work).toBe('timeout'); expect(await h.dispatcher.dispatch(row())).toBe('coalesced');
  expect(h.store.removeObserved).not.toHaveBeenCalled(); expect(h.dispatcher.snapshot()).toMatchObject({ attempted: 1, failed: 1, timedOut: 1 });
  finish(); await jest.advanceTimersByTimeAsync(0);
  provider.mockImplementation(async () => {});
  expect(await h.dispatcher.dispatch(row())).toBe('accepted');
  expect(jest.getTimerCount()).toBe(0);
});
test('outage cannot accumulate more than 32 unresolved provider requests', async () => {
  jest.useFakeTimers(); const h = harness(jest.fn(() => new Promise<void>(() => {})));
  const requests = Array.from({ length: 32 }, (_, i) => h.dispatcher.dispatch(row(String(i))));
  await jest.advanceTimersByTimeAsync(5_000); await Promise.all(requests);
  expect(await h.dispatcher.dispatch(row('overflow'))).toBe('busy'); expect(h.provider).toHaveBeenCalledTimes(32);
  expect(jest.getTimerCount()).toBe(0);
});
test('concurrent requests coalesce before authorization/provider awaits', async () => {
  const h = harness(); const results = await Promise.all(Array.from({ length: 10 }, () => h.dispatcher.dispatch(row())));
  expect(results.filter((value) => value === 'accepted')).toHaveLength(1); expect(h.provider).toHaveBeenCalledTimes(1);
});
test('revocation/epoch changes before retry prevent another send and conditionally retire old row', async () => {
  const h = harness(jest.fn(async () => { throw failure('messaging/server-unavailable'); }));
  (h.store.readActive as jest.Mock).mockResolvedValueOnce(record()).mockResolvedValue({ ...record(), trustEpoch: 2 });
  expect(await h.dispatcher.dispatch(row())).toBe('rejected'); expect(h.provider).toHaveBeenCalledTimes(1);
  expect(h.store.removeObserved).toHaveBeenCalledWith(row());
});
test('rotation before send or during provider failure cannot remove the replacement', async () => {
  const h = harness(); (h.store.isCurrent as jest.Mock).mockResolvedValue(false);
  expect(await h.dispatcher.dispatch(row())).toBe('rejected'); expect(h.provider).not.toHaveBeenCalled();
  const rotated = harness(jest.fn(async () => { throw failure('messaging/registration-token-not-registered'); }));
  (rotated.store.removeObserved as jest.Mock).mockResolvedValue(false);
  expect(await rotated.dispatcher.dispatch(row())).toBe('rejected'); expect(rotated.dispatcher.snapshot().retired).toBe(0);
});
test('ambiguous storage failure never retires registration or invokes provider', async () => {
  const h = harness(); (h.store.readActive as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  expect(await h.dispatcher.dispatch(row())).toBe('failed'); expect(h.store.removeObserved).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled();
});
test('expiry during authorization or backoff prevents provider work', async () => {
  const h = harness(); (h.store.readActive as jest.Mock).mockImplementation(async () => { h.advance(60_001); return record(); });
  expect(await h.dispatcher.dispatch(row())).toBe('expired'); expect(h.provider).not.toHaveBeenCalled();
  const retry = harness(jest.fn(async () => { retry.advance(60_001); throw failure('messaging/server-unavailable'); }));
  expect(await retry.dispatcher.dispatch(row())).toBe('expired'); expect(retry.provider).toHaveBeenCalledTimes(1);
});
test('disable during authorization prevents provider invocation', async () => {
  const h = harness(); (h.store.readActive as jest.Mock).mockImplementation(async () => { h.disable(); return record(); });
  expect(await h.dispatcher.dispatch(row())).toBe('disabled'); expect(h.provider).not.toHaveBeenCalled();
});
test('classification and counters export no provider details, registration or participant metadata', async () => {
  expect(classifyWakeFailure({ code: 'messaging/invalid-argument' })).toBe('permanent');
  const h = harness(); await h.dispatcher.dispatch(row()); const snapshot = h.dispatcher.snapshot();
  expect(Object.values(snapshot).every(Number.isSafeInteger)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toMatch(/token|identity|device|synthetic|room|account|error/i);
  (snapshot as { accepted: number }).accepted = 999; expect(h.dispatcher.snapshot().accepted).toBe(1);
});
test('a fresh dispatcher does not pretend process-local retries/throttles survived restart', async () => {
  const h = harness(); await h.dispatcher.dispatch(row());
  const restarted = harness(); expect(restarted.dispatcher.snapshot().attempted).toBe(0);
  expect(await restarted.dispatcher.dispatch(row())).toBe('accepted');
});
