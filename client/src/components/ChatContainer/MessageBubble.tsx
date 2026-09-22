/**
 * Message bubble component
 */

import React, { useEffect, useState } from 'react';
import { Message } from '../../types/index';
import { formatMessageTime } from '../../utils/messageHandling';
import { useMedia } from '../../context/MediaContext';
import { useChat } from '../../context/ChatContext';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const media = message.media;
  const { receive } = useMedia();
  const { retryMessage } = useChat();
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [mediaError, setMediaError] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const openMedia = async () => {
    if (!media?.reference || isOpening) return;
    setIsOpening(true);
    setMediaError(false);
    const result = await receive(media.reference);
    if (result) setMediaUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType })); });
    else setMediaError(true);
    setIsOpening(false);
  };
  return (
    <div className={`message ${message.type}`}>
      <div className="message-text">{message.text}</div>
      {media?.reference && !mediaUrl && <button className="message-media-action" type="button" onClick={openMedia} disabled={isOpening}>{isOpening ? 'Opening protected media…' : `Open protected ${media.kind}`}</button>}
      {mediaError && <div className="message-media-error" role="status">Unable to open this attachment.</div>}
      {mediaUrl && media?.kind === 'image' && <img className="message-media-preview" src={mediaUrl} alt="Protected image" />}
      {mediaUrl && media?.kind === 'voice' && <audio className="message-media-audio" controls src={mediaUrl} />}
      {mediaUrl && media?.kind === 'video' && <video className="message-media-preview" controls src={mediaUrl} />}
      {mediaUrl && media && media.kind !== 'image' && media.kind !== 'voice' && media.kind !== 'video' && <a className="message-media-action" href={mediaUrl} download="protected-file">Save protected file</a>}
      <div className="message-meta">
        <span>{message.type === 'sent' ? 'You' : 'Peer'}</span>
        <span>{formatMessageTime(message.timestamp)}</span>
        {message.type === 'sent' && message.delivery === 'pending' && <span>Pending delivery</span>}
        {message.type === 'sent' && message.delivery === 'accepted' && <span>Delivered</span>}
        {message.type === 'sent' && message.delivery === 'failed' && <button type="button" onClick={() => retryMessage(message.id)}>Retry</button>}
      </div>
    </div>
  );
};
