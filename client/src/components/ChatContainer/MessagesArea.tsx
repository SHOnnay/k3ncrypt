/**
 * Messages area component
 */

import React, { useEffect, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { MessageBubble } from './MessageBubble';
import { copy } from '../../content/copy';
import './MessagesArea.css';

export const MessagesArea: React.FC = () => {
  const { messages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <main id="messages-area" className="messages-area">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-lock" aria-hidden="true"><img src="/branding/k3ncrypt-cluster.svg" alt="" /></div>
          <strong>{copy.conversationEmpty.title}</strong>
          <p>{copy.conversationEmpty.description}</p>
        </div>
      ) : (
        <>
          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </>
      )}
    </main>
  );
};
