/**
 * Chat footer component (message input)
 */

import React, { useEffect, useState, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { MicIcon, PaperclipIcon, SendIcon } from '../common/icons';
import './ChatFooter.css';
import { debugError } from '../../utils/debug';
import { useMedia } from '../../context/MediaContext';
import { BrowserCaptureController } from '../../../../service/src/privacy/capture';

export const ChatFooter: React.FC = () => {
  const { sendMessage } = useChat();
  const { sendFile, sendVoice, transfer, cancelTransfer } = useMedia();
  const [message, setMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAt = useRef<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const discardRecording = useRef(false);
  const capture = useRef(new BrowserCaptureController());
  useEffect(() => {
    const cancel = () => {
      discardRecording.current = true;
      capture.current.release();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    };
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); cancel(); };
  }, []);
  const [lastAttachment, setLastAttachment] = useState<{ kind: 'image' | 'video' | 'file'; file: File }>();

  const handleSend = async () => {
    if (!message.trim()) return;

    try {
      setIsSending(true);
      await sendMessage(message);
      setMessage('');
      inputRef.current?.focus();
    } catch (err) {
      debugError('Message send failed', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
    setLastAttachment({ kind, file });
    await sendFile(kind, file);
  };

  const retryAttachment = async () => { if (lastAttachment) await sendFile(lastAttachment.kind, lastAttachment.file); };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      discardRecording.current = false;
      const stream = await capture.current.request({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { discardRecording.current = true; capture.current.release(); setIsRecording(false); };
      recorder.onstop = async () => {
        capture.current.release();
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        recorderRef.current = null;
        if (discardRecording.current) { discardRecording.current = false; return; }
        const bytes = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
        await sendVoice(bytes, Date.now() - recordingStartedAt.current);
      };
      recorder.start();
      recorderRef.current = recorder;
      recordingStartedAt.current = Date.now();
      setIsRecording(true);
    } catch {
      capture.current.release();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { discardRecording.current = true; capture.current.release(); if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [isRecording]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <footer className="chat-footer glass">
      <div className="input-container">
        <input ref={attachmentInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/ogg,.pdf,.txt,.zip,.doc,.docx" onChange={handleAttachment} />
        <button className="composer-tool" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={isSending || transfer.state === 'uploading'} title="Send a protected file" aria-label="Attach a protected file"><PaperclipIcon size={19} /></button>
        <input
          ref={inputRef}
          type="text"
          id="msg-input"
          className="message-input"
          placeholder="Write a message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isSending}
        />
        <button className={`composer-tool${isRecording ? ' is-recording' : ''}`} type="button" onClick={toggleRecording} disabled={transfer.state === 'uploading'} title={isRecording ? 'Stop recording' : 'Record a protected voice message'} aria-label={isRecording ? 'Stop recording' : 'Record a protected voice message'}><MicIcon size={19} /></button>
        <Button
          id="send-btn"
          variant="primary"
          circle
          onClick={handleSend}
          disabled={!message.trim() || isSending}
        >
          <SendIcon size={20} />
        </Button>
      </div>
      {transfer.state !== 'idle' && <div className="media-transfer-status" role="status"><span>{transfer.error ?? ({ uploading: 'Uploading protected data…', downloading: 'Opening protected media…', ready: 'Protected media ready.', failed: 'Unable to send protected media.', idle: '' } as Record<string, string>)[transfer.state]}</span>{transfer.state === 'uploading' && <button type="button" onClick={cancelTransfer}>Cancel</button>}{transfer.state === 'failed' && lastAttachment && <button type="button" onClick={retryAttachment}>Try again</button>}</div>}
    </footer>
  );
};
