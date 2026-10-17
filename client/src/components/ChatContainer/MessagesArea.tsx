/**
 * Messages area component
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useChat } from '../../context/ChatContext';
import { MessageBubble } from './MessageBubble';
import { copy } from '../../content/copy';
import { decideScroll, isNearBottom, messageKeys } from '../../product/messageList';
import './MessagesArea.css';

export const MessagesArea: React.FC = () => {
  const { messages, channelHash } = useChat();
  const areaRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastRoom = useRef<string | undefined>(undefined);
  const lastId = useRef<string | undefined>(undefined);
  const keys = useMemo(() => messageKeys(messages, channelHash), [messages, channelHash]);

  const trackScroll = () => {
    const area = areaRef.current;
    if (area) nearBottom.current = isNearBottom(area.scrollHeight, area.scrollTop, area.clientHeight);
  };

  // Follow new messages without fighting the reader: instant on open, smooth only when appropriate.
  useEffect(() => {
    const latest = messages[messages.length - 1];
    const action = decideScroll({
      roomChanged: lastRoom.current !== channelHash,
      previousLastId: lastId.current,
      lastId: latest?.id,
      lastIsOwn: latest?.type === 'sent',
      nearBottom: nearBottom.current,
    });
    lastRoom.current = channelHash;
    lastId.current = latest?.id;
    if (action === 'none') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    areaRef.current?.scrollTo({ top: areaRef.current.scrollHeight, behavior: action === 'instant' || reduced ? 'auto' : 'smooth' });
    nearBottom.current = true;
  }, [messages, channelHash]);

  return (
    <main id="messages-area" className="messages-area" ref={areaRef} onScroll={trackScroll}>
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-lock" aria-hidden="true"><img src="/branding/k3ncrypt-cluster.svg" alt="" /></div>
          <strong>{copy.conversationEmpty.title}</strong>
          <p>{copy.conversationEmpty.description}</p>
        </div>
      ) : (
        <>
          {messages.map((message, index) => (
            <MessageBubble key={keys[index]} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </>
      )}
    </main>
  );
};
