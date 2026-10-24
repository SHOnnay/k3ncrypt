import type { ConversationDescriptor } from './sessionStore';

/** Bounded optional presentation work. No storage writes, room admission or trust decisions. */
export async function enrichInvitationExpiries(
  descriptors: readonly ConversationDescriptor[], cache: Map<string, number | null>,
  probe: (descriptor: ConversationDescriptor) => Promise<number | undefined>,
  current: () => boolean, publish: (roomId: string, expiresAt: number) => void,
): Promise<void> {
  const candidates = descriptors.filter(item => item.relationship === 'invitation' && !item.remoteAddress &&
    !Number.isSafeInteger(item.signedInvitation?.expiresAt) && !Number.isSafeInteger(item.pendingInvitationExpiresAt)).slice(0, 12);
  for (const invitation of candidates) {
    if (!current()) return;
    if (cache.has(invitation.roomId)) continue;
    cache.set(invitation.roomId, null);
    let expiresAt: number | undefined;
    try { expiresAt = await probe(invitation); } catch { /* Labels may remain unknown; admission still checks the server. */ }
    if (!current() || expiresAt === undefined) { cache.delete(invitation.roomId); if (!current()) return; continue; }
    cache.set(invitation.roomId, expiresAt);
    publish(invitation.roomId, expiresAt);
  }
}
