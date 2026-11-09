import { createSoundPlayer, messageSound, ringbackSound, ringtoneSound, type SoundContext } from './sounds';

const fakeTimers = () => {
  const jobs = new Map<number, { fn: () => void; ms: number }>(); let next = 1;
  return {
    timers: { set: (fn: () => void, ms: number) => { jobs.set(next, { fn, ms }); return next++; }, clear: (h: unknown) => { jobs.delete(h as number); } },
    tick: () => { for (const job of [...jobs.values()]) job.fn(); },
    count: () => jobs.size,
  };
};
const fakeContext = () => {
  const oscillators: Array<{ freq?: number; start?: number; stop?: number }> = [];
  const close = jest.fn(async () => undefined);
  const context: SoundContext = {
    currentTime: 10, destination: {}, close,
    createGain: () => ({ connect: jest.fn(), disconnect: jest.fn(), gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() } }),
    createOscillator: () => { const record: { freq?: number; start?: number; stop?: number } = {}; oscillators.push(record); return { connect: jest.fn(), disconnect: jest.fn(), type: 'sine' as OscillatorType, frequency: { setValueAtTime: (v: number) => { record.freq = v; } }, start: (at: number) => { record.start = at; }, stop: (at: number) => { record.stop = at; } }; },
  };
  return { context, oscillators, close };
};

describe('N1 sounds [unit test]', () => {
  it('plays the message chime once with two notes and releases the audio context afterwards', () => {
    const { context, oscillators, close } = fakeContext(); const t = fakeTimers();
    const player = createSoundPlayer(() => context, t.timers);
    player.playOnce(messageSound);
    expect(oscillators.map((o) => o.freq)).toEqual([880, 1175]);
    expect(oscillators[0].start).toBeCloseTo(10); expect(oscillators[1].start).toBeCloseTo(10.14);
    t.tick(); expect(close).toHaveBeenCalledTimes(1); expect(t.count()).toBe(0);
  });
  it('ringback plays the 440+480 Hz pair and repeats until stopped', () => {
    const { context, oscillators, close } = fakeContext(); const t = fakeTimers();
    const player = createSoundPlayer(() => context, t.timers);
    player.startLoop(ringbackSound); player.startLoop(ringbackSound);
    expect(oscillators.map((o) => o.freq)).toEqual([440, 480]);
    expect(player.isLooping()).toBe(true);
    t.tick(); expect(oscillators).toHaveLength(4);
    player.stopLoop(); expect(player.isLooping()).toBe(false); expect(close).toHaveBeenCalledTimes(1); expect(t.count()).toBe(0);
  });
  it('ringtone schedules four notes per repeat', () => {
    const { context, oscillators } = fakeContext(); const player = createSoundPlayer(() => context, fakeTimers().timers);
    player.startLoop(ringtoneSound); expect(oscillators).toHaveLength(4); player.stopLoop();
  });
  it('does nothing, without throwing, when audio is unavailable or throws', () => {
    const t = fakeTimers();
    expect(() => createSoundPlayer(() => undefined, t.timers).playOnce(messageSound)).not.toThrow();
    const throwing = createSoundPlayer(() => { throw new Error('blocked'); }, t.timers);
    expect(() => { throwing.startLoop(ringtoneSound); throwing.playOnce(messageSound); }).not.toThrow();
    expect(throwing.isLooping()).toBe(false);
  });
  it('does not start a loop for a one-shot pattern', () => {
    const { context, oscillators } = fakeContext(); const player = createSoundPlayer(() => context, fakeTimers().timers);
    player.startLoop(messageSound); expect(oscillators).toHaveLength(0); expect(player.isLooping()).toBe(false);
  });
});
