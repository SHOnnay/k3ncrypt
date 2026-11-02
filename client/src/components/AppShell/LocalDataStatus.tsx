import React from 'react';
import { useChat } from '../../context/ChatContext';

/** Orphaned local records report. Sidebar on wide screens; Contacts page on phones, so it never floats over the composer. */
export const LocalDataStatus: React.FC<{ className?: string }> = ({ className = 'conversation-recovery' }) => {
  const { orphanedConversationRecords } = useChat();
  if (!orphanedConversationRecords) return null;
  return <details className={className}><summary>Local data status</summary>{!orphanedConversationRecords.available ? <p>Record inspection is unavailable; no recovery claim can be made.</p> : <><p>{orphanedConversationRecords.roomIds.length} rooms have protocol/session records without a matching saved access descriptor. This count does not check contact identities, session usability or server availability. A missing access capability cannot be recovered automatically.</p><ul>{orphanedConversationRecords.roomIds.map(roomId => <li key={roomId}>Saved room · {roomId.slice(-8)}</li>)}</ul>{orphanedConversationRecords.truncated && <p>Inspection reached its safe limit; additional records may exist.</p>}</>}</details>;
};
