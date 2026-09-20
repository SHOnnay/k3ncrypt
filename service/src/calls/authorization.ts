import type { CallIdentityVerifier, CallParticipant, CallSession } from './contracts';
export class CallAuthorization {
  constructor(private readonly identity: CallIdentityVerifier) {}
  async assertParticipant(session: CallSession, participant: CallParticipant): Promise<void> {
    if (session.participants.every((item) => item.participantId !== participant.participantId)) throw new Error('Unauthorized call participant.');
    if (!(await this.identity.isParticipant(session.conversationId, participant.participantId))) throw new Error('Unauthorized call participant.');
    const verification = await this.identity.getVerification(participant.participantId);
    if (verification === 'changed-pending-review') throw new Error('Call identity requires review.');
    if (verification !== participant.verification) throw new Error('Call identity binding changed.');
  }
  async assertSession(session: CallSession): Promise<void> { if (session.participants.length !== 2 || session.participants[0].participantId === session.participants[1].participantId) throw new Error('Invalid call participants.'); for (const participant of session.participants) await this.assertParticipant(session, participant); }
}
