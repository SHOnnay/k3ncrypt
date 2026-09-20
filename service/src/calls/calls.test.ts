import { initialCallPermissions, transitionPermission } from './permissions';
import { transitionCall } from './stateMachine';
import type { CallSession } from './contracts';
import { CallAuthorization } from './authorization';
import { CallService } from './service';
import { MemoryCallRepository } from './repository';
const session = (state: CallSession['state'] = 'idle'): CallSession => ({ callId: 'call-1', conversationId: '11111111-1111-4111-8111-111111111111', participants: [{ participantId: 'a', identityId: 'ia', verification: 'verified' }, { participantId: 'b', identityId: 'ib', verification: 'verified' }], state, createdAt: 0, updatedAt: 0, expiresAt: 60_000, identityBinding: 'binding' });
describe('call foundation state and permissions', () => {
  it('accepts the valid non-media lifecycle and ends permanently', () => { let current = transitionCall(session(), 'invite', 1); current = transitionCall(current, 'invite', 2); current = transitionCall(current, 'accept', 3); current = transitionCall(current, 'connect', 4); current = transitionCall(current, 'connected', 5); current = transitionCall(current, 'end', 6); expect(current.state).toBe('ended'); expect(() => transitionCall(current, 'invite', 7)).toThrow(); });
  it('rejects invalid, expired and duplicate terminal transitions', () => { expect(() => transitionCall(session(), 'accept')).toThrow(); expect(() => transitionCall(session('ringing'), 'accept', 61_000)).toThrow('expired'); expect(() => transitionCall(session('rejected'), 'reject')).toThrow(); });
  it('tracks permission lifecycle without requesting on initialization', () => { let p = initialCallPermissions(); expect(p).toEqual({ microphone: 'unknown', camera: 'unknown' }); p = transitionPermission(p, 'microphone', 'requested'); p = transitionPermission(p, 'microphone', 'granted'); p = transitionPermission(p, 'microphone', 'active'); p = transitionPermission(p, 'microphone', 'released'); expect(p.microphone).toBe('released'); expect(() => transitionPermission(p, 'camera', 'active')).toThrow(); });
  it('authorizes a call, persists it, and rejects identity changes', async () => {
    const verifier = { isParticipant: async () => true, getVerification: async () => 'verified' as const, identityBinding: async () => 'binding' };
    const service = new CallService(new MemoryCallRepository(), new CallAuthorization(verifier), undefined, () => 1_000);
    const participants = [{ participantId: 'a', identityId: 'ia', verification: 'verified' as const }, { participantId: 'b', identityId: 'ib', verification: 'verified' as const }] as const;
    const created = await service.invite('11111111-1111-4111-8111-111111111111', participants, 'binding');
    expect(created.state).toBe('inviting');
    await expect(service.event(created.callId, 'accept')).resolves.toMatchObject({ state: 'accepted' });
    const changed = new CallAuthorization({ isParticipant: async () => true, getVerification: async () => 'changed-pending-review' as const, identityBinding: async () => 'binding' });
    await expect(changed.assertSession({ ...created, state: 'idle' })).rejects.toThrow('review');
  });
});
