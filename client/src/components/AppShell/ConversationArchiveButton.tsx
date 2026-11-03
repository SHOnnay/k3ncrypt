import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';

/** Presentation-only local archive. No room deletion or trust changes. */
export const ConversationArchiveButton: React.FC<{ roomId: string; name: string; restore?: boolean; className?: string; verb?: 'Archive' | 'Remove' }> = ({ roomId, name, restore = false, className = 'workspace-contact__edit', verb = 'Archive' }) => {
  const { accountState, setConversationArchived } = useChat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async () => {
    if (busy || accountState !== 'ready') return;
    if (!restore && !window.confirm(verb === 'Remove' ? `Remove “${name}” from your list on this device? Its encrypted history stays saved, and you can bring it back from Contacts → Archived.` : `Archive “${name}” on this device? It will move out of Chats and Contacts. Encrypted history, identities and verification stay saved. This does not delete the room or stop an open chat or call. You can restore it from Contacts → Archived conversations.`)) return;
    setBusy(true); setError('');
    try { await setConversationArchived(roomId, !restore); }
    catch { setError('Could not update the list. Reopen Contacts and try again. History and trust records are retained.'); }
    finally { setBusy(false); }
  };
  return <><button className={className} type="button" disabled={busy || accountState !== 'ready'} aria-label={`${restore ? 'Restore' : verb} conversation ${name}`} onClick={() => void act()}>{busy ? 'Saving…' : restore ? 'Restore to lists' : verb}</button>{error && <p role="status">{error}</p>}</>;
};
