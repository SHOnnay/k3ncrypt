/**
 * Message bubble component
 */

import React, { useEffect, useState } from 'react';
import { FILE_PREFIX } from '@chat-e2ee/service';
import { useFiles } from '../../context/FileContext';
import type { SavedFile } from '../../media/fileDisk';
import { Message } from '../../types/index';
import { formatMessageTime } from '../../utils/messageHandling';
import { useMedia } from '../../context/MediaContext';
import { useChat } from '../../context/ChatContext';
import { deriveMessageDeliveryVisibility } from '../../product/securityVisibility';
import './SecurityVisibility.css';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const media = message.media;
  const { receive } = useMedia();
  const files = useFiles();
  const isFile = media?.reference?.startsWith(FILE_PREFIX);
  const [saved, setSaved] = useState<SavedFile>();
  useEffect(() => () => { if (saved) void saved.dispose(); }, [saved]);
  const { retryMessage, protocolMode } = useChat();
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [mediaError, setMediaError] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const deliveryVisibility = deriveMessageDeliveryVisibility(message.delivery, protocolMode);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const openMedia = async () => {
    if (!media?.reference || isOpening) return;
    setIsOpening(true);
    setMediaError(false);
    try {
      if (isFile) { const result = await files.receive(media.reference); if (result) { setSaved(result); setMediaUrl(URL.createObjectURL(new Blob([result.file], { type: 'application/octet-stream' }))); } else setMediaError(true); return; }
      const result = await receive(media.reference);
      if (result) setMediaUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType })); });
      else setMediaError(true);
    } catch {
      setMediaError(true);
    } finally {
      setIsOpening(false);
    }
  };
  return (
    <div className={`message ${message.type}`}>
      <div className="message-text">{message.text}</div>
      {isFile && media?.size && <div className="message-meta">Protected file · {media.size} bytes</div>}
      {media?.reference && !mediaUrl && <button className="message-media-action" type="button" onClick={openMedia} disabled={isOpening}>{isOpening ? 'Downloading and verifying…' : isFile ? 'Download protected file' : `Open protected ${media.kind}`}</button>}
      {isFile && isOpening && <div role="status">{files.transfer.phase} · {files.transfer.bytes} bytes <button onClick={files.cancel}>Cancel</button></div>}
      {mediaError && <div className="message-media-error" role="status">Unable to open this attachment.</div>}
      {mediaUrl && media?.kind === 'image' && <img className="message-media-preview" src={mediaUrl} alt="Protected image" />}
      {mediaUrl && media?.kind === 'voice' && <audio className="message-media-audio" controls src={mediaUrl} />}
      {mediaUrl && media?.kind === 'video' && <video className="message-media-preview" controls src={mediaUrl} />}
      {saved && <button type="button" onClick={() => { void saved.dispose(); setSaved(undefined); if (mediaUrl) URL.revokeObjectURL(mediaUrl); setMediaUrl(undefined); }}>Discard verified output</button>}
      {mediaUrl && media && media.kind !== 'image' && media.kind !== 'voice' && media.kind !== 'video' && <a className="message-media-action" href={mediaUrl} download={saved?.filename ?? "protected-file"} onClick={() => { if (saved) window.setTimeout(() => { void saved.dispose(); setSaved(undefined); if (mediaUrl) URL.revokeObjectURL(mediaUrl); setMediaUrl(undefined); }, 60000); }}>{saved ? `Save ${saved.filename}` : 'Save protected file'}</a>}
      <div className="message-meta">
        <span>{formatMessageTime(message.timestamp)}</span>
        {message.type === 'sent' && message.delivery === 'failed' && <button type="button" title={deliveryVisibility.explanation} onClick={() => retryMessage(message.id)}>Could not confirm · Retry</button>}
        {message.type === 'sent' && message.delivery !== 'failed' && message.delivery && (
          <details className="message-delivery-details">
            <summary aria-label={`Message status: ${deliveryVisibility.label}`}>{deliveryVisibility.label}</summary>
            <p>{deliveryVisibility.explanation}</p>
          </details>
        )}
      </div>
    </div>
  );
};
