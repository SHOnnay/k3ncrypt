/**
 * Chat context provider for explicit legacy and modern service paths.
 */

import React, { createContext, useContext, ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { createChatInstance, utils, BrowserSecureStorage, IndexedDbVaultPersistence, ModernConversation, parseEncryptedMediaMessage, BrowserCallTransport, ProductionCallNegotiator } from '@chat-e2ee/service';
import type { IChatE2EE, IE2ECall, CallLifecycleState, CallLifecycleUpdate, StoredContactIdentity, AuthenticatedCallComposition, EnrollmentRequest, EnrollmentApprovalPacket, DeviceControlEvent, LifecycleStateSnapshot } from '@chat-e2ee/service';
import { ChatContextType, InviteInfo, Message } from '../types/index';
import { createMessage } from '../utils/messageHandling';
import { playBeep } from '../utils/audioNotification';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { debugError } from '../utils/debug';
import { loadVodozemacBindings } from '../crypto/vodozemacModule';
import { readConversationDescriptors, removeConversationDescriptor, saveConversationDescriptor, type ConversationDescriptor } from '../product/sessionStore';
import { readPrivacyPreferences, writePrivacyPreferences, type PrivacyPreferences } from '../product/preferences';
import { deliverNotification } from '../product/notifications';
import { readMessages, writeMessages } from '../product/messageStore';

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
  const [pendingDeviceApproval, setPendingDeviceApproval] = useState<EnrollmentApprovalPacket>();
  const [vault, setVault] = useState<BrowserSecureStorage>();
  const [conversations, setConversations] = useState<ConversationDescriptor[]>([]);
  const [accountState, setAccountState] = useState<'checking' | 'new' | 'locked' | 'ready'>('checking');
  const [sessionError, setSessionError] = useState<string>();
  const [syncStatus, setSyncStatus] = useState<'unavailable' | 'recovering' | 'ready' | 'blocked'>('unavailable');
  const [privacyPreferences, setPrivacyPreferences] = useState<PrivacyPreferences>(readPrivacyPreferences);
  const privacyPreferencesRef = useRef(privacyPreferences);
  const [permissionStatus, setPermissionStatus] = useState<{ microphone: PermissionState | 'unknown'; camera: PermissionState | 'unknown' }>({ microphone: 'unknown', camera: 'unknown' });
  const acceptedDeliveries = useRef(new Set<string>());
  const callNegotiator = useRef<ProductionCallNegotiator>();
  const locallyAcceptedCalls = useRef(new Set<string>());
  const [userId, setUserId] = useState<string>('');
  const [channelHash, setChannelHash] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [callActive, setCallActive] = useState<boolean>(false);
  const [callStatus, setCallStatus] = useState<string>('');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [callLifecycleState, setCallLifecycleState] = useState<CallLifecycleState>('idle');
  const [isIncomingCall, setIsIncomingCall] = useState<boolean>(false);
  const [callMediaMode, setCallMediaMode] = useState<'audio' | 'video'>('audio');
  const [localCallStream, setLocalCallStream] = useState<MediaStream>();
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream>();
  const [microphoneMuted, setMicrophoneMutedState] = useState(false);
  const [cameraEnabled, setCameraEnabledState] = useState(false);
  const [callError, setCallError] = useState<string>();
  const activeLegacyCall = useRef<IE2ECall>();
  const callMediaPoll = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => { privacyPreferencesRef.current = privacyPreferences; }, [privacyPreferences]);
  // Chat message decryption happens inside the SDK; only plaintext ever
  // reaches this context. No private key material is held here any more.

  // Initialize chat service (no modifications)
  const initializeChat = useCallback(async () => {
    try {
      const chatInstance = createChatInstance(getRuntimeConfig());
      await chatInstance.init();
      setChat(chatInstance);
      const metadata = await new IndexedDbVaultPersistence().loadMetadata();
      setAccountState(metadata ? 'locked' : 'new');
    } catch (err) {
      debugError('Chat initialization failed', err);
      throw err;
    }
  }, []);

  const refreshPermissionStatus = useCallback(async (): Promise<void> => {
    if (!navigator.permissions?.query) return;
    const query = async (name: 'microphone' | 'camera'): Promise<PermissionState | 'unknown'> => {
      try { return (await navigator.permissions.query({ name: name as PermissionName })).state; } catch { return 'unknown'; }
    };
    setPermissionStatus({ microphone: await query('microphone'), camera: await query('camera') });
  }, []);

  useEffect(() => { void refreshPermissionStatus(); }, [refreshPermissionStatus]);

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
    setVault(vault);
    setAccountState('ready');
    setSessionError(undefined);
    return vault;
  };

  const connectModern = async (secureVault: BrowserSecureStorage, descriptor: ConversationDescriptor): Promise<{ ownFingerprint: string; ownAddress: string; contact?: StoredContactIdentity }> => {
    if (modern) await modern.close();
    setSyncStatus('recovering');
    setMessages(await readMessages(secureVault, descriptor.roomId));
    const conversation = new ModernConversation(secureVault, loadVodozemacBindings);
    conversation.onDeliveryUpdate((clientId, state) => {
      acceptedDeliveries.current.add(clientId);
      setMessages((current) => current.map((message) => message.id === clientId ? { ...message, delivery: state } : message));
    });
    try {
      const details = await conversation.connect(descriptor.roomId, descriptor.controlCapability, descriptor.remoteAddress, descriptor.remoteIdentityCommitment, (text) => {
        const message = displayMessage('contact', text, 'received');
        setMessages((previous) => [...previous, message]);
        deliverNotification({ kind: 'message', conversationId: descriptor.roomId, preview: message.text }, privacyPreferencesRef.current);
      }, setContactIdentity, (event: DeviceControlEvent) => {
        if (event.type === 'enrollment-request') setPendingDeviceEnrollment(event.payload as EnrollmentRequest);
        if (event.type === 'enrollment-approval') setPendingDeviceApproval(event.payload as EnrollmentApprovalPacket);
      });
      setModern(conversation);
      setModernCallComposition(null);
      setModernCallId(undefined);
      setProtocolMode('modern');
      setChannelHash(descriptor.roomId);
      setOwnFingerprint(details.ownFingerprint);
      setContactIdentity(details.contact);
      setUserId(details.ownAddress);
      setDeviceLifecycleState(await conversation.getDeviceLifecycleState());
      setIsConnected(true);
      setSyncStatus((await conversation.getDeviceTrust()) === 'trusted' ? 'ready' : 'blocked');
      setSessionError(undefined);
      return details;
    } catch (error) {
      await conversation.close().catch(() => undefined);
      setSyncStatus('blocked');
      setSessionError(error instanceof Error ? error.message : 'Could not open the private session.');
      throw error;
    }
  };

  useEffect(() => {
    if (vault && channelHash && protocolMode === 'modern') void writeMessages(vault, channelHash, messages).catch((error) => debugError('Message history persistence failed', error));
  }, [channelHash, messages, protocolMode, vault]);

  const createModernChannel = useCallback(async (passphrase: string): Promise<string> => {
    if (!chat) throw new Error('Chat not initialized');
    const invite = await chat.getLink();
    const secureVault = await openModernVault(passphrase);
    const descriptor: ConversationDescriptor = { version: 1, roomId: invite.hash, controlCapability: invite.controlCapability, label: 'Private contact', updatedAt: Date.now() };
    const details = await connectModern(secureVault, descriptor);
    setConversations(await saveConversationDescriptor(secureVault, descriptor));
    const fragment = `modern=${encodeURIComponent(invite.hash)}&control=${encodeURIComponent(invite.controlCapability)}&address=${encodeURIComponent(details.ownAddress)}&identity=${encodeURIComponent(details.ownFingerprint)}`;
    return `${window.location.origin}${window.location.pathname}#${fragment}`;
  }, [chat, modern]);

  const joinModernChannel = useCallback(async (roomId: string, capability: string, address: string, identityCommitment: string, passphrase: string): Promise<void> => {
    const secureVault = await openModernVault(passphrase);
    const descriptor: ConversationDescriptor = { version: 1, roomId, controlCapability: capability, remoteAddress: address, remoteIdentityCommitment: identityCommitment, label: 'Private contact', updatedAt: Date.now() };
    await connectModern(secureVault, descriptor);
    setConversations(await saveConversationDescriptor(secureVault, descriptor));
  }, [modern]);

  const restoreSession = useCallback(async (passphrase: string): Promise<void> => {
    const secureVault = await openModernVault(passphrase);
    const saved = await readConversationDescriptors(secureVault);
    setConversations(saved);
    if (!saved[0]) { setAccountState('ready'); return; }
    await connectModern(secureVault, saved[0]);
  }, [modern]);

  const openConversation = useCallback(async (roomId: string): Promise<void> => {
    if (roomId === channelHash && modern) return;
    if (!vault) throw new Error('Unlock this device before opening a conversation.');
    const descriptor = conversations.find((item) => item.roomId === roomId);
    if (!descriptor) throw new Error('Conversation is unavailable.');
    setMessages([]);
    await connectModern(vault, descriptor);
  }, [channelHash, conversations, modern, vault]);

  const verifyContact = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.verifyContact(true);
    setContactIdentity(await modern.getContact());
    const composition = await modern.createAuthenticatedCallComposition();
    setModernCallComposition(composition);
    callNegotiator.current?.dispose();
    callNegotiator.current = new ProductionCallNegotiator(composition, new BrowserCallTransport(), async () => getRuntimeConfig().webrtc);
    composition.onCallUpdate((session) => {
      setModernCallId(session.callId);
      setCallLifecycleState(session.state === 'inviting' ? 'ringing' : session.state === 'rejected' ? 'rejected' : session.state === 'cancelled' ? 'cancelled' : session.state === 'ended' ? 'ended' : session.state === 'accepted' ? 'connecting' : 'ringing');
      setIsIncomingCall(session.state === 'ringing');
      setCallActive(!['rejected', 'cancelled', 'ended', 'expired', 'failed'].includes(session.state));
      setCallStatus(session.state === 'ringing' ? 'Incoming Call...' : session.state.charAt(0).toUpperCase() + session.state.slice(1));
      if (session.state === 'accepted' && !locallyAcceptedCalls.current.delete(session.callId)) {
        void callNegotiator.current?.beginOffer(session.callId).catch(() => setCallStatus('Connection Failed'));
      }
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

  const confirmDeviceEnrollment = useCallback(async (): Promise<void> => {
    if (!modern || !pendingDeviceApproval) throw new Error('No device enrollment approval is pending.');
    await modern.confirmDeviceEnrollment(pendingDeviceApproval);
    setPendingDeviceApproval(undefined);
    setDeviceLifecycleState(await modern.getDeviceLifecycleState());
  }, [modern, pendingDeviceApproval]);

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
      const outgoing = { ...displayMessage(userId, text, 'sent'), delivery: 'pending' as const };
      try {
        if (protocolMode === 'modern') {
          const clientId = await modern!.sendWithReceipt(text);
          const accepted = acceptedDeliveries.current.delete(clientId);
          addMessage({ ...outgoing, id: clientId, delivery: accepted ? 'accepted' : 'pending' });
          return;
        }
        await chat!.encrypt({ text, image: '' }).send();
        addMessage({ ...outgoing, delivery: 'accepted' });
      } catch (err) {
        addMessage({ ...outgoing, delivery: 'failed' });
        debugError('Message send failed', err);
        throw err;
      }
    },
    [chat, modern, protocolMode, userId]
  );

  const retryMessage = useCallback(async (messageId: string): Promise<void> => {
    const failed = messages.find((message) => message.id === messageId && message.type === 'sent');
    if (!failed) throw new Error('Message retry is unavailable.');
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'pending' } : message));
    try {
      if (protocolMode === 'modern') await modern?.retryPending();
      else {
        if (!chat) throw new Error('Chat is unavailable.');
        await chat.encrypt({ text: failed.text, image: '' }).send();
        setMessages((current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'accepted' } : message));
      }
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'failed' } : message));
      throw error;
    }
  }, [chat, messages, modern, protocolMode]);

  useEffect(() => {
    const retry = () => { if (modern) void modern.retryPending(); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [modern]);

  const updatePrivacyPreferences = useCallback((next: Partial<PrivacyPreferences>): void => {
    setPrivacyPreferences((current) => writePrivacyPreferences({ ...current, ...next, analytics: false }));
  }, []);

  const attachmentRequestHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!modern || protocolMode !== 'modern') throw new Error('Protected media requires a modern private session.');
    return modern.attachmentAuthorizationHeaders();
  }, [modern, protocolMode]);

  const describeMediaError = (error: unknown, mediaMode: 'audio' | 'video'): string => {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return mediaMode === 'video' ? 'Camera permission is required for video calls.' : 'Microphone permission is required for calls.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return mediaMode === 'video' ? 'No camera or microphone was found.' : 'No microphone was found.';
    if (name === 'NotSupportedError') return 'This browser does not support video calls.';
    return error instanceof Error ? error.message : 'Unable to start the call.';
  };

  const clearCallMedia = useCallback((): void => {
    if (callMediaPoll.current) clearInterval(callMediaPoll.current);
    callMediaPoll.current = undefined;
    activeLegacyCall.current = undefined;
    setLocalCallStream(undefined);
    setRemoteCallStream(undefined);
    setMicrophoneMutedState(false);
    setCameraEnabledState(false);
    setCallMediaMode('audio');
  }, []);

  const reflectCallMedia = useCallback((call: IE2ECall): void => {
    setLocalCallStream(call.localStream);
    setRemoteCallStream(call.remoteStream);
    setCameraEnabledState(Boolean(call.localStream?.getVideoTracks().some((track) => track.enabled && track.readyState === 'live')));
  }, []);

  const setupLegacyCallMedia = useCallback((call: IE2ECall): void => {
    if (callMediaPoll.current) clearInterval(callMediaPoll.current);
    activeLegacyCall.current = call;
    setCallMediaMode(call.mediaKind);
    reflectCallMedia(call);
    // WebRTC publishes streams asynchronously. This observes SDK-owned media
    // state for rendering; it does not create a second media lifecycle.
    callMediaPoll.current = setInterval(() => reflectCallMedia(call), 250);
  }, [reflectCallMedia]);

  useEffect(() => () => { if (callMediaPoll.current) clearInterval(callMediaPoll.current); }, []);

  // Start call
  const startCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modern) throw new Error('Modern conversation is not ready for calling.');
      const composition = modernCallComposition ?? await modern.createAuthenticatedCallComposition();
      setModernCallComposition(composition);
      const call = await composition.invite();
      await callNegotiator.current?.prepareOutgoing(call);
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
      setCallMediaMode('audio');
      setCallError(undefined);
      setCallActive(true);
       setIsIncomingCall(false);
      setCallLifecycleState('ringing');
      setCallStatus('Ringing...');
      setupCallListeners(call);
    } catch (err) {
      debugError('Call start failed', err);
      const message = describeMediaError(err, 'audio');
      setCallError(message);
      throw new Error(message);
    }
  }, [chat, modern, modernCallComposition, protocolMode]);

  const startVideoCall = useCallback(async () => {
    if (protocolMode === 'modern') throw new Error('Video calls are not available for this session yet.');
    if (!chat) throw new Error('Chat not initialized');
    try {
      setCallMediaMode('video');
      setCallError(undefined);
      const call = await chat.startVideoCall();
      setCallActive(true);
      setIsIncomingCall(false);
      setCallLifecycleState('ringing');
      setCallStatus('Ringing...');
      setupCallListeners(call);
    } catch (error) {
      const message = describeMediaError(error, 'video');
      setCallError(message);
      setCallMediaMode('audio');
      throw new Error(message);
    }
  }, [chat, protocolMode]);

  const acceptCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modernCallComposition || !modernCallId) throw new Error('No authenticated incoming call is available.');
      const incoming = await modernCallComposition.service.get(modernCallId);
      if (!incoming) throw new Error('Incoming call is unavailable.');
      await callNegotiator.current?.acceptIncoming(incoming);
      locallyAcceptedCalls.current.add(modernCallId);
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
        await callNegotiator.current?.end(modernCallId);
        await modernCallComposition.cancel(modernCallId).catch(() => undefined);
      } else if (chat && protocolMode === 'legacy') {
        await chat.endCall();
      }
      setCallActive(false);
      setIsIncomingCall(false);
      setCallDuration(0);
      setCallLifecycleState('ended');
      setCallStatus('Call Ended');
      clearCallMedia();
    } catch (err) {
      debugError('Call end failed', err);
    }
  }, [chat, clearCallMedia, modernCallComposition, modernCallId, protocolMode]);

  const setMicrophoneMuted = useCallback((muted: boolean): void => {
    const call = activeLegacyCall.current;
    if (!call) return;
    call.setMicrophoneEnabled(!muted);
    setMicrophoneMutedState(muted);
  }, []);

  const setCameraEnabled = useCallback((enabled: boolean): void => {
    const call = activeLegacyCall.current;
    if (!call || !call.localStream?.getVideoTracks().length) return;
    call.setCameraEnabled(enabled);
    setCameraEnabledState(enabled);
  }, []);

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
      deliverNotification({ kind: 'message', conversationId: channelHash || 'legacy', preview: message.text }, privacyPreferencesRef.current);
    });

    chatInstance.on('call-added', (call: IE2ECall) => {
      setCallActive(true);
      setIsIncomingCall(false);
      setupCallListeners(call);
    });

    chatInstance.on('call-invite', (invite: { mediaKind?: 'audio' | 'video' }) => {
      setCallActive(true);
      setIsIncomingCall(true);
      setCallMediaMode(invite.mediaKind ?? 'audio');
      setCallLifecycleState('incoming');
      setCallStatus('Incoming Call...');
      playBeep();
      deliverNotification({ kind: 'incoming-call', conversationId: channelHash || 'legacy' }, privacyPreferencesRef.current);
    });

    chatInstance.on('call-state-changed', (update: CallLifecycleUpdate) => {
      setCallLifecycleState(update.state);
      setCallStatus(formatCallStatus(update.state));
      if (update.state === 'incoming') {
        setCallActive(true);
      }
      if (['ended', 'rejected', 'timeout', 'cancelled', 'no-peer', 'media-denied', 'signaling-failed', 'ice-failed'].includes(update.state)) {
        if (update.state === 'timeout') deliverNotification({ kind: 'missed-call', conversationId: channelHash || 'legacy' }, privacyPreferencesRef.current);
        setCallActive(false);
        setIsIncomingCall(false);
        setCallDuration(0);
      }
    });

    chatInstance.on('call-removed', () => {
      setCallActive(false);
      setIsIncomingCall(false);
      setCallDuration(0);
      clearCallMedia();
    });
  };

  // Setup call listeners
  const setupCallListeners = (call: IE2ECall) => {
    setupLegacyCallMedia(call);
    call.on('state-changed', async () => {
      const state = call.state;
      setCallStatus(state.charAt(0).toUpperCase() + state.slice(1));

      if (state === 'closed' || state === 'failed') {
        setCallActive(false);
        setIsIncomingCall(false);
        setCallDuration(0);
        setCallLifecycleState(state === 'failed' ? 'ice-failed' : 'ended');
        setCallStatus(state === 'failed' ? 'Connection Failed' : 'Call Ended');
        clearCallMedia();
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
      if (vault && channelHash) setConversations(await removeConversationDescriptor(vault, channelHash));
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
  }, [chat, channelHash, modern, protocolMode, vault]);

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
    callMediaMode,
    localCallStream,
    remoteCallStream,
    microphoneMuted,
    cameraEnabled,
    callError,
    protocolMode,
    ownFingerprint,
    contactIdentity,
    deviceLifecycleState,
    pendingDeviceEnrollment,
    pendingDeviceApproval,
    conversations,
    accountState,
    sessionError,
    syncStatus,
    privacyPreferences,
    permissionStatus,
    initializeChat,
    restoreSession,
    openConversation,
    createNewChannel,
    createModernChannel,
    joinModernChannel,
    verifyContact,
    acceptChangedIdentity,
    requestDeviceEnrollment,
    approveDeviceEnrollment,
    rejectDeviceEnrollment,
    confirmDeviceEnrollment,
    revokeDevice,
    joinChannel,
    sendMessage,
    retryMessage,
    startCall,
    startVideoCall,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    setMicrophoneMuted,
    setCameraEnabled,
    addMessage,
    setCallDuration,
    deleteChannel,
    updatePrivacyPreferences,
    refreshPermissionStatus,
    attachmentRequestHeaders,
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
