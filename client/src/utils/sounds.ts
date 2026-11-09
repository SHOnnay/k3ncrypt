/**
 * N1 sounds. Self-made: every sound is synthesised from sine tones at run time, so there are no audio files
 * and no third-party licence. See docs/SOUNDS.md for the exact notes (the Android client plays the same spec).
 */
export interface SoundStep { readonly freqs: readonly number[]; readonly at: number; readonly duration: number; readonly gain: number; }
export interface SoundPattern { readonly steps: readonly SoundStep[]; /** Seconds from the start of one repeat to the next; omitted = play once. */ readonly period?: number; }

export const messageSound: SoundPattern = { steps: [
  { freqs: [880], at: 0, duration: 0.12, gain: 0.2 },
  { freqs: [1175], at: 0.14, duration: 0.18, gain: 0.2 },
] };
/** Incoming call: two rising notes, repeated every 3 s. */
export const ringtoneSound: SoundPattern = { period: 3, steps: [
  { freqs: [659], at: 0, duration: 0.35, gain: 0.16 },
  { freqs: [784], at: 0.45, duration: 0.35, gain: 0.16 },
  { freqs: [659], at: 1.0, duration: 0.35, gain: 0.16 },
  { freqs: [784], at: 1.45, duration: 0.35, gain: 0.16 },
] };
/** Caller hears 440 Hz + 480 Hz for 2 s, silent for 4 s (the standard ringback cadence). */
export const ringbackSound: SoundPattern = { period: 6, steps: [{ freqs: [440, 480], at: 0, duration: 2, gain: 0.1 }] };

interface Param { setValueAtTime(value: number, at: number): void; linearRampToValueAtTime?(value: number, at: number): void }
interface Osc { connect(target: unknown): void; disconnect(): void; start(at: number): void; stop(at: number): void; type: OscillatorType; frequency: Param }
interface GainNodeLike { connect(target: unknown): void; disconnect(): void; gain: Param }
export interface SoundContext { currentTime: number; destination: unknown; createOscillator(): Osc; createGain(): GainNodeLike; close?(): Promise<void> }

const stepsOf = (pattern: SoundPattern): number => pattern.steps.reduce((end, step) => Math.max(end, step.at + step.duration), 0);

/** Schedules one run of the pattern and returns when its last note ends (seconds). */
const schedule = (context: SoundContext, pattern: SoundPattern, offset = 0): void => {
  for (const step of pattern.steps) {
    const start = context.currentTime + offset + step.at;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime?.(step.gain, start + 0.02);
    gain.gain.setValueAtTime(step.gain, start + Math.max(0.02, step.duration - 0.04));
    gain.gain.linearRampToValueAtTime?.(0, start + step.duration);
    gain.connect(context.destination);
    for (const freq of step.freqs) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + step.duration);
    }
  }
};

type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setInterval(fn, ms), clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

/** Local audio only: never requests the microphone or camera. Failures are silent (a missing sound must not break chat). */
export const createSoundPlayer = (create: () => SoundContext | undefined, timers: Timers = realTimers) => {
  let context: SoundContext | undefined;
  let loop: unknown;
  let closeTimer: unknown;
  const ensure = (): SoundContext | undefined => { context ??= create(); return context; };
  const release = (): void => { void context?.close?.(); context = undefined; };
  const stopLoop = (): void => {
    if (loop !== undefined) { timers.clear(loop); loop = undefined; }
    if (closeTimer !== undefined) { timers.clear(closeTimer); closeTimer = undefined; }
    // Dropping the context silences anything already scheduled.
    release();
  };
  return {
    playOnce: (pattern: SoundPattern): void => {
      try {
        const ctx = ensure(); if (!ctx) return;
        schedule(ctx, pattern);
        if (loop === undefined) {
          if (closeTimer !== undefined) timers.clear(closeTimer);
          const opened = ctx;
          closeTimer = timers.set(() => {
            if (closeTimer !== undefined) { timers.clear(closeTimer); closeTimer = undefined; }
            if (context === opened && loop === undefined) release();
          }, Math.ceil(stepsOf(pattern) * 1000) + 300);
        }
      } catch { release(); }
    },
    startLoop: (pattern: SoundPattern): void => {
      if (loop !== undefined || !pattern.period) return;
      try {
        const ctx = ensure(); if (!ctx) return;
        schedule(ctx, pattern);
        loop = timers.set(() => { try { if (context) schedule(context, pattern); } catch { stopLoop(); } }, pattern.period * 1000);
      } catch { stopLoop(); }
    },
    stopLoop,
    isLooping: (): boolean => loop !== undefined,
  };
};

const browserContext = (): SoundContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? (new Context() as unknown as SoundContext) : undefined;
};

const messagePlayer = createSoundPlayer(browserContext);
const callPlayer = createSoundPlayer(browserContext);
export const playMessageSound = (): void => messagePlayer.playOnce(messageSound);
export const startIncomingRingtone = (): void => callPlayer.startLoop(ringtoneSound);
export const startRingback = (): void => callPlayer.startLoop(ringbackSound);
export const stopCallSounds = (): void => callPlayer.stopLoop();
