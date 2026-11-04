import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { terminalCallRetryable, terminalCallStatusMessage } from '../../calls/callLaunchReadiness';
import { contactDisplayName } from '../../content/copy';
import { useConnectionHelperOffer } from '../../calls/useConnectionHelperOffer';

/** Calls milestone 2: how the last call ended, in plain words, with Retry where calling again can help. */
export const CallOutcome: React.FC<{ roomId?: string }> = ({ roomId }) => {
  const { callLifecycleState, callWasOutgoing = false, callMediaMode, startCall, startVideoCall, conversations, channelHash } = useChat();
  const [retrying, setRetrying] = useState(false);
  const helper = useConnectionHelperOffer();
  const room = roomId ?? channelHash;
  const contact = conversations.find((item) => item.roomId === room);
  const name = contactDisplayName(contact?.label, room, contact?.remoteDisplayName, contact?.localNickname);
  const message = terminalCallStatusMessage(callLifecycleState, { outgoing: callWasOutgoing, name });
  if (!message) return null;
  const retry = async () => { setRetrying(true); try { await (callMediaMode === 'video' ? startVideoCall() : startCall()); } catch { /* the call surface shows the failure */ } finally { setRetrying(false); } };
  return <div className="chat-call-status" role="status"><span>{message}</span>
    {helper.offer ? <button className="btn btn--secondary chat-call-retry" type="button" disabled={helper.busy} onClick={() => void helper.turnOnAndRetry().catch(() => undefined)}>Turn on connection helper and retry</button>
      : terminalCallRetryable(callLifecycleState, callWasOutgoing) && <button className="btn btn--secondary chat-call-retry" type="button" disabled={retrying} onClick={() => void retry()}>Retry</button>}
  </div>;
};
