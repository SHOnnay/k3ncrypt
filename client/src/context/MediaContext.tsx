import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { MediaKind, MediaMessageWorkflow, MediaReceiveResult, MediaSendResult } from '@chat-e2ee/service';
import { useChat } from './ChatContext';

export type MediaTransferState = 'idle' | 'uploading' | 'downloading' | 'ready' | 'failed';
export interface MediaTransfer { state: MediaTransferState; error?: string; result?: MediaSendResult | MediaReceiveResult; }
interface MediaContextValue {
  transfer: MediaTransfer;
  sendFile: (kind: Exclude<MediaKind, 'voice'>, file: { arrayBuffer: () => Promise<ArrayBuffer>; type: string }) => Promise<void>;
  sendVoice: (bytes: Uint8Array, durationMs: number) => Promise<void>;
  receive: (serialized: string) => Promise<MediaReceiveResult | undefined>;
  clearTransfer: () => void;
}

const MediaContext = createContext<MediaContextValue | undefined>(undefined);

export const MediaProvider: React.FC<{ children: ReactNode; workflow?: MediaMessageWorkflow }> = ({ children, workflow }) => {
  const { sendMessage, channelHash, userId, protocolMode } = useChat();
  const [transfer, setTransfer] = useState<MediaTransfer>({ state: 'idle' });
  const context = { conversationId: channelHash, participantId: userId };

  const sendFile = useCallback(async (kind: Exclude<MediaKind, 'voice'>, file: { arrayBuffer: () => Promise<ArrayBuffer>; type: string }) => {
    if (!workflow || protocolMode !== 'modern' || !context.conversationId || !context.participantId) {
      setTransfer({ state: 'failed', error: 'Protected media is temporarily unavailable.' });
      return;
    }
    setTransfer({ state: 'uploading' });
    try {
      const result = await workflow.sendFile(context, kind, file, async (serialized) => sendMessage(serialized));
      setTransfer({ state: 'ready', result });
    } catch {
      setTransfer({ state: 'failed', error: 'The protected media could not be sent. Try again.' });
    }
  }, [workflow, protocolMode, context.conversationId, context.participantId, sendMessage]);

  const receive = useCallback(async (serialized: string) => {
    if (!workflow || protocolMode !== 'modern' || !context.conversationId || !context.participantId) {
      setTransfer({ state: 'failed', error: 'Protected media is temporarily unavailable.' });
      return undefined;
    }
    setTransfer({ state: 'downloading' });
    try {
      const result = await workflow.receive(context, serialized);
      setTransfer({ state: 'ready', result });
      return result;
    } catch {
      setTransfer({ state: 'failed', error: 'The protected media could not be opened.' });
      return undefined;
    }
  }, [workflow, protocolMode, context.conversationId, context.participantId]);

  const sendVoice = useCallback(async (bytes: Uint8Array, durationMs: number) => {
    if (!workflow || protocolMode !== 'modern' || !context.conversationId || !context.participantId) {
      setTransfer({ state: 'failed', error: 'Protected media is temporarily unavailable.' });
      return;
    }
    setTransfer({ state: 'uploading' });
    try {
      const result = await workflow.sendVoice(context, bytes, async (serialized) => sendMessage(serialized), durationMs);
      setTransfer({ state: 'ready', result });
    } catch {
      setTransfer({ state: 'failed', error: 'The protected voice message could not be sent. Try again.' });
    }
  }, [workflow, protocolMode, context.conversationId, context.participantId, sendMessage]);

  return <MediaContext.Provider value={{ transfer, sendFile, sendVoice, receive, clearTransfer: () => setTransfer({ state: 'idle' }) }}>{children}</MediaContext.Provider>;
};

export const useMedia = (): MediaContextValue => {
  const value = useContext(MediaContext);
  if (!value) throw new Error('useMedia must be used within MediaProvider');
  return value;
};
