import { LocalCallHistory, validLocalCallEvent } from './callHistory';
import type { CallSession } from '@chat-e2ee/service';
import { BrowserSecureStorage } from '../../../service/src/storage/secureVault';
import { MemoryVaultPersistence } from '../../../service/src/storage/persistence';
import { readMessages, writeMessages } from './messageStore';
const session = (state: CallSession['state'], id = 'call-1'): CallSession => ({ callId: id, conversationId: 'room', participants: [{ participantId: 'a', identityId: 'a', verification: 'verified' }, { participantId: 'b', identityId: 'b', verification: 'verified' }], mediaMode: 'video', state, createdAt: 1, updatedAt: 1000, expiresAt: 2000, identityBinding: 'binding', protocolVersion: 2 });
it('records local connected duration once, and distinguishes missed, declined and failed outcomes', () => {
  let time = 0; const history = new LocalCallHistory(() => time);
  history.observe(session('ringing')); history.connected('call-1'); time = 198000;
  const done = history.observe(session('ended'))!; expect(done.text).toBe('Video call'); expect(done.callEvent?.durationSeconds).toBe(198);
  expect(history.observe(session('ended'))).toBeUndefined();
  history.observe(session('ringing', 'missed')); expect(history.observe(session('cancelled', 'missed'))?.text).toBe('Missed video call');
  history.observe(session('inviting', 'cancel')); expect(history.observe(session('cancelled', 'cancel'))?.text).toBe('Canceled call');
  history.observe(session('ringing', 'reject')); expect(history.observe(session('rejected', 'reject'))?.text).toBe('Declined call');
  history.observe(session('inviting', 'fail')); expect(history.observe(session('failed', 'fail'))?.text).toBe('Failed call');
  expect(validLocalCallEvent(done.callEvent)).toBe(true);
  expect(validLocalCallEvent({ ...done.callEvent, durationSeconds: -1 })).toBe(false);
});

it('records a late end only for its observed room and identity binding, once, independently of another active call', () => {
  const history = new LocalCallHistory(() => 1000);
  history.observe(session('ringing'));
  history.connected('call-1');
  const other = { ...session('inviting', 'call-2'), conversationId: 'other-room', identityBinding: 'other-binding' };
  history.observe(other);
  expect(history.observe({ ...session('ended'), conversationId: 'other-room' })).toBeUndefined();
  expect(history.observe({ ...session('ended'), identityBinding: 'replaced-binding' })).toBeUndefined();
  expect(history.observe(session('ended', 'unobserved'))).toBeUndefined();
  const completed = history.observe(session('ended'));
  expect(completed?.callEvent).toMatchObject({ outcome: 'completed', direction: 'incoming' });
  expect(history.observe(session('ended'))).toBeUndefined();
  expect(history.observe(session('failed'))).toBeUndefined();
  expect(history.observe({ ...other, state: 'cancelled' })?.callEvent).toMatchObject({ outcome: 'canceled', direction: 'outgoing' });
});

it.each(['inviting', 'ringing'] as const)('never labels an unconnected %s call as completed', state => {
  const history = new LocalCallHistory();
  history.observe(session(state));
  expect(history.observe(session('ended'))?.callEvent?.outcome).toBe(state === 'ringing' ? 'missed' : 'canceled');
});

it('deduplicates encrypted room history, restores it after vault restart, and isolates another identity', async () => {
  const persistence = new MemoryVaultPersistence();
  const vault = new BrowserSecureStorage(persistence);
  const passphrase = 'disposable-call-history-test-only';
  await vault.initializeWithPassphrase(passphrase);
  const history = new LocalCallHistory(() => 1000);
  history.observe(session('ringing')); history.connected('call-1');
  const event = history.observe(session('ended'))!;
  await Promise.all([writeMessages(vault, 'room', [event]), writeMessages(vault, 'room', [event])]);
  expect(await readMessages(vault, 'room')).toEqual([event]);
  expect(await readMessages(vault, 'other-room')).toEqual([]);
  expect(persistence.inspectRecord('product-messages:room')).not.toContain('Video call');
  vault.lock();
  await expect(readMessages(vault, 'room')).rejects.toThrow('locked');
  const restarted = new BrowserSecureStorage(persistence);
  await restarted.unlock(passphrase);
  expect(await readMessages(restarted, 'room')).toEqual([event]);
  const otherIdentity = new BrowserSecureStorage(new MemoryVaultPersistence());
  await otherIdentity.initializeWithPassphrase(passphrase);
  expect(await readMessages(otherIdentity, 'room')).toEqual([]);
  restarted.lock(); otherIdentity.lock();
});
