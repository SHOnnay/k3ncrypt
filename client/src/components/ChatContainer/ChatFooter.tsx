/**
 * Chat footer component (message input)
 */

import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
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
import { MAX_USER_MESSAGE_UTF8_BYTES } from '@chat-e2ee/service';
import { ComposerDrafts } from '../../product/composerDrafts';

export const ChatFooter: React.FC<{ onVerifyContact: () => void }> = (props) => {
  const { channelHash, plaintextSession } = useChat();
  const drafts = useRef(new ComposerDrafts());
  const lifetime = useRef({ scope: plaintextSession, epoch: 0 });
  if (lifetime.current.scope !== plaintextSession) { lifetime.current = { scope: plaintextSession, epoch: lifetime.current.epoch + 1 }; }
  drafts.current.bind(plaintextSession);
  useEffect(() => {
    const clear = () => drafts.current.clearAll();
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  }, []);
  return <RoomComposer key={`${lifetime.current.epoch}:${channelHash}`} {...props} drafts={drafts.current} scope={plaintextSession} />;
};

const RoomComposer: React.FC<{ onVerifyContact: () => void; drafts: ComposerDrafts; scope?: { readonly isCurrent: () => boolean } }> = ({ onVerifyContact, drafts, scope }) => {
  const { sendMessage, sessionHealth, contactIdentity, conversations, channelHash, plaintextSession } = useChat();
  const { sendFile, retry, transfer, cancel: cancelTransfer } = useFiles();
  const activeContact = conversations?.find((item) => item.roomId === channelHash);
  const contactLabel = contactDisplayName(activeContact?.label, activeContact?.roomId, activeContact?.remoteDisplayName, activeContact?.localNickname);
  const transferStatus = fileTransferCopy(transfer);
  const busy = transferStatus.active;
  const verified = contactIdentity?.verification === 'verified' && contactIdentity.changeStatus === 'unchanged';
  const [, refreshDraft] = useState(0);
  const message = drafts.get(channelHash);
  const setMessage = (text: string) => { drafts.set(channelHash, text); refreshDraft(n => n + 1); };
  const mounted = useRef(false);
  const sending = useRef(false);
  const currentScope = useRef(plaintextSession); currentScope.current = plaintextSession;
  const current = () => mounted.current && scope?.isCurrent() === true && currentScope.current === scope && drafts.boundTo(scope);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [attachmentDraft, setAttachmentDraft] = useState<{ file: File; roomId: string; image: boolean }>();
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string>();
  const attachmentSendLock = useRef(false);
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
    const code = classifySafeDiagnostic('file-send', transfer.diagnosticCode ? { safeDiagnosticCode: transfer.diagnosticCode } : transfer.failure ?? '');
    if (loggedFileFailure.current === code) return;
    loggedFileFailure.current = code;
    logSafeFailure('file_send_failed', code);
    setActionDiagnostic(code);
    setActionMessage(safeFailureCopy('file-send'));
  }, [transfer.failure, transfer.phase, transfer.diagnosticCode]);

  useEffect(() => {
    if (!attachmentDraft?.image) { setAttachmentPreviewUrl(undefined); return; }
    const url = URL.createObjectURL(attachmentDraft.file);
    setAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachmentDraft]);

  useEffect(() => {
    // Each conversation owns its own unsent text; switching rooms swaps the visible draft instead of
    // carrying text into a different contact's composer.
    setAttachmentDraft(undefined);
    setActionMessage('');
    setActionDiagnostic(undefined);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }, [channelHash]);

  useEffect(() => {
    if (!isRecording) { setRecordingSeconds(0); return; }
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedAt.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const handleSendMessage = async () => {
    if (sessionHealth === 'unhealthy' || !current() || sending.current || isSending || busy || !message.trim()) return;
    if (new TextEncoder().encode(message).byteLength > MAX_USER_MESSAGE_UTF8_BYTES) {
      setActionMessage(`Messages can be up to ${MAX_USER_MESSAGE_UTF8_BYTES.toLocaleString()} UTF-8 bytes.`);
      return;
    }

    const sendingRoom = channelHash;
    sending.current = true;
    const sentText = message;
    try {
      setActionMessage('');
      setIsSending(true);
      await sendMessage(sentText);
      // Clear only the draft of the room the text was sent from, and only if it was not edited meanwhile.
      if (drafts.boundTo(scope)) drafts.clearIfUnchanged(sendingRoom, sentText);
      if (current()) refreshDraft(n => n + 1);
    } catch (err) {
      if (!current()) return;
      debugError('Message send failed', err);
      const message = err instanceof Error ? err.message : '';
      setActionMessage(message.includes('reserved protocol marker') || message.includes('reserved protected-file marker')
        ? message
        : 'Couldn’t confirm this message was sent. Your draft is retained. Check its status before retrying; if the chat offers Retry, use that or this draft, not both.');
    } finally {
      sending.current = false;
      if (current()) setIsSending(false);
      // The composer stays focusable while sending (read-only, not disabled), so keyboard users can
      // keep typing the next message after a send or a failure without clicking back into it.
      if (current()) inputRef.current?.focus();
    }
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !current()) return;
    setActionDiagnostic(undefined);
    if (file.size > 8 * 1024 * 1024) { setActionMessage(file.type.startsWith('image/') ? 'This photo is larger than the current 8 MiB limit.' : 'This file is larger than the current 8 MiB limit.'); return; }
    setActionMessage('');
    setAttachmentDraft({ file, roomId: channelHash, image: file.type.startsWith('image/') });
  };

  const removeAttachment = () => {
    setAttachmentDraft(undefined);
    setActionMessage('');
    setActionDiagnostic(undefined);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const handleSendAttachment = async () => {
    const draft = attachmentDraft;
    if (!current() || !draft || attachmentSendLock.current || isSending || busy) return;
    if (!channelHash || draft.roomId !== channelHash) {
      removeAttachment();
      setActionMessage('The conversation changed. Attach the file again in the intended chat.');
      return;
    }
    attachmentSendLock.current = true;
    setIsSending(true);
    setActionMessage('');
    setActionDiagnostic(undefined);
    try { await sendFile(draft.file); }
    catch (error) {
      if (!current()) return;
      const code = classifySafeDiagnostic('file-send', error);
      if (loggedFileFailure.current !== code) logSafeFailure('file_send_failed', code);
      loggedFileFailure.current = code;
      setActionDiagnostic(code);
      setActionMessage(safeFailureCopy('file-send'));
    } finally {
      if (current()) setAttachmentDraft(value => value === draft ? undefined : value);
      attachmentSendLock.current = false;
      if (current()) setIsSending(false);
    }
  };

  const retryAttachment = async () => {
    if (!current()) return;
    try { await retry(); }
    catch { if (current()) setActionMessage('Another file operation may still be active. Wait for it to finish or cancel it, then retry.'); }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      discardRecording.current = false;
      const stream = await capture.current.request({ audio: true });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); capture.current.release(); return; }
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
        if (!current() || discardRecording.current) { discardRecording.current = false; return; }
        const file = new File(chunks, 'voice-message.webm', { type: recorder.mimeType });
        try { await sendFile(file); if (current()) setActionMessage('Voice message added to the conversation.'); }
        catch { if (current()) setActionMessage('Could not confirm the voice message send. Check the conversation before retrying.'); }
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
      if (attachmentDraft) void handleSendAttachment(); else void handleSendMessage();
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
          maxLength={MAX_USER_MESSAGE_UTF8_BYTES}
          value={message}
          onChange={(e) => { if (!isSending) setMessage(e.target.value); }}
          onKeyDown={handleKeyPress}
          disabled={sessionHealth === 'unhealthy'}
          readOnly={isSending}
          aria-busy={isSending}
        />
        {isRecording && <span className="recording-indicator" role="status"><span />{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span>}
        {isRecording && <button className="recording-cancel" type="button" onClick={cancelRecording} aria-label="Discard voice recording">Discard</button>}
        <button className={`composer-tool${isRecording ? ' is-recording' : ''}`} type="button" onClick={toggleRecording} disabled={sessionHealth !== 'healthy' || busy || !verified} title={isRecording ? 'Stop and send recording' : 'Record a protected voice message'} aria-label={isRecording ? 'Stop and send recording' : 'Record a protected voice message'}><MicIcon size={19} /></button>
        <Button
          id="send-btn"
          variant="primary"
          circle
          onClick={attachmentDraft ? handleSendAttachment : handleSendMessage}
          disabled={sessionHealth === 'unhealthy' || (!message.trim() && !attachmentDraft) || isSending || busy}
          aria-label={attachmentDraft ? 'Send file' : 'Send message'}
          title={attachmentDraft ? 'Send file' : 'Send message'}
        >
          <SendIcon size={20} />
        </Button>
      </div>
      {attachmentDraft && <div className="attachment-draft" role="group" aria-label="File attachment draft">
        {attachmentPreviewUrl && <img className="attachment-draft-preview" src={attachmentPreviewUrl} alt={`Preview of ${attachmentDraft.file.name}`} />}
        <div className="attachment-draft-details"><strong>{attachmentDraft.file.name}</strong><span>{(attachmentDraft.file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB</span></div>
        <button type="button" onClick={removeAttachment} disabled={isSending || busy} aria-label="Remove attachment">Remove</button>
      </div>}
      {transfer.phase !== 'Idle' && <div className="media-transfer-status" role="status" aria-live="polite"><span>{transferStatus.label}</span>{transferStatus.progress !== undefined && <progress max={100} value={transferStatus.progress} aria-label="File transfer progress" />}{busy && <button type="button" onClick={cancelTransfer}>Cancel</button>}{transfer.phase === 'Failed' && transfer.retryable && <button type="button" onClick={retryAttachment}>Retry</button>}</div>}
      <div className="composer-feedback">Photos and files up to 8 MiB. You choose when to save a download.</div>
      {!verified && contactIdentity && <div className="composer-feedback"><strong>Invitation accepted</strong><p>Verify this contact before sharing files.</p><button type="button" className="btn btn--secondary" onClick={onVerifyContact}>Verify {contactLabel}</button></div>}
      {actionMessage && <div className="composer-feedback" role="status">{actionMessage}<SafeDiagnosticDetails code={actionDiagnostic} /></div>}
    </footer>
  );
};
