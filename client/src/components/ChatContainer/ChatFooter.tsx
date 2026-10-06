/**
 * Chat footer component (message input)
 */

import React, { useEffect, useState, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { MicIcon, PaperclipIcon, SendIcon } from '../common/icons';
import './ChatFooter.css';
import { debugError } from '../../utils/debug';
import { useFiles } from '../../context/FileContext';
import { BrowserCaptureController } from '../../../../service/src/privacy/capture';

export const ChatFooter: React.FC = () => {
  const { sendMessage, sessionHealth, contactIdentity } = useChat();
  const { sendFile, retry, transfer, cancel: cancelTransfer } = useFiles();
  const busy = ['Preparing', 'Encrypting', 'Uploading', 'Downloading', 'Verifying'].includes(transfer.phase);
  const verified = contactIdentity?.verification === 'verified' && contactIdentity.changeStatus === 'unchanged';
  const [message, setMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
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

  useEffect(() => {
    if (!isRecording) { setRecordingSeconds(0); return; }
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedAt.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const handleSend = async () => {
    if (!message.trim()) return;

    try {
      setActionMessage('');
      setIsSending(true);
      await sendMessage(message);
      setMessage('');
      inputRef.current?.focus();
    } catch (err) {
      debugError('Message send failed', err);
      setActionMessage('Could not confirm sending. Check the message status before retrying.');
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setActionMessage('');
    try { await sendFile(file); }
    catch { setActionMessage('Could not confirm the protected file send. Check the conversation before retrying.'); }
  };

  const retryAttachment = retry;

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      discardRecording.current = false;
      const stream = await capture.current.request({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = []; let recordedBytes = 0;
      recorder.ondataavailable = (event) => {
        recordedBytes += event.data.size;
        if (recordedBytes > 8 * 1024 * 1024) { discardRecording.current = true; if (recorder.state === 'recording') recorder.stop(); setActionMessage('Recording exceeds the 8 MiB file limit.'); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { discardRecording.current = true; capture.current.release(); setIsRecording(false); };
      recorder.onstop = async () => {
        capture.current.release();
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        recorderRef.current = null;
        if (discardRecording.current) { discardRecording.current = false; return; }
        const file = new File(chunks, 'voice-message.webm', { type: recorder.mimeType });
        try { await sendFile(file); setActionMessage('Voice message added to the conversation.'); }
        catch { setActionMessage('Could not confirm the voice message send. Check the conversation before retrying.'); }
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      recordingStartedAt.current = Date.now();
      setIsRecording(true);
      setActionMessage('');
    } catch {
      capture.current.release();
      setIsRecording(false);
      setActionMessage('Microphone access is required to record a voice message.');
    }
  };

  const cancelRecording = () => {
    discardRecording.current = true;
    capture.current.release();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setActionMessage('Recording discarded.');
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
        <input ref={attachmentInputRef} type="file" hidden onChange={handleAttachment} />
        <button className="composer-tool" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={sessionHealth !== 'healthy' || isSending || busy || !verified} title="Send a protected file" aria-label="Attach a protected file"><PaperclipIcon size={19} /></button>
        <input
          ref={inputRef}
          type="text"
          id="msg-input"
          className="message-input"
          placeholder="Write a message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={sessionHealth === 'unhealthy' || isSending}
        />
        {isRecording && <span className="recording-indicator" role="status"><span />{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span>}
        {isRecording && <button className="recording-cancel" type="button" onClick={cancelRecording} aria-label="Discard voice recording">Discard</button>}
        <button className={`composer-tool${isRecording ? ' is-recording' : ''}`} type="button" onClick={toggleRecording} disabled={sessionHealth !== 'healthy' || busy || !verified} title={isRecording ? 'Stop and send recording' : 'Record a protected voice message'} aria-label={isRecording ? 'Stop and send recording' : 'Record a protected voice message'}><MicIcon size={19} /></button>
        <Button
          id="send-btn"
          variant="primary"
          circle
          onClick={handleSend}
          disabled={sessionHealth === 'unhealthy' || !message.trim() || isSending}
        >
          <SendIcon size={20} />
        </Button>
      </div>
      {(transfer.phase !== 'RestartRequired' || transfer.failure) && <div className="media-transfer-status" role="status"><span>{transfer.filename} · {transfer.phase === 'WaitingForRecipient' ? 'Encrypted file stored; waiting for recipient' : transfer.phase} · {transfer.bytes}/{transfer.total} bytes{transfer.failure && ` · ${transfer.failure}`}</span>{busy && <button type="button" onClick={cancelTransfer}>Cancel</button>}{transfer.phase === 'Failed' && transfer.retryable && <button type="button" onClick={retryAttachment}>Retry in this session</button>}</div>}
      <div className="composer-feedback">Protected files: up to 8 MiB. Downloads require explicit saving.</div>
      {!verified && <div className="composer-feedback">Verify the unchanged contact before sending a file.</div>}
      {actionMessage && <div className="composer-feedback" role="status">{actionMessage}</div>}
    </footer>
  );
};
