/**
 * Message bubble component
 */

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { FILE_PREFIX } from '@chat-e2ee/service';
import { useFiles } from '../../context/FileContext';
import { detachVerifiedOutput, previewableImageType } from '../../product/verifiedOutput';
import { PreviewCapacityError, FileOperationBusyError } from '../../product/previewResources';
import { Message } from '../../types/index';
import { formatMessageTime } from '../../utils/messageHandling';
import { useMedia } from '../../context/MediaContext';
import { useChat } from '../../context/ChatContext';
import { deriveMessageDeliveryVisibility } from '../../product/securityVisibility';
import { fileDownloadForReference, fileTransferCopy } from '../../product/fileTransferCopy';
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
  // Verified file output is moved into page memory as soon as it is ready, so the shared secure
  // disk slot is free for the next attachment and cancelling a browser save dialog loses nothing.
  const [saved, setSaved] = useState<{ filename: string; mimeType?: string }>();
  const { retryMessage, protocolMode, channelHash, plaintextSession } = useChat();
  const instanceId = useId();
  const resourceKey = JSON.stringify([channelHash, message.id, media?.reference, instanceId]);
  const live = useRef({ mounted: false, generation: 0, key: resourceKey, scope: plaintextSession });
  live.current.key = resourceKey; live.current.scope = plaintextSession;
  const opening = useRef(false);
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [mediaError, setMediaError] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const deliveryVisibility = deriveMessageDeliveryVisibility(message.delivery, protocolMode, message.relayAccepted);
  const downloadTransfer = fileDownloadForReference(files.download, media?.reference);
  const fileProgress = downloadTransfer ? fileTransferCopy(downloadTransfer) : undefined;
  useLayoutEffect(() => {
    live.current.mounted = true;
    setMediaUrl(undefined); setSaved(undefined); setIsOpening(false); opening.current = false;
    return () => { live.current.mounted = false; live.current.generation++; files.previews.release(resourceKey); };
  }, [resourceKey, plaintextSession, files.previews]);
  const formatFileSize = (size: number): string => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const openMedia = async () => {
    if (!media?.reference || opening.current || !plaintextSession?.isCurrent()) return;
    const generation = ++live.current.generation;
    const current = () => live.current.mounted && plaintextSession.isCurrent() && live.current.generation === generation && live.current.key === resourceKey && live.current.scope === plaintextSession;
    opening.current = true; setIsOpening(true); setMediaError('');
    try {
      if (isFile) {
        const result = await files.receive(media.reference);
        if (!result) { if (current()) setMediaError('Couldn’t open this file. Check your connection or ask your contact to send it again.'); return; }
        if (!current()) { await result.dispose(); return; }
        const detached = await detachVerifiedOutput(result);
        if (!current()) return;
        const url = files.previews.add(resourceKey, detached.blob);
        setSaved({ filename: detached.filename, mimeType: detached.mimeType }); setMediaUrl(url);
        return;
      }
      const result = await receive(media.reference);
      if (result) {
        try { if (current()) setMediaUrl(files.previews.add(resourceKey, new Blob([result.bytes], { type: result.mimeType }))); }
        finally { result.bytes.fill(0); }
      } else if (current()) setMediaError('Couldn’t open this file. Check your connection or ask your contact to send it again.');
    } catch (error) { if (current()) setMediaError(error instanceof PreviewCapacityError ? 'Close an open preview before downloading another file.' : error instanceof FileOperationBusyError ? 'Another file operation is still active. Wait for it to finish or cancel it, then retry.' : 'Couldn’t open this file. Check your connection or ask your contact to send it again.'); }
    finally { if (current()) { opening.current = false; setIsOpening(false); } }
  };
  const closePreview = () => { live.current.generation++; files.previews.release(resourceKey); setSaved(undefined); setMediaUrl(undefined); };
  if (message.callEvent) return <div className="message call-history-event" aria-label="Local call history"><strong>{message.text}</strong><div className="message-meta">{message.callEvent.durationSeconds !== undefined && <span>{Math.floor(message.callEvent.durationSeconds / 60)} min {message.callEvent.durationSeconds % 60} sec · </span>}{formatMessageTime(message.timestamp)} · On this device</div></div>;
  return (
    <div className={`message ${message.type}`}>
      <div className="message-text">{message.text}</div>
      {isFile && media?.size !== undefined && <div className="message-meta">Protected file · {formatFileSize(media.size)}</div>}
      {media?.reference && !mediaUrl && <button className="message-media-action" type="button" onClick={openMedia} disabled={isOpening}>{isOpening ? 'Downloading and verifying…' : isFile ? 'Download protected file' : `Open protected ${media.kind}`}</button>}
      {isFile && isOpening && fileProgress?.active && <div role="status" aria-live="polite">{fileProgress.label}{fileProgress.progress !== undefined && <progress max={100} value={fileProgress.progress} aria-label="File download progress" />} <button type="button" onClick={files.cancel}>Cancel</button></div>}
      {mediaError && <div className="message-media-error" role="status">{mediaError}</div>}
      {saved && mediaUrl && previewableImageType(saved.mimeType) && <img className="message-media-preview" src={mediaUrl} alt="Downloaded photo" />}
      {!isFile && mediaUrl && media?.kind === 'image' && <img className="message-media-preview" src={mediaUrl} alt="Protected image" />}
      {mediaUrl && media?.kind === 'voice' && <audio className="message-media-audio" controls src={mediaUrl} />}
      {mediaUrl && media?.kind === 'video' && <video className="message-media-preview" controls src={mediaUrl} />}
      {mediaUrl && <button type="button" onClick={closePreview}>Close</button>}
      {mediaUrl && media && media.kind !== 'image' && media.kind !== 'voice' && media.kind !== 'video' && <a className="message-media-action" href={mediaUrl} download={saved?.filename ?? "protected-file"}>{saved ? `Save ${saved.filename}` : 'Save protected file'}</a>}
      <div className="message-meta">
        <span>{formatMessageTime(message.timestamp)}</span>
        {message.type === 'sent' && message.delivery === 'failed' && <button type="button" title={deliveryVisibility.explanation} onClick={() => retryMessage(message.id)}>Could not confirm · Retry</button>}
        {message.type === 'sent' && message.delivery === 'held' && !message.text.startsWith('k3ncrypt-file-') && <button type="button" title={deliveryVisibility.explanation} onClick={() => retryMessage(message.id)}>Not sent · Retry securely</button>}
        {message.type === 'sent' && message.delivery === 'held' && message.text.startsWith('k3ncrypt-file-') && <span title={deliveryVisibility.explanation}>Not sent · Select the file again</span>}
        {message.type === 'sent' && message.delivery !== 'failed' && message.delivery && (
          <details className="message-delivery-details">
            <summary aria-label={`Message status: ${deliveryVisibility.summaryLabel}`}>{deliveryVisibility.summaryLabel}</summary>
            <p>{deliveryVisibility.explanation}</p>
          </details>
        )}
      </div>
    </div>
  );
};
