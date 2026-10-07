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
import { contactDisplayName } from '../../content/copy';
import { fileTransferCopy } from '../../product/fileTransferCopy';
import { classifySafeDiagnostic, logSafeFailure, safeFailureCopy, type SafeDiagnosticCode } from '../../product/safeDiagnostics';
import { SafeDiagnosticDetails } from '../common/SafeDiagnosticDetails';

export const ChatFooter: React.FC<{ onVerifyContact: () => void }> = ({ onVerifyContact }) => {
  const { sendMessage, sessionHealth, contactIdentity, conversations, channelHash } = useChat();
  const { sendFile, retry, transfer, cancel: cancelTransfer } = useFiles();
  const activeContact = conversations?.find((item) => item.roomId === channelHash);
  const contactLabel = contactDisplayName(activeContact?.label, activeContact?.roomId, activeContact?.remoteDisplayName, activeContact?.localNickname);
  const transferStatus = fileTransferCopy(transfer);
  const busy = transferStatus.active;
  const verified = contactIdentity?.verification === 'verified' && contactIdentity.changeStatus === 'unchanged';
  const [message, setMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionDiagnostic, setActionDiagnostic] = useState<SafeDiagnosticCode>();
  const loggedFileFailure = useRef<SafeDiagnosticCode>();
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    if (transfer.phase !== 'Failed') { loggedFileFailure.current = undefined; return; }
    const code = classifySafeDiagnostic('file-send', transfer.failure ?? '');
    if (loggedFileFailure.current === code) return;
    loggedFileFailure.current = code;
    logSafeFailure('file_send_failed', code);
    setActionDiagnostic(code);
    setActionMessage(safeFailureCopy('file-send'));
  }, [transfer.failure, transfer.phase]);

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
    catch (error) {
      const code = classifySafeDiagnostic('file-send', error);
      if (loggedFileFailure.current !== code) logSafeFailure('file_send_failed', code);
      loggedFileFailure.current = code;
      setActionDiagnostic(code);
      setActionMessage(safeFailureCopy('file-send'));
    }
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <footer className="chat-footer glass">
      <div className="input-container">
        <input ref={attachmentInputRef} type="file" hidden onChange={handleAttachment} />
        <button className="composer-tool" type="button" onClick={() => attachmentInputRef.current?.click()} disabled={sessionHealth !== 'healthy' || isSending || busy || !verified} title="Attach a photo or file (up to 8 MiB)" aria-label="Attach a photo or file, up to 8 MiB"><PaperclipIcon size={19} /></button>
        <textarea
          ref={inputRef}
          id="msg-input"
          className="message-input"
          placeholder="Write a message"
          aria-label="Write a message"
          rows={1}
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
          aria-label="Send message"
        >
          <SendIcon size={20} />
        </Button>
      </div>
      {transfer.phase !== 'RestartRequired' && <div className="media-transfer-status" role="status" aria-live="polite"><span>{transferStatus.label}</span>{transferStatus.progress !== undefined && <progress max={100} value={transferStatus.progress} aria-label="File transfer progress" />}{busy && <button type="button" onClick={cancelTransfer}>Cancel</button>}{transfer.phase === 'Failed' && transfer.retryable && <button type="button" onClick={retryAttachment}>Retry</button>}</div>}
      <div className="composer-feedback">Photos and files up to 8 MiB. You choose when to save a download.</div>
      {!verified && contactIdentity && <div className="composer-feedback"><strong>Invitation accepted</strong><p>Verify this contact before sharing files.</p><button type="button" className="btn btn--secondary" onClick={onVerifyContact}>Verify {contactLabel}</button></div>}
      {actionMessage && <div className="composer-feedback" role="status">{actionMessage}<SafeDiagnosticDetails code={actionDiagnostic} /></div>}
    </footer>
  );
};
