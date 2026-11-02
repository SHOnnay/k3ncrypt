import React from 'react';
import { useChat } from '../../context/ChatContext';
import { classifySidebarConversations } from '../../product/conversationEligibility';
import { contactsCopy } from '../../content/checkCopy';

/**
 * Bug A: an account's own unaccepted invitations are not contacts. They appear only here,
 * on the Invite someone screen, clearly labelled as your invitation.
 */
export const OwnInvitations: React.FC<{ onOpen?: (roomId: string) => void }> = ({ onOpen }) => {
  const { conversations = [], savedConversations = conversations, unavailableConversations = [], accountState, setPendingInvitationDismissed } = useChat();
  const pending = classifySidebarConversations(savedConversations, unavailableConversations).pendingInvitations;
  const shown = pending.filter((item) => !item.locallyDismissed);
  const dismissed = pending.filter((item) => item.locallyDismissed);
  if (!pending.length) return null;
  const expiry = (item: typeof pending[number]) => {
    const expiresAt = item.pendingInvitationExpiresAt ?? item.signedInvitation?.expiresAt;
    if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) < 0) return '';
    const date = new Date(expiresAt as number);
    if (!Number.isFinite(date.getTime())) return '';
    return `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
  };
  const name = (item: typeof pending[number]) => item.localNickname ?? `${contactsCopy.yourInvitationLabel} · ${item.roomId.slice(-4).toUpperCase()}`;
  return <section className="own-invitations" aria-label={contactsCopy.yourInvitations}>
    <h2>{contactsCopy.yourInvitations}</h2>
    {shown.map((item) => <div className="own-invitation-row" key={item.roomId}>
      <button type="button" className="own-invitation-open" onClick={() => onOpen?.(item.roomId)} aria-label={`Open ${name(item)}`}>
        <strong>{name(item)}</strong><span>{contactsCopy.yourInvitationHelp}{expiry(item) ? ` ${expiry(item)}.` : ''}</span>
      </button>
      <button className="invitation-local-action" type="button" disabled={accountState !== 'ready'} onClick={() => void setPendingInvitationDismissed(item.roomId, true).catch(() => window.alert('Could not hide this invitation. Nothing was removed.'))}>Hide</button>
    </div>)}
    {dismissed.length > 0 && <details className="dismissed-invitations"><summary>Hidden on this device ({dismissed.length})</summary>{dismissed.map((item) => <div className="own-invitation-row" key={item.roomId}>
      <span><strong>{name(item)}</strong></span>
      <button className="invitation-local-action" type="button" disabled={accountState !== 'ready'} onClick={() => void setPendingInvitationDismissed(item.roomId, false).catch(() => window.alert('Could not show this invitation again. Nothing was changed.'))}>Show again</button>
    </div>)}</details>}
  </section>;
};
