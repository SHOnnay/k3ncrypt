import { LocalCallHistory, validLocalCallEvent } from './callHistory';
import type { CallSession } from '@chat-e2ee/service';
const session = (state: CallSession['state'], id = 'call-1'): CallSession => ({ callId: id, conversationId: 'room', participants: [{ participantId: 'a', identityId: 'a', verification: 'verified' }, { participantId: 'b', identityId: 'b', verification: 'verified' }], mediaMode: 'video', state, createdAt: 1, updatedAt: 1000, expiresAt: 2000, identityBinding: 'binding', protocolVersion: 2 });
it('records local connected duration once, and distinguishes missed, declined and failed outcomes', () => {
  let time = 0; const history = new LocalCallHistory(() => time);
  history.observe(session('ringing')); history.connected('call-1'); time = 198000;
  const done = history.observe(session('ended'))!; expect(done.text).toBe('Video call'); expect(done.callEvent?.durationSeconds).toBe(198);
  expect(history.observe(session('ended'))).toBeUndefined();
  history.observe(session('ringing', 'missed')); expect(history.observe(session('cancelled', 'missed'))?.text).toBe('Missed video call');
  history.observe(session('inviting', 'cancel')); expect(history.observe(session('cancelled', 'cancel'))?.text).toBe('Canceled call');
  expect(history.observe(session('rejected', 'reject'))?.text).toBe('Declined call');
  expect(history.observe(session('failed', 'fail'))?.text).toBe('Failed call');
  expect(validLocalCallEvent(done.callEvent)).toBe(true);
  expect(validLocalCallEvent({ ...done.callEvent, durationSeconds: -1 })).toBe(false);
});
