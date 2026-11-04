import { PendingSignals } from './pendingSignals';

// Calls milestone 2: a call signal that arrives before the call receiver is installed is kept briefly and
// replayed in order once it is, instead of being dropped (the caller then rang until expiry).
describe('pending call signals', () => {
  it('replays held signals in arrival order, once', async () => {
    const pending = new PendingSignals<string>();
    pending.hold('invite'); pending.hold('offer');
    const seen: string[] = [];
    await pending.drain(async (value) => { seen.push(value); });
    await pending.drain(async (value) => { seen.push(value); });
    expect(seen).toEqual(['invite', 'offer']);
  });

  it('drops signals older than the window and keeps at most the cap', async () => {
    let now = 0;
    const pending = new PendingSignals<number>(() => now, 30_000, 3);
    pending.hold(1); now = 10_000; for (const value of [2, 3, 4]) pending.hold(value);
    now = 35_000;
    const seen: number[] = [];
    await pending.drain(async (value) => { seen.push(value); });
    expect(seen).toEqual([2, 3, 4]);
  });

  it('keeps replaying after one signal is rejected', async () => {
    const pending = new PendingSignals<string>();
    pending.hold('bad'); pending.hold('good');
    const seen: string[] = [];
    await pending.drain(async (value) => { if (value === 'bad') throw new Error('rejected'); seen.push(value); });
    expect(seen).toEqual(['good']);
  });
});
