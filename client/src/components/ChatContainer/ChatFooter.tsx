/**
 * Chat footer component (message input)
 */

import React, { useState, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { Button } from '../common/Button';
import { MicIcon, PaperclipIcon, SendIcon } from '../common/icons';
import './ChatFooter.css';
import { debugError } from '../../utils/debug';

export const ChatFooter: React.FC = () => {
  const { sendMessage } = useChat();
  const [message, setMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <footer className="chat-footer glass">
      <div className="input-container">
        <button className="composer-tool" type="button" disabled title="Encrypted attachments are coming later" aria-label="Attach a file (coming later)"><PaperclipIcon size={19} /></button>
        <input
          ref={inputRef}
          type="text"
          id="msg-input"
          className="message-input"
          placeholder="Type a secure message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isSending}
        />
        <button className="composer-tool" type="button" disabled title="Voice messages are coming later" aria-label="Record a voice message (coming later)"><MicIcon size={19} /></button>
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
    </footer>
  );
};
