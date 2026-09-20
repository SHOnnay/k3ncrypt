/**
 * Chat context provider for explicit legacy and modern service paths.
 */

import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { createChatInstance, utils, BrowserSecureStorage, IndexedDbVaultPersistence, ModernConversation, parseEncryptedMediaMessage } from '@chat-e2ee/service';
import type { IChatE2EE, IE2ECall, CallLifecycleState, CallLifecycleUpdate, StoredContactIdentity, AuthenticatedCallComposition, EnrollmentRequest, DeviceControlEvent, LifecycleStateSnapshot } from '@chat-e2ee/service';
import { ChatContextType, InviteInfo, Message } from '../types/index';
import { createMessage } from '../utils/messageHandling';
import { playBeep } from '../utils/audioNotification';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { debugError } from '../utils/debug';
import { loadVodozemacBindings } from '../crypto/vodozemacModule';

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const displayMessage = (sender: string, text: string, type: Message['type']): Message => {
  try {
    const media = parseEncryptedMediaMessage(text);
    if (!media) throw new Error('not media');
    return { ...createMessage(sender, `Protected ${media.kind}`, type), media: { kind: media.kind, mimeType: media.mimeType, size: media.size, reference: text } };
  } catch {
    if (text.startsWith('k3ncrypt-media-v1:')) return { ...createMessage(sender, 'Protected media unavailable', type), media: { kind: 'file' } };
    return createMessage(sender, text, type);
  }
};

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [chat, setChat] = useState<IChatE2EE | null>(null);
  const [modern, setModern] = useState<ModernConversation | null>(null);
  const [modernCallComposition, setModernCallComposition] = useState<AuthenticatedCallComposition | null>(null);
  const [modernCallId, setModernCallId] = useState<string>();
  const [protocolMode, setProtocolMode] = useState<'legacy' | 'modern'>('legacy');
  const [ownFingerprint, setOwnFingerprint] = useState<string>();
  const [contactIdentity, setContactIdentity] = useState<StoredContactIdentity>();
  const [deviceLifecycleState, setDeviceLifecycleState] = useState<LifecycleStateSnapshot>();
  const [pendingDeviceEnrollment, setPendingDeviceEnrollment] = useState<EnrollmentRequest>();
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
      setModernCallComposition(null);
      setModernCallId(undefined);
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
      setMessages((previous) => [...previous, displayMessage('contact', text, 'received')]);
    }, setContactIdentity, (event: DeviceControlEvent) => { if (event.type === 'enrollment-request') setPendingDeviceEnrollment(event.payload as EnrollmentRequest); });
    setModern(conversation);
    setModernCallComposition(null);
    setModernCallId(undefined);
    setProtocolMode('modern');
    setChannelHash(invite.hash);
    setOwnFingerprint(details.ownFingerprint);
    setContactIdentity(details.contact);
    setUserId(details.ownAddress);
    setDeviceLifecycleState(await conversation.getDeviceLifecycleState());
    const fragment = `modern=${encodeURIComponent(invite.hash)}&control=${encodeURIComponent(invite.controlCapability)}&address=${encodeURIComponent(details.ownAddress)}`;
    return `${window.location.origin}${window.location.pathname}#${fragment}`;
  }, [chat, modern]);

  const joinModernChannel = useCallback(async (roomId: string, capability: string, address: string, passphrase: string): Promise<void> => {
    if (modern) await modern.close();
    const vault = await openModernVault(passphrase);
    const conversation = new ModernConversation(vault, loadVodozemacBindings);
    const details = await conversation.connect(roomId, capability, address, (text) => {
      setMessages((previous) => [...previous, displayMessage('contact', text, 'received')]);
    }, setContactIdentity, (event: DeviceControlEvent) => { if (event.type === 'enrollment-request') setPendingDeviceEnrollment(event.payload as EnrollmentRequest); });
    setModern(conversation);
    setModernCallComposition(null);
    setModernCallId(undefined);
    setProtocolMode('modern');
    setChannelHash(roomId);
    setOwnFingerprint(details.ownFingerprint);
    setContactIdentity(details.contact);
    setUserId(details.ownAddress);
    setDeviceLifecycleState(await conversation.getDeviceLifecycleState());
  }, [modern]);

  const verifyContact = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.verifyContact(true);
    setContactIdentity(await modern.getContact());
    const composition = await modern.createAuthenticatedCallComposition();
    setModernCallComposition(composition);
    composition.onCallUpdate((session) => {
      setModernCallId(session.callId);
      setCallLifecycleState(session.state === 'inviting' ? 'ringing' : session.state === 'rejected' ? 'rejected' : session.state === 'cancelled' ? 'cancelled' : session.state === 'ended' ? 'ended' : session.state === 'accepted' ? 'connecting' : 'ringing');
      setIsIncomingCall(session.state === 'ringing');
      setCallActive(!['rejected', 'cancelled', 'ended', 'expired', 'failed'].includes(session.state));
      setCallStatus(session.state === 'ringing' ? 'Incoming Call...' : session.state.charAt(0).toUpperCase() + session.state.slice(1));
    });
  }, [modern]);

  const acceptChangedIdentity = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.acceptChangedIdentity();
    setContactIdentity(await modern.getContact());
    setModernCallComposition(null);
  }, [modern]);

  const requestDeviceEnrollment = useCallback(async (deviceId: string, publicIdentityReference: string, algorithm: string): Promise<void> => {
    if (!modern) throw new Error('No modern conversation is open.');
    await modern.requestDeviceEnrollment({ requestedDeviceId: deviceId, requestedPublicIdentityReference: publicIdentityReference, algorithm });
    setDeviceLifecycleState(await modern.getDeviceLifecycleState());
  }, [modern]);

  const approveDeviceEnrollment = useCallback(async (): Promise<void> => {
    if (!modern || !pendingDeviceEnrollment) throw new Error('No device enrollment request is pending.');
    await modern.approveDeviceEnrollment(pendingDeviceEnrollment, { deviceId: pendingDeviceEnrollment.requestedDeviceId, publicIdentityReference: pendingDeviceEnrollment.requestedPublicIdentityReference });
    setPendingDeviceEnrollment(undefined);
    setDeviceLifecycleState(await modern.getDeviceLifecycleState());
  }, [modern, pendingDeviceEnrollment]);

  const rejectDeviceEnrollment = useCallback(async (): Promise<void> => {
    if (!modern || !pendingDeviceEnrollment) throw new Error('No device enrollment request is pending.');
    await modern.rejectDeviceEnrollment(pendingDeviceEnrollment);
    setPendingDeviceEnrollment(undefined);
  }, [modern, pendingDeviceEnrollment]);

  const revokeDevice = useCallback(async (deviceId: string): Promise<void> => {
    if (!modern) throw new Error('No modern conversation is open.');
    await modern.revokeDevice(deviceId);
    setDeviceLifecycleState(await modern.getDeviceLifecycleState());
  }, [modern]);

  // Join existing channel using the invitation's roomId + secret
  const joinChannel = useCallback(
    async (roomId: string, secret: string, controlCapability: string) => {
      if (!chat) throw new Error('Chat not initialized');
      try {
        if (modern) await modern.close();
        setModern(null);
        setModernCallComposition(null);
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
          const delivery = await modern!.send(text);
      addMessage({ ...displayMessage(userId, text, 'sent'), delivery });
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
    if (protocolMode === 'modern') {
      if (!modern) throw new Error('Modern conversation is not ready for calling.');
      const composition = modernCallComposition ?? await modern.createAuthenticatedCallComposition();
      setModernCallComposition(composition);
      const call = await composition.invite();
      setModernCallId(call.callId);
      setCallActive(true);
      setIsIncomingCall(false);
      setCallLifecycleState('ringing');
      setCallStatus('Ringing...');
      return;
    }
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
  }, [chat, modern, modernCallComposition, protocolMode]);

  const acceptCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modernCallComposition || !modernCallId) throw new Error('No authenticated incoming call is available.');
      await modernCallComposition.accept(modernCallId);
      return;
    }
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
  }, [chat, modernCallComposition, modernCallId, protocolMode]);

  const rejectCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modernCallComposition || !modernCallId) throw new Error('No authenticated incoming call is available.');
      await modernCallComposition.reject(modernCallId);
      setCallActive(false);
      setIsIncomingCall(false);
      return;
    }
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
  }, [chat, modernCallComposition, modernCallId, protocolMode]);

  const cancelCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modernCallComposition || !modernCallId) throw new Error('No authenticated outgoing call is available.');
      await modernCallComposition.cancel(modernCallId);
      setCallActive(false);
      setIsIncomingCall(false);
      return;
    }
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
  }, [chat, modernCallComposition, modernCallId, protocolMode]);

  // End call
  const endCall = useCallback(async () => {
    try {
      if (protocolMode === 'modern' && modernCallComposition && modernCallId) {
        await modernCallComposition.cancel(modernCallId);
      } else if (chat && protocolMode === 'legacy') {
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
  }, [chat, modernCallComposition, modernCallId, protocolMode]);

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
      const message = displayMessage(msg.sender, msg.message, 'received');
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
      setModernCallComposition(null);
      setModernCallId(undefined);
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
    deviceLifecycleState,
    pendingDeviceEnrollment,
    initializeChat,
    createNewChannel,
    createModernChannel,
    joinModernChannel,
    verifyContact,
    acceptChangedIdentity,
    requestDeviceEnrollment,
    approveDeviceEnrollment,
    rejectDeviceEnrollment,
    revokeDevice,
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
