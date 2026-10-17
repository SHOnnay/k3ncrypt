import { conversationRowOpenStatus, emptyStateOpenStatus } from './conversationOpenCopy';

describe('conversation open status copy', () => {
  it('claims opening only for the room actually being opened', () => {
    expect(conversationRowOpenStatus('a', { pending: { roomId: 'a' } })).toBe('Opening…');
    expect(conversationRowOpenStatus('b', { pending: { roomId: 'a' } })).toBeUndefined();
    expect(conversationRowOpenStatus('a', {})).toBeUndefined();
  });
  it('distinguishes an unreachable/waking server from other failures without exposing codes', () => {
    expect(conversationRowOpenStatus('a', { error: { roomId: 'a', code: 'NETWORK_FAILURE' } })).toContain('reach the server');
    expect(conversationRowOpenStatus('a', { error: { roomId: 'a', code: 'SERVICE_NOT_READY' } })).toContain('reach the server');
    expect(conversationRowOpenStatus('a', { error: { roomId: 'a', code: 'ROOM_MEMBERSHIP_MISMATCH' } })).toBe('Couldn’t open — tap to retry');
    expect(conversationRowOpenStatus('b', { error: { roomId: 'a', code: 'NETWORK_FAILURE' } })).toBeUndefined();
  });
  it('gives the empty main area a truthful status instead of a blank prompt', () => {
    const label = (id: string) => `Contact ${id}`;
    expect(emptyStateOpenStatus({}, label)).toBeUndefined();
    expect(emptyStateOpenStatus({ pending: { roomId: 'a' } }, label)).toEqual({ kind: 'opening', text: 'Opening Contact a… Your saved messages stay on this device.' });
    const failed = emptyStateOpenStatus({ error: { roomId: 'a', code: 'NETWORK_FAILURE' } }, label);
    expect(failed?.kind).toBe('failed');
    expect(failed?.text).toContain('waking up');
    expect(emptyStateOpenStatus({ error: { roomId: 'a' } }, label)?.text).toBe('Couldn’t open Contact a. Select it again to retry.');
  });
});
