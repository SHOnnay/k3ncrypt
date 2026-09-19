/**
 * Chat context provider for explicit legacy and modern service paths.
 */

import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { createChatInstance, utils, BrowserSecureStorage, IndexedDbVaultPersistence, ModernConversation } from '@chat-e2ee/service';
import type { IChatE2EE, IE2ECall, CallLifecycleState, CallLifecycleUpdate, StoredContactIdentity } from '@chat-e2ee/service';
import { ChatContextType, InviteInfo, Message } from '../types/index';
import { createMessage } from '../utils/messageHandling';
import { playBeep } from '../utils/audioNotification';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { debugError } from '../utils/debug';
import { loadVodozemacBindings } from '../crypto/vodozemacModule';

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [chat, setChat] = useState<IChatE2EE | null>(null);
  const [modern, setModern] = useState<ModernConversation | null>(null);
  const [protocolMode, setProtocolMode] = useState<'legacy' | 'modern'>('legacy');
  const [ownFingerprint, setOwnFingerprint] = useState<string>();
  const [contactIdentity, setContactIdentity] = useState<StoredContactIdentity>();
  const [userId, setUserId] = useState<string>('');
  const [channelHash, setChannelHash] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [callActive, setCallActive] = useState<boolean>(false);
  const [callStatus, setCallStatus] = useState<string>('');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [callLifecycleState, setCallLifecycleState] = useState<CallLifecycleState>('idle');
  const [isIncomingCall, setIsIncomingCall] = useState<boolean>(false);
  // Chat message decryption happens inside the SDK; only plaintext ever
  // reaches this context. No private key material is held here any more.

  // Initialize chat service (no modifications)
  const initializeChat = useCallback(async () => {
    try {
      const chatInstance = createChatInstance(getRuntimeConfig());
      await chatInstance.init();
      setChat(chatInstance);
    } catch (err) {
      debugError('Chat initialization failed', err);
      throw err;
    }
  }, []);

  // Create new channel: asks the server for a room id, then generates the
  // invitation secret entirely on this device (see getLink()). The secret
  // never leaves the browser except via the URL fragment.
  const createNewChannel = useCallback(async (): Promise<InviteInfo> => {
    if (!chat) throw new Error('Chat not initialized');
    try {
      if (modern) await modern.close();
      setModern(null);
      const linkObj = await chat.getLink();
      return { roomId: linkObj.hash, secret: linkObj.secret, controlCapability: linkObj.controlCapability, link: linkObj.link, absoluteLink: linkObj.absoluteLink };
    } catch (err) {
      debugError('Conversation creation failed', err);
      throw err;
    }
  }, [chat, modern]);

  const openModernVault = async (passphrase: string): Promise<BrowserSecureStorage> => {
    const persistence = new IndexedDbVaultPersistence();
    const vault = new BrowserSecureStorage(persistence);
    if (await persistence.loadMetadata()) await vault.unlock(passphrase);
    else await vault.initializeWithPassphrase(passphrase);
    return vault;
  };

  const createModernChannel = useCallback(async (passphrase: string): Promise<string> => {
    if (!chat) throw new Error('Chat not initialized');
    if (modern) await modern.close();
    const invite = await chat.getLink();
    const vault = await openModernVault(passphrase);
    const conversation = new ModernConversation(vault, loadVodozemacBindings);
    const details = await conversation.connect(invite.hash, invite.controlCapability, undefined, (text) => {
      setMessages((previous) => [...previous, createMessage('contact', text, 'received')]);
    }, setContactIdentity);
    setModern(conversation);
    setProtocolMode('modern');
    setChannelHash(invite.hash);
    setOwnFingerprint(details.ownFingerprint);
    setContactIdentity(details.contact);
    setUserId(details.ownAddress);
    const fragment = `modern=${encodeURIComponent(invite.hash)}&control=${encodeURIComponent(invite.controlCapability)}&address=${encodeURIComponent(details.ownAddress)}`;
    return `${window.location.origin}${window.location.pathname}#${fragment}`;
  }, [chat, modern]);

  const joinModernChannel = useCallback(async (roomId: string, capability: string, address: string, passphrase: string): Promise<void> => {
    if (modern) await modern.close();
    const vault = await openModernVault(passphrase);
    const conversation = new ModernConversation(vault, loadVodozemacBindings);
    const details = await conversation.connect(roomId, capability, address, (text) => {
      setMessages((previous) => [...previous, createMessage('contact', text, 'received')]);
    }, setContactIdentity);
    setModern(conversation);
    setProtocolMode('modern');
    setChannelHash(roomId);
    setOwnFingerprint(details.ownFingerprint);
    setContactIdentity(details.contact);
    setUserId(details.ownAddress);
  }, [modern]);

  const verifyContact = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.verifyContact(true);
    setContactIdentity(await modern.getContact());
  }, [modern]);

  // Join existing channel using the invitation's roomId + secret
  const joinChannel = useCallback(
    async (roomId: string, secret: string, controlCapability: string) => {
      if (!chat) throw new Error('Chat not initialized');
      try {
        if (modern) await modern.close();
        setModern(null);
        // Check for channel status before joining
        const baseUrl = getRuntimeConfig().baseUrl;
        const statusRes = await fetch(`${baseUrl}/api/chat-link/status/${encodeURIComponent(roomId)}`, {
          headers: { 'X-K3ncrypt-Control-Capability': controlCapability },
        });
        if (statusRes.status === 410) {
          throw new Error('CHANNEL_DELETED');
        }
        if (!statusRes.ok) {
          throw new Error('Failed to verify channel status');
        }

        // Auto-generate User ID
        const newUserId = (utils as any).generateUUID();
        setUserId(newUserId);

        await chat.setChannel(roomId, secret, newUserId, controlCapability);
        setProtocolMode('legacy');
        setChannelHash(roomId);
        setIsConnected(true);

        // Setup listeners
        setupChatListeners(chat);

        // Check for existing users
        await checkExistingUsers(chat);
      } catch (err) {
        debugError('Conversation join failed', err);
        throw err;
      }
    },
    [chat, modern]
  );

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!userId || (protocolMode === 'legacy' && !chat) || (protocolMode === 'modern' && !modern)) throw new Error('Chat not ready');
      try {
        if (protocolMode === 'modern') {
          await modern!.send(text);
          addMessage(createMessage(userId, text, 'sent'));
          return;
        }
        const message = createMessage(userId, text, 'sent');
        addMessage(message);
        await chat!.encrypt({ text, image: '' }).send();
      } catch (err) {
        debugError('Message send failed', err);
        throw err;
      }
    },
    [chat, modern, protocolMode, userId]
  );

  // Start call
  const startCall = useCallback(async () => {
    if (protocolMode === 'modern') throw new Error('Calls are not available in modern conversations yet.');
    if (!chat) throw new Error('Chat not initialized');
    try {
      const call = await chat.startCall();
      setCallActive(true);
       setIsIncomingCall(false);
      setCallLifecycleState('ringing');
      setCallStatus('Ringing...');
      setupCallListeners(call);
    } catch (err) {
      debugError('Call start failed', err);
      throw err;
    }
  }, [chat, protocolMode]);

  const acceptCall = useCallback(async () => {
    if (!chat) throw new Error('Chat not initialized');
    try {
      await chat.acceptCall();
      setCallActive(true);
      setIsIncomingCall(false);
      setCallLifecycleState('connecting');
      setCallStatus('Connecting...');
    } catch (err) {
      debugError('Call acceptance failed', err);
      throw err;
    }
  }, [chat]);

  const rejectCall = useCallback(async () => {
    if (!chat) throw new Error('Chat not initialized');
    try {
      await chat.rejectCall();
      setIsIncomingCall(false);
      setCallActive(false);
      setCallLifecycleState('rejected');
      setCallStatus('Call Rejected');
    } catch (err) {
      debugError('Call rejection failed', err);
      throw err;
    }
  }, [chat]);

  const cancelCall = useCallback(async () => {
    if (!chat) throw new Error('Chat not initialized');
    try {
      await chat.cancelCall();
      setCallActive(false);
      setIsIncomingCall(false);
      setCallStatus('Call Cancelled');
    } catch (err) {
      debugError('Call cancellation failed', err);
      throw err;
    }
  }, [chat]);

  // End call
  const endCall = useCallback(async () => {
    try {
      if (chat) {
        await chat.endCall();
      }
      setCallActive(false);
      setIsIncomingCall(false);
      setCallDuration(0);
      setCallLifecycleState('ended');
      setCallStatus('Call Ended');
    } catch (err) {
      debugError('Call end failed', err);
    }
  }, [chat]);

  // Add message to state
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  // Setup chat listeners
  const setupChatListeners = (chatInstance: IChatE2EE) => {
    chatInstance.on('on-alice-join', () => {
      playBeep();
      setIsConnected(true);
    });

    chatInstance.on('on-alice-disconnect', () => {
      setIsConnected(false);
    });

    // The SDK has already decrypted (and replay-checked) the message before
    // this fires — `msg.message` is plaintext.
    chatInstance.on('chat-message', (msg: any) => {
      const message = createMessage(msg.sender, msg.message, 'received');
      addMessage(message);
    });

    chatInstance.on('call-added', (call: IE2ECall) => {
      setCallActive(true);
      setIsIncomingCall(false);
      setupCallListeners(call);
    });

    chatInstance.on('call-invite', () => {
      setCallActive(true);
      setIsIncomingCall(true);
      setCallLifecycleState('incoming');
      setCallStatus('Incoming Call...');
      playBeep();
    });

    chatInstance.on('call-state-changed', (update: CallLifecycleUpdate) => {
      setCallLifecycleState(update.state);
      setCallStatus(formatCallStatus(update.state));
      if (update.state === 'incoming') {
        setCallActive(true);
      }
      if (['ended', 'rejected', 'timeout', 'cancelled', 'no-peer', 'media-denied', 'signaling-failed', 'ice-failed'].includes(update.state)) {
        setCallActive(false);
        setIsIncomingCall(false);
        setCallDuration(0);
      }
    });

    chatInstance.on('call-removed', () => {
      setCallActive(false);
      setIsIncomingCall(false);
      setCallDuration(0);
    });
  };

  // Setup call listeners
  const setupCallListeners = (call: IE2ECall) => {
    call.on('state-changed', async () => {
      const state = call.state;
      setCallStatus(state.charAt(0).toUpperCase() + state.slice(1));

      if (state === 'closed' || state === 'failed') {
        setCallActive(false);
        setIsIncomingCall(false);
        setCallDuration(0);
        setCallLifecycleState(state === 'failed' ? 'ice-failed' : 'ended');
        setCallStatus(state === 'failed' ? 'Connection Failed' : 'Call Ended');
      }
    });
  };

  const formatCallStatus = (state: CallLifecycleState): string => {
    const callStatusByState: Record<CallLifecycleState, string> = {
      idle: '',
      initiating: 'Initiating...',
      ringing: 'Ringing...',
      incoming: 'Incoming Call...',
      connecting: 'Connecting...',
      connected: 'Connected',
      ending: 'Ending...',
      ended: 'Call Ended',
      rejected: 'Call Rejected',
      'no-peer': 'No Peer Available',
      'media-denied': 'Microphone Permission Denied',
      'signaling-failed': 'Signaling Failed',
      'ice-failed': 'Connection Failed',
      timeout: 'Call Timed Out',
      cancelled: 'Call Cancelled',
    };
    return callStatusByState[state] ?? '';
  };

  // Check for existing users
  const checkExistingUsers = async (chatInstance: IChatE2EE) => {
    try {
      const users = await chatInstance.getUsersInChannel();
      if (users && users.length > 1) {
        playBeep();
        setIsConnected(true);
      }
    } catch (err) {
      debugError('Peer availability check failed', err);
    }
  };

  // Delete channel
  const deleteChannel = useCallback(async () => {
    if (protocolMode === 'modern') {
      await modern?.delete();
      setModern(null);
      setProtocolMode('legacy');
      setChannelHash('');
      setMessages([]);
      return;
    }
    if (!chat) return;
    try {
      await chat.delete();
      setIsConnected(false);
      setChannelHash('');
      setMessages([]);
    } catch (err) {
      debugError('Conversation deletion failed', err);
      throw err;
    }
  }, [chat, modern, protocolMode]);

  const value: ChatContextType = {
    chat,
    userId,
    channelHash,
    messages,
    isConnected,
    callActive,
    callStatus,
    callDuration,
    callLifecycleState,
    isIncomingCall,
    protocolMode,
    ownFingerprint,
    contactIdentity,
    initializeChat,
    createNewChannel,
    createModernChannel,
    joinModernChannel,
    verifyContact,
    joinChannel,
    sendMessage,
    startCall,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    addMessage,
    setCallDuration,
    deleteChannel,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

// Custom hook to use chat context
export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
};
