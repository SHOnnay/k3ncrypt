import { createRingtoneController } from './ringtone';

describe('ringtone lifecycle', () => {
  it('starts once and releases audio resources when stopped', () => {
    const oscillator = { connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn(), type: 'sine' as OscillatorType, frequency: { setValueAtTime: jest.fn() } };
    const gain = { connect: jest.fn(), disconnect: jest.fn(), gain: { setValueAtTime: jest.fn() } };
    const close = jest.fn(); const ringtone = createRingtoneController(() => ({ currentTime: 0, destination: {}, createOscillator: () => oscillator, createGain: () => gain, close }));
    ringtone.start(); ringtone.start(); expect(oscillator.start).toHaveBeenCalledTimes(1); ringtone.stop(); expect(oscillator.stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
});
