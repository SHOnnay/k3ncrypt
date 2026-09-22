type Tone = { connect(target: unknown): void; disconnect(): void; start(): void; stop(): void; type: OscillatorType; frequency: { setValueAtTime(value: number, at: number): void } };
type Gain = { connect(target: unknown): void; disconnect(): void; gain: { setValueAtTime(value: number, at: number): void } };
type ToneContext = { currentTime: number; destination: unknown; createOscillator(): Tone; createGain(): Gain; close?(): Promise<void> };

/** Local audio-only lifecycle. It never requests microphone or camera access. */
export const createRingtoneController = (create: () => ToneContext | undefined) => {
  let context: ToneContext | undefined; let oscillator: Tone | undefined; let gain: Gain | undefined;
  const stop = (): void => { try { oscillator?.stop(); } catch { /* already stopped */ } oscillator?.disconnect(); gain?.disconnect(); void context?.close?.(); oscillator = undefined; gain = undefined; context = undefined; };
  return {
    start: (): void => { if (oscillator) return; try { context = create(); if (!context) return; gain = context.createGain(); oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, context.currentTime); gain.gain.setValueAtTime(0.08, context.currentTime); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); } catch { stop(); } },
    stop,
  };
};

const defaultController = createRingtoneController(() => {
  if (typeof window === 'undefined') return undefined;
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context() : undefined;
});
export const startRingtone = defaultController.start;
export const stopRingtone = defaultController.stop;
