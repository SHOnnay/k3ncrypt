import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';

export const removeContactConfirmation = (name: string): string =>
  `Remove “${name}”? This deletes the chat, its saved messages and its keys from this device, and they can no longer message or call you here. They are not told. To talk again you will need a new invitation and a new check. This cannot be undone.`;

/** Archive only hides a chat on this device. Remove ends the relationship: local tombstone and purge, then the relay is told. */
export const ConversationArchiveButton: React.FC<{ roomId: string; name: string; restore?: boolean; className?: string; verb?: 'Archive' | 'Remove' }> = ({ roomId, name, restore = false, className = 'workspace-contact__edit', verb = 'Archive' }) => {
  const { accountState, setConversationArchived, removeContact } = useChat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const removing = verb === 'Remove' && !restore;
  const act = async () => {
    if (busy || accountState !== 'ready') return;
    if (!restore && !window.confirm(removing ? removeContactConfirmation(name) : `Archive “${name}” on this device? It will move out of Chats and Contacts. Encrypted history, identities and verification stay saved. This does not delete the room or stop an open chat or call. You can restore it from Contacts → Archived conversations.`)) return;
    setBusy(true); setError('');
    try {
      if (removing) { if (!removeContact) throw new Error('unavailable'); await removeContact(roomId); }
      else await setConversationArchived(roomId, !restore);
    }
    catch { setError(removing ? 'Could not remove this contact. Nothing was changed. Try again.' : 'Could not update the list. Reopen Contacts and try again. History and trust records are retained.'); }
    finally { setBusy(false); }
  };
  return <><button className={className} type="button" disabled={busy || accountState !== 'ready'} aria-label={`${restore ? 'Restore' : verb} ${removing ? 'contact' : 'conversation'} ${name}`} onClick={() => void act()}>{busy ? (removing ? 'Removing…' : 'Saving…') : restore ? 'Restore to lists' : verb}</button>{error && <p role="status">{error}</p>}</>;
};
