import { callFailureCode, lastCallFailure, recordCallFailure } from './callFailureCode';

// Part A2 bug 6: a first video call failed with the generic "Call media is unavailable" and didn't reproduce
// locally. Each setup failure now records which path it took, as a fixed code with no device details.
describe('call setup failure codes', () => {
  it('maps each known failure path to a fixed code', () => {
    expect(callFailureCode(new Error('Call media cannot start before the required call state.'))).toBe('CALL_STATE_NOT_READY');
    expect(callFailureCode(new Error('Call media is not prepared.'))).toBe('CALL_MEDIA_NOT_PREPARED');
    expect(callFailureCode(new Error('Authenticated call media is not ready.'))).toBe('CALL_SUPPORT_NOT_READY');
    expect(callFailureCode(new Error('Call media request was cancelled.'))).toBe('CALL_CAPTURE_CANCELLED');
    expect(callFailureCode(new Error('The camera or microphone is in use by another app.'))).toBe('CALL_DEVICE_BUSY');
    expect(callFailureCode(new Error('Camera or microphone permission was denied or dismissed. Allow both permissions and try again.'))).toBe('CALL_PERMISSION');
    expect(callFailureCode(new Error('Call media is unavailable. Check the device and page permissions, then retry.'))).toBe('CALL_CAPTURE_UNAVAILABLE');
    expect(callFailureCode(new Error('WebRTC offer rejected.'))).toBe('CALL_OFFER_REJECTED');
    expect(callFailureCode(Object.assign(new Error('x'), { name: 'InvalidAccessError' }))).toBe('CALL_OTHER_InvalidAccessError');
    expect(callFailureCode('not an error')).toBe('CALL_OTHER');
  });

  it('keeps the last failure with its stage', () => {
    recordCallFailure('caller-offer', new Error('Call media is not prepared.'));
    expect(lastCallFailure()).toMatchObject({ stage: 'caller-offer', code: 'CALL_MEDIA_NOT_PREPARED' });
  });
});
