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
import { bindPageHideCallTermination } from '../calls/pagehideTermination';
import { loadVodozemacBindings } from '../crypto/vodozemacModule';
import { readConversationDescriptors, removeConversationDescriptor, saveConversationDescriptor, type ConversationDescriptor } from '../product/sessionStore';
import { readProfileName, writeProfileName } from '../product/profileStore';
import { readPrivacyPreferences, writePrivacyPreferences, type PrivacyPreferences } from '../product/preferences';
import { deliverNotification } from '../product/notifications';
import { prepareMessageAcceptance, readMessages, writeMessages } from '../product/messageStore';

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
  const [profileDisplayName, setProfileDisplayNameState] = useState('You');
  const [accountState, setAccountState] = useState<'checking' | 'new' | 'locked' | 'ready'>('checking');
  const [sessionError, setSessionError] = useState<string>();
  const [sessionHealth, setSessionHealth] = useState<'healthy' | 'unhealthy' | 'renewal-pending'>('healthy');
  const [syncStatus, setSyncStatus] = useState<'unavailable' | 'recovering' | 'ready' | 'blocked'>('unavailable');
  const [privacyPreferences, setPrivacyPreferences] = useState<PrivacyPreferences>(readPrivacyPreferences);
  const privacyPreferencesRef = useRef(privacyPreferences);
  const [permissionStatus, setPermissionStatus] = useState<{ microphone: PermissionState | 'unknown'; camera: PermissionState | 'unknown' }>({ microphone: 'unknown', camera: 'unknown' });
  const acceptedDeliveries = useRef(new Set<string>());
  const endCallRef = useRef<() => Promise<void>>(async () => undefined);
  const callNegotiator = useRef<ProductionCallNegotiator>();
  const callSupportConversation = useRef<ModernConversation | null>(null);
  const callSupportInstallation = useRef<Promise<void> | null>(null);
  const callMediaUnsubscribe = useRef<(() => void) | null>(null);
  const callStateUnsubscribe = useRef<(() => void) | null>(null);
  const callProtocolUnsubscribe = useRef<(() => void) | null>(null);
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
  const callActiveRef = useRef(callActive);
  const modernCallIdRef = useRef(modernCallId);
  callActiveRef.current = callActive;
  modernCallIdRef.current = modernCallId;
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
      if (modern) await modern.close(false);
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
    setProfileDisplayNameState(await readProfileName(vault).catch(() => undefined) ?? 'You');
    setAccountState('ready');
    setSessionError(undefined);
    return vault;
  };

  const installModernCallSupport = async (conversation: ModernConversation): Promise<void> => {
    // Call signaling uses the conversation's established encrypted session.
    // Preparing call UI must not create an outbound messaging session before
    // the first peer message establishes the matching inbound session.
    if (!conversation.hasEstablishedSession()) return;
    if (callSupportConversation.current === conversation && callNegotiator.current) return;
    if (callSupportInstallation.current) {
      await callSupportInstallation.current;
      if (callSupportConversation.current === conversation && callNegotiator.current) return;
    }
    const installation = (async () => {
      const composition = await conversation.createAuthenticatedCallComposition();
      if (callSupportConversation.current === conversation && callNegotiator.current) return;

      // Replacing call support is only valid when the conversation changes. Tear
      // down the old subscriptions before disposal so its empty cleanup update
      // cannot erase state owned by the new negotiator.
      callMediaUnsubscribe.current?.();
      callMediaUnsubscribe.current = null;
      callStateUnsubscribe.current?.();
      callStateUnsubscribe.current = null;
      callProtocolUnsubscribe.current?.();
      callProtocolUnsubscribe.current = null;
      callNegotiator.current?.dispose();
      callNegotiator.current = new ProductionCallNegotiator(composition, new BrowserCallTransport(), async () => getRuntimeConfig().webrtc);
      setModernCallComposition(composition);
      callSupportConversation.current = conversation;
      callMediaUnsubscribe.current = callNegotiator.current.onMediaUpdate((update) => {
      if (update.callId !== modernCallIdRef.current) return;
      setLocalCallStream(update.local);
      // Empty updates are emitted by negotiator cleanup/disposal as well as
      // terminal paths. Preserve the active renderer until a real call end.
      if (update.remote) setRemoteCallStream(update.remote);
      if (update.local) setCameraEnabledState(update.local.getVideoTracks().some((track) => track.enabled && track.readyState === 'live'));
      if (update.state === 'connected') { setCallLifecycleState('connected'); setCallStatus('Connected'); }
      if (update.state === 'reconnecting') { setCallLifecycleState('connecting'); setCallStatus('Reconnecting...'); }
      if (update.state === 'failed') { setCallLifecycleState('ice-failed'); setCallStatus('Connection Failed'); }
      });
      callStateUnsubscribe.current = composition.onCallUpdate((session) => {
      const terminal = ['rejected', 'cancelled', 'ended', 'expired', 'failed'].includes(session.state);
      modernCallIdRef.current = terminal ? undefined : session.callId;
      setModernCallId(terminal ? undefined : session.callId);
      setCallMediaMode(session.mediaMode);
      setCallLifecycleState(session.state === 'inviting' || session.state === 'ringing' ? 'ringing' : session.state === 'accepted' || session.state === 'connecting' || session.state === 'reconnecting' ? 'connecting' : session.state === 'connected' ? 'connected' : session.state === 'rejected' ? 'rejected' : session.state === 'cancelled' ? 'cancelled' : session.state === 'expired' ? 'timeout' : session.state === 'ended' ? 'ended' : 'ice-failed');
      setIsIncomingCall(session.state === 'ringing');
      setCallActive(!terminal);
      setCallStatus(session.state === 'ringing' ? 'Incoming Call...' : session.state === 'inviting' ? 'Ringing...' : ['accepted', 'connecting'].includes(session.state) ? 'Connecting...' : session.state === 'reconnecting' ? 'Reconnecting...' : session.state === 'connected' ? 'Connected' : terminal ? `Call ${session.state}` : 'Calling...');
      if (terminal) {
        void callNegotiator.current?.end(session.callId).catch(() => undefined);
        clearCallMedia();
      }
      if (session.state === 'accepted' && !locallyAcceptedCalls.current.delete(session.callId)) {
        void callNegotiator.current?.prepareOutgoing(session).then(() => callNegotiator.current?.beginOffer(session.callId)).catch(() => {
          setCallLifecycleState('ice-failed');
          setCallStatus('Connection Failed');
          void callNegotiator.current?.end(session.callId).catch(() => undefined);
        });
      }
      });
      callProtocolUnsubscribe.current = composition.onProtocolIssue((issue) => {
        setCallError(issue.receivedVersion < issue.requiredVersion
          ? 'This contact needs a newer K3NCRYPT version to call.'
          : 'This call needs a newer K3NCRYPT version.');
      });
    })();
    callSupportInstallation.current = installation;
    try {
      await installation;
    } finally {
      if (callSupportInstallation.current === installation) callSupportInstallation.current = null;
    }
  };

  const connectModern = async (secureVault: BrowserSecureStorage, descriptor: ConversationDescriptor, sendJoinIntroduction = false): Promise<{ ownFingerprint: string; ownAddress: string; contact?: StoredContactIdentity }> => {
    setCallError(undefined);
    if (modern) await modern.close(false);
    setSyncStatus('recovering');
    setMessages(await readMessages(secureVault, descriptor.roomId));
    const conversation = new ModernConversation(secureVault, loadVodozemacBindings);
    conversation.onSessionHealthUpdate((health) => {
      setSessionHealth(health);
      setSessionError(health === 'healthy' ? undefined : health === 'renewal-pending'
        ? 'Verified renewal is waiting for an encrypted message to be accepted by your contact.'
        : 'This conversation’s encrypted session is missing. Saved identity, trust, and history remain available.');
      if (health === 'healthy') {
        void conversation.getDeviceTrust().then((trust) => setSyncStatus(trust === 'trusted' ? 'ready' : 'blocked'))
          .catch(() => setSyncStatus('blocked'));
        void installModernCallSupport(conversation).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
      }
    });
    conversation.onDeliveryUpdate((clientId, state) => {
      acceptedDeliveries.current.add(clientId);
      setMessages((current) => current.map((message) => message.id === clientId ? { ...message, delivery: state } : message));
    });
    try {
      const details = await conversation.connect(descriptor.roomId, descriptor.controlCapability, descriptor.remoteAddress, descriptor.remoteIdentityCommitment, async (text, envelopeId) => {
        const message = { ...displayMessage('contact', text, 'received'), id: envelopeId };
        const historyUpdate = await prepareMessageAcceptance(secureVault, descriptor.roomId, message);
        return {
          updates: [historyUpdate],
          afterCommit: async () => {
            setMessages((previous) => previous.some((item) => item.id === envelopeId) ? previous : [...previous, message]);
            deliverNotification({ kind: 'message', conversationId: descriptor.roomId, preview: message.text }, privacyPreferencesRef.current);
            if (conversation.hasEstablishedSession()) {
              const contact = await conversation.getContact();
              if (contact?.verification === 'verified' && contact.changeStatus === 'unchanged') {
                await installModernCallSupport(conversation).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
              }
            }
          }
        };
      }, async (contact) => {
        setContactIdentity(contact);
        if (contact.verification !== 'verified' || contact.changeStatus !== 'unchanged') {
          callMediaUnsubscribe.current?.();
          callMediaUnsubscribe.current = null;
          callStateUnsubscribe.current?.();
          callStateUnsubscribe.current = null;
          callProtocolUnsubscribe.current?.();
          callProtocolUnsubscribe.current = null;
          await callNegotiator.current?.dispose();
          callNegotiator.current = undefined;
          callSupportConversation.current = null;
          setModernCallComposition(null);
          setCallActive(false);
          setIsIncomingCall(false);
          setModernCallId(undefined);
        }
        if (contact.contactId && (!descriptor.remoteAddress || descriptor.remoteAddress !== contact.contactId || descriptor.remoteIdentityCommitment !== contact.identityId)) {
          const latestDescriptor = (await readConversationDescriptors(secureVault))
            .find((item) => item.roomId === descriptor.roomId) ?? descriptor;
          const updated = await saveConversationDescriptor(secureVault, {
            ...latestDescriptor,
            remoteAddress: contact.contactId,
            remoteIdentityCommitment: contact.identityId,
            updatedAt: Date.now(),
          });
          setConversations(updated);
        }
      }, (event: DeviceControlEvent) => {
        if (event.type === 'enrollment-request') setPendingDeviceEnrollment(event.payload as EnrollmentRequest);
        if (event.type === 'enrollment-approval') setPendingDeviceApproval(event.payload as EnrollmentApprovalPacket);
      }, { sendJoinIntroduction });
      setModern(conversation);
      const restoredSessionHealth = conversation.getSessionHealth();
      setSessionHealth(restoredSessionHealth);
      setModernCallComposition(null);
      setModernCallId(undefined);
      setProtocolMode('modern');
      setChannelHash(descriptor.roomId);
      setOwnFingerprint(details.ownFingerprint);
      // Mailbox replay is deliberately requested after authenticated join.
      // An inbound first message can establish an unverified contact during
      // that replay, so read the final durable contact state rather than
      // overwriting it with connect()'s pre-replay snapshot.
      const restoredContact = await conversation.getContact();
      setContactIdentity(restoredContact);
      if (restoredContact?.verification === 'verified' && restoredContact.changeStatus === 'unchanged' && conversation.hasEstablishedSession()) {
        await installModernCallSupport(conversation).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
      }
      setUserId(details.ownAddress);
      setDeviceLifecycleState(await conversation.getDeviceLifecycleState());

      setIsConnected(true);
      setSyncStatus(restoredSessionHealth !== 'healthy' ? 'blocked' : (await conversation.getDeviceTrust()) === 'trusted' ? 'ready' : 'blocked');
      setSessionError(restoredSessionHealth === 'unhealthy'
        ? 'This conversation’s encrypted session is missing. Your identity, verification, and saved messages remain available; sending and calls are paused until verified renewal.'
        : restoredSessionHealth === 'renewal-pending' ? 'Verified renewal awaits accepted encrypted delivery.' : undefined);
      return details;
    } catch (error) {
      setSessionHealth('unhealthy');

      await conversation.close(false).catch(() => undefined);
      setSyncStatus('blocked');
      const safeCategory = error && typeof error === 'object' && 'restoreFailureCategory' in error
        ? (error as { restoreFailureCategory?: unknown }).restoreFailureCategory : undefined;
      setSessionError(typeof safeCategory === 'string' && safeCategory === 'session-record-missing'
        ? 'The vault opened, but a saved encrypted session is missing. Keep this device data intact and contact support.'
        : 'Could not restore the encrypted account. Check the local passphrase and try again.');
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
    await connectModern(secureVault, descriptor, true);
    setConversations(await saveConversationDescriptor(secureVault, descriptor));
  }, [modern]);

  const updateProfileDisplayName = useCallback(async (name: string): Promise<void> => {
    if (!vault) throw new Error('Unlock this device before editing your profile.');
    const saved = await writeProfileName(vault, name);
    setProfileDisplayNameState(saved);
  }, [vault]);

  const setContactNickname = useCallback(async (roomId: string, nickname: string): Promise<void> => {
    if (!vault) throw new Error('Unlock this device before editing contacts.');
    const existing = conversations.find((item) => item.roomId === roomId);
    if (!existing) throw new Error('Saved contact is unavailable.');
    const trimmed = nickname.trim();
    if (!trimmed || trimmed.length > 80 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('Contact name must be 1–80 characters.');
    const label = trimmed.replace(/\s+/g, ' ');
    setConversations(await saveConversationDescriptor(vault, { ...existing, label, updatedAt: Date.now() }));
  }, [conversations, vault]);

  const restoreSession = useCallback(async (passphrase: string): Promise<void> => {
    const secureVault = await openModernVault(passphrase);
    const saved = await readConversationDescriptors(secureVault);
    setConversations(saved);
    if (!saved[0]) { setAccountState('ready'); return; }
    let missingSessionError: unknown;
    for (const descriptor of saved) {
      try {
        await connectModern(secureVault, descriptor);
        return;
      } catch (error) {
        // A missing record in one saved conversation must not prevent another
        // intact, independently validated conversation from opening. Preserve
        // the broken descriptor and all vault records for explicit recovery.
        const category = error && typeof error === 'object' && 'restoreFailureCategory' in error
          ? (error as { restoreFailureCategory?: unknown }).restoreFailureCategory : undefined;
        if (category !== 'session-record-missing') throw error;
        missingSessionError = error;
      }
    }
    throw missingSessionError;
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
    if (!contactIdentity) throw new Error('Contact identity is unavailable.');
    await modern.verifyContact(true, contactIdentity.identityId);
    setContactIdentity(await modern.getContact());
    if (modern.hasEstablishedSession()) await installModernCallSupport(modern);
  }, [modern, contactIdentity]);

  const unverifyContact = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.unverifyContact();
    callMediaUnsubscribe.current?.();
    callMediaUnsubscribe.current = null;
    callStateUnsubscribe.current?.();
    callStateUnsubscribe.current = null;
    callProtocolUnsubscribe.current?.();
    callProtocolUnsubscribe.current = null;
    await callNegotiator.current?.dispose();
    callNegotiator.current = undefined;
    callSupportConversation.current = null;
    setModernCallComposition(null);
    setContactIdentity(await modern.getContact());
  }, [modern]);

  const acceptChangedIdentity = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    await modern.acceptChangedIdentity();
    setContactIdentity(await modern.getContact());
    setModernCallComposition(null);
  }, [modern]);

  const prepareVerifiedSessionRenewal = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No private conversation is open.');
    await modern.prepareVerifiedSessionRenewal(true);
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
        if (modern) await modern.close(false);
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
      if (!userId || (protocolMode === 'legacy' && !chat) || (protocolMode === 'modern' && (!modern || !vault || !channelHash))) throw new Error('Chat not ready');
      const outgoing = { ...displayMessage(userId, text, 'sent'), delivery: 'pending' as const };
      try {
        if (protocolMode === 'modern') {
          const clientId = await modern!.sendWithReceipt(text, async (id) =>
            prepareMessageAcceptance(vault!, channelHash, { ...outgoing, id }));
          const accepted = acceptedDeliveries.current.delete(clientId);
          addMessage({ ...outgoing, id: clientId, delivery: accepted ? 'accepted' : 'pending' });
          const contact = await modern!.getContact();
          if (modern!.hasEstablishedSession() && contact?.verification === 'verified' && contact.changeStatus === 'unchanged') {
            await installModernCallSupport(modern!).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
          }
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
    [channelHash, chat, modern, protocolMode, userId, vault]
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
  useEffect(() => () => {
    callMediaUnsubscribe.current?.();
    callMediaUnsubscribe.current = null;
    callStateUnsubscribe.current?.();
    callStateUnsubscribe.current = null;
    callProtocolUnsubscribe.current?.();
    callProtocolUnsubscribe.current = null;
    callNegotiator.current?.dispose();
    callNegotiator.current = undefined;
    callSupportConversation.current = null;
  }, []);

  // Start call
  const startCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      setCallError(undefined);
      if (!modern) throw new Error('Modern conversation is not ready for calling.');
      const composition = modernCallComposition ?? await modern.createAuthenticatedCallComposition();
      setModernCallComposition(composition);
      if (!callNegotiator.current) throw new Error('Authenticated call media is not ready. Reverify this contact.');
      await composition.invite();
      return;
    }
    throw new Error('Verification required: legacy conversations have no local contact verification authority.');
  }, [chat, modern, modernCallComposition, protocolMode]);

  const startVideoCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      setCallError(undefined);
      if (!modern) throw new Error('Modern conversation is not ready for calling.');
      const composition = modernCallComposition ?? await modern.createAuthenticatedCallComposition();
      setModernCallComposition(composition);
      if (!callNegotiator.current) throw new Error('Authenticated call media is not ready. Reverify this contact.');
      await composition.invite('video');
      return;
    }
    throw new Error('Verification required: legacy conversations have no local contact verification authority.');
  }, [chat, modern, modernCallComposition, protocolMode]);

  const acceptCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      if (!modernCallComposition || !modernCallId) throw new Error('No authenticated incoming call is available.');
      const incoming = await modernCallComposition.service.get(modernCallId);
      if (!incoming) throw new Error('Incoming call is unavailable.');
      try {
        await callNegotiator.current?.acceptIncoming(incoming);
        locallyAcceptedCalls.current.add(modernCallId);
        await modernCallComposition.accept(modernCallId);
      } catch (error) {
        locallyAcceptedCalls.current.delete(modernCallId);
        await callNegotiator.current?.end(modernCallId).catch(() => undefined);
        throw error;
      }
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
    const activeCallId = modernCallId;
    const negotiator = callNegotiator.current;
    const composition = modernCallComposition;
    const termination = protocolMode === 'modern' && composition && activeCallId
      ? (negotiator ? negotiator.end(activeCallId) : composition.end(activeCallId))
      : chat && protocolMode === 'legacy'
        ? chat.endCall()
        : Promise.resolve();
    // Hide the call UI immediately; the negotiator keeps media alive only until
    // the authenticated terminal signal is attempted, then releases it.
    setCallActive(false);
    setIsIncomingCall(false);
    setCallDuration(0);
    setModernCallId(undefined);
    setCallLifecycleState('ended');
    setCallStatus('Call Ended');
    clearCallMedia();
    try {
      await termination;
    } catch (err) {
      debugError('Call end failed', err);
    }
  }, [chat, clearCallMedia, modernCallComposition, modernCallId, protocolMode]);
  endCallRef.current = endCall;

  useEffect(() => {
    if (!modern) return;
    return modern.onPeerDisconnect(() => {
      if (callActiveRef.current) void endCallRef.current();
    });
  }, [modern]);

  useEffect(() => {
    if (!callActive || protocolMode !== 'modern' || !modernCallId) return;
    return bindPageHideCallTermination(window, () => {
      const termination = isIncomingCall
        ? rejectCall()
        : callLifecycleState === 'ringing'
          ? cancelCall()
          : endCall();
      return termination;
    });
  }, [callActive, callLifecycleState, cancelCall, endCall, isIncomingCall, modernCallId, protocolMode, rejectCall]);

  const setMicrophoneMuted = useCallback((muted: boolean): void => {
    if (protocolMode === 'modern') {
      callNegotiator.current?.setMicrophoneEnabled(!muted);
      setMicrophoneMutedState(muted);
      return;
    }
    const call = activeLegacyCall.current;
    if (!call) return;
    call.setMicrophoneEnabled(!muted);
    setMicrophoneMutedState(muted);
  }, [protocolMode]);

  const setCameraEnabled = useCallback((enabled: boolean): void => {
    if (protocolMode === 'modern') {
      callNegotiator.current?.setCameraEnabled(enabled);
      setCameraEnabledState(enabled);
      return;
    }
    const call = activeLegacyCall.current;
    if (!call || !call.localStream?.getVideoTracks().length) return;
    call.setCameraEnabled(enabled);
    setCameraEnabledState(enabled);
  }, [protocolMode]);

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
      if (callActiveRef.current && !modernCallIdRef.current) {
        void chatInstance.endCall().catch(() => undefined);
      }
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

    chatInstance.on('call-invite', () => {
      void chatInstance.rejectCall().catch(() => undefined);
      setCallError('Verification required: legacy conversations have no local contact verification authority.');
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
    profileDisplayName,
    accountState,
    sessionError,
    sessionHealth,
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
    unverifyContact,
    acceptChangedIdentity,
    prepareVerifiedSessionRenewal,
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
    updateProfileDisplayName,
    setContactNickname,
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
