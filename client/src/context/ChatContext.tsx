import { probeConversationRoom } from '../product/conversationRoom';
import { ConversationSelection } from '../product/conversationSelection';
import { conversationEligibility, conversationFailure, readConversationIndex } from '../product/conversationEligibility';
import { classifySafeDiagnostic, type SafeDiagnosticCode } from '../product/safeDiagnostics';
import { LocalCallHistory } from '../product/callHistory';
import { parseFileReference } from '@chat-e2ee/service';
/**
 * Chat context provider for explicit legacy and modern service paths.
 */

import React, { createContext, useContext, ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { createChatInstance, utils, BrowserSecureStorage, IndexedDbVaultPersistence, ModernConversation, parseEncryptedMediaMessage, BrowserCallTransport, ProductionCallNegotiator, MultiplexedRelayConnection, ContactIdentityRegistry, ConversationModeStore } from '@chat-e2ee/service';
import type { IChatE2EE, IE2ECall, CallLifecycleState, CallLifecycleUpdate, StoredContactIdentity, AuthenticatedCallComposition, EnrollmentRequest, EnrollmentApprovalPacket, DeviceControlEvent, LifecycleStateSnapshot, ModernConnectionDetails } from '@chat-e2ee/service';
import { ChatContextType, InviteInfo, Message } from '../types/index';
import { createMessage } from '../utils/messageHandling';
import { playBeep } from '../utils/audioNotification';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { debugError } from '../utils/debug';
import { bindPageHideCallTermination } from '../calls/pagehideTermination';
import { loadVodozemacBindings } from '../crypto/vodozemacModule';
import { readConversationDescriptors, removeConversationDescriptor, saveConversationDescriptor, type ConversationDescriptor } from '../product/sessionStore';
import { readProfileName, readLocalProfile, writeProfileName } from '../product/profileStore';
import { readPrivacyPreferences, writePrivacyPreferences, type PrivacyPreferences } from '../product/preferences';
import { deliverNotification } from '../product/notifications';
import { prepareHeldTextRetry, prepareMessageAcceptance, readMessages, writeMessages } from '../product/messageStore';
import { createRoomState, updateRoomState, type RoomState } from '../product/roomState';

import { PROFILE_PREFIX, decodeProfileMessage, encodeProfileMessage, prepareProfileAcceptance } from '../product/profileMetadata';

const ChatContext = createContext<ChatContextType | undefined>(undefined);
const MUX_STAGE1_ENABLED = (() => {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_K3NCRYPT_MUX_STAGE1?: string } }).env;
  return env?.DEV === true && env.VITE_K3NCRYPT_MUX_STAGE1 === 'true';
})();

const callSetupFailure = (error: unknown): { kind: 'verification-required' | 'media-denied' | 'media-failed' | 'signaling-failed'; message: string } => {
  const source = error instanceof Error ? error.message.toLowerCase() : '';
  if (source.includes('verification') || source.includes('identity') || source.includes('review')) {
    return { kind: 'verification-required', message: 'Verification required. Reverify this contact before calling.' };
  }
  if (source.includes('permission') || source.includes('denied') || source.includes('dismissed')) {
    return { kind: 'media-denied', message: 'Microphone or camera permission was denied or dismissed. Allow the required permission and retry.' };
  }
  if (source.includes('camera')) return { kind: 'media-failed', message: 'Camera is unavailable. Check the camera and try again.' };
  if (source.includes('microphone')) return { kind: 'media-failed', message: 'Microphone is unavailable. Check the microphone and try again.' };
  if (source.includes('media') || source.includes('capture') || source.includes('device')) {
    return { kind: 'media-failed', message: 'Call media is unavailable. Check the microphone and camera, then retry.' };
  }
  return { kind: 'signaling-failed', message: 'Call negotiation could not start. Check your connection and retry.' };
};

const callStartDiagnostic = (stage: 'conversation' | 'support' | 'composition' | 'invite', error?: unknown): void => {
  const diagnostics = globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean };
  if (process.env.NODE_ENV !== 'production' && diagnostics.__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ === true) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const reason = message.includes('device') && message.includes('trust') ? 'device-trust'
      : message.includes('identity') || message.includes('verification') ? 'identity-authority'
        : message.includes('session') ? 'session'
          : message.includes('closed') || message.includes('not ready') || message.includes('unavailable') ? 'not-ready'
            : message.includes('socket') || message.includes('transport') || message.includes('network') || message.includes('fetch') || message.includes('send') ? 'transport'
              : message.includes('call') || message.includes('state') ? 'call-state' : 'unknown';
    console.info(`k3ncrypt-call-start-failed:${stage}:${reason}`);
  }
};

const conversationOpenStage = (stage: 'started' | 'same-room' | 'eligible' | 'candidate-started' | 'history-loaded' | 'candidate-connect-started' | 'session-connected' | 'connected' | 'failed'): void => {
  const diagnostics = globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean };
  if (process.env.NODE_ENV !== 'production' && diagnostics.__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ === true && typeof document !== 'undefined') {
    document.documentElement.dataset.k3ncryptConversationOpen = stage;
    console.info(`k3ncrypt-conversation-open:${stage}`);
  }
};

const displayMessage = (sender: string, text: string, type: Message['type']): Message => {
  if (text.startsWith('k3ncrypt-file-')) {
    try { const r = parseFileReference(text); return { ...createMessage(sender, 'Protected file', type), media: { kind: 'file', size: r.context.fileSize, reference: text } }; }
    catch { return createMessage(sender, 'Protected file unavailable', type); }
  }
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
  const selectedConversation = useRef<ModernConversation>();
  const muxConnection = useRef<MultiplexedRelayConnection>();
  const muxRoomIds = useRef(new Set<string>());
  const muxDetails = useRef(new Map<string, ModernConnectionDetails>());
  const muxConversations = useRef(new WeakSet<ModernConversation>());
  const selections = useRef(new ConversationSelection());
  const [unavailableConversations, setUnavailableConversations] = useState<SafeDiagnosticCode[]>([]);
  const [conversations, setConversations] = useState<ConversationDescriptor[]>([]);
  const sentProfiles = useRef(new WeakMap<ModernConversation, number>());
  const [profileDisplayName, setProfileDisplayNameState] = useState('You');
  const [accountState, setAccountState] = useState<'checking' | 'new' | 'locked' | 'ready'>('checking');
  const [sessionError, setSessionError] = useState<string>();
  const [sessionHealth, setSessionHealth] = useState<'healthy' | 'unhealthy' | 'renewal-pending'>('healthy');
  const [syncStatus, setSyncStatus] = useState<'unavailable' | 'recovering' | 'ready' | 'blocked'>('unavailable');
  const [privacyPreferences, setPrivacyPreferences] = useState<PrivacyPreferences>(readPrivacyPreferences);
  const privacyPreferencesRef = useRef(privacyPreferences);
  const [permissionStatus, setPermissionStatus] = useState<{ microphone: PermissionState | 'unknown'; camera: PermissionState | 'unknown' }>({ microphone: 'unknown', camera: 'unknown' });
  const acceptedDeliveries = useRef(new Set<string>());
  const rejectedDeliveries = useRef(new Set<string>());
  const endCallRef = useRef<() => Promise<void>>(async () => undefined);
  const callNegotiator = useRef<ProductionCallNegotiator>();
  const modernCallCompositionRef = useRef<AuthenticatedCallComposition | null>(modernCallComposition);
  const verificationTerminationRef = useRef<() => Promise<void>>(async () => undefined);
  const verificationTerminationPending = useRef<Promise<void>>();
  const callSupportConversation = useRef<ModernConversation | null>(null);
  const callSupportInstallation = useRef<Promise<void> | null>(null);
  const callMediaUnsubscribe = useRef<(() => void) | null>(null);
  const callMediaFailureRef = useRef<'microphone-unavailable' | 'camera-unavailable' | undefined>();
  const callStateUnsubscribe = useRef<(() => void) | null>(null);
  const callProtocolUnsubscribe = useRef<(() => void) | null>(null);
  const locallyAcceptedCalls = useRef(new Set<string>());
  const [userId, setUserId] = useState<string>('');
  const [channelHash, setChannelHash] = useState<string>('');
  const [roomStates, setRoomStates] = useState<Record<string, RoomState<ModernConversation>>>({});
  const roomStatesRef = useRef(roomStates); roomStatesRef.current = roomStates;
  const [pendingConversation, setPendingConversation] = useState<{ roomId: string; operationId: number }>();
  const [conversationOpenError, setConversationOpenError] = useState<{ roomId: string; operationId: number; code: SafeDiagnosticCode }>();
  const conversationOpenGeneration = useRef(0);
  const [activeCallRoomId, setActiveCallRoomId] = useState<string>();
  const activeRoom = channelHash ? roomStates[channelHash] : undefined;
  const messages = activeRoom?.messages ?? [];
  const setRoomState = useCallback((roomId: string, update: Partial<Omit<RoomState<ModernConversation>, 'roomId'>>) => {
    setRoomStates(current => updateRoomState(current, roomId, update));
  }, []);
  const setRoomMessages = useCallback((roomId: string, update: Message[] | ((current: Message[]) => Message[])) => {
    setRoomStates((current) => {
      const previous = current[roomId]?.messages ?? createRoomState(roomId).messages;
      const next = typeof update === 'function' ? update(previous) : update;
      return next === previous ? current : updateRoomState(current, roomId, { messages: next });
    });
  }, []);
  const addMessage = useCallback((roomId: string, message: Message) => {
    setRoomMessages(roomId, (current) => [...current, message]);
  }, [setRoomMessages]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const localCallHistory = useRef(new LocalCallHistory());
  const historyVault = useRef(vault); historyVault.current = vault;
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
  modernCallCompositionRef.current = modernCallComposition;
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

  const installModernCallSupport = async (conversation: ModernConversation, refreshSessionBinding = false): Promise<void> => {
    // Call signaling uses the conversation's established encrypted session.
    // Preparing call UI must not create an outbound messaging session before
    // the first peer message establishes the matching inbound session.
    if (!conversation.hasEstablishedSession()) return;
    if (!refreshSessionBinding && callSupportConversation.current === conversation && callNegotiator.current) return;
    if (callSupportInstallation.current) {
      await callSupportInstallation.current;
      if (!refreshSessionBinding && callSupportConversation.current === conversation && callNegotiator.current) return;
    }
    const installation = (async () => {
      const composition = await conversation.createAuthenticatedCallComposition(refreshSessionBinding);
      if (!refreshSessionBinding && callSupportConversation.current === conversation && callNegotiator.current) return;

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
      if (update.mediaFailure === 'camera-unavailable') {
        callMediaFailureRef.current = update.mediaFailure;
        setCameraEnabledState(false);
        setCallError('Camera became unavailable. The call continues with video turned off.');
      } else if (update.mediaFailure === 'microphone-unavailable') {
        callMediaFailureRef.current = update.mediaFailure;
        setCallError('Microphone became unavailable. The call ended to stop media safely.');
      }
      if (update.state === 'connected') { localCallHistory.current.connected(update.callId); setCallLifecycleState('connected'); setCallStatus('Connected'); }
      if (update.state === 'reconnecting') { setCallLifecycleState('connecting'); setCallStatus('Reconnecting...'); }
      if (update.state === 'failed') { setCallLifecycleState('ice-failed'); setCallStatus('Connection Failed'); }
      });
      callStateUnsubscribe.current = composition.onCallUpdate((session) => {
      const event = localCallHistory.current.observe(session);
      if (event && historyVault.current) {
        void writeMessages(historyVault.current, session.conversationId, [event]).then(() => {
          setRoomMessages(session.conversationId, current => current.some(item => item.id === event.id) ? current : [...current, event]);
        }).catch(() => undefined);
      }
      const terminal = ['rejected', 'cancelled', 'ended', 'expired', 'failed'].includes(session.state);
      if (terminal && modernCallIdRef.current && modernCallIdRef.current !== session.callId) return;
      callActiveRef.current = !terminal;
      const peerIdentityReference = roomStatesRef.current[session.conversationId]?.contactIdentity?.identityId;
      if (terminal) {
        setRoomState(session.conversationId, { call: undefined });
        setActiveCallRoomId(current => current === session.conversationId ? undefined : current);
      } else {
        setActiveCallRoomId(session.conversationId);
        setRoomState(session.conversationId, { call: { roomId: session.conversationId, callId: session.callId, peerIdentityReference, sessionBinding: session.identityBinding } });
      }
      modernCallIdRef.current = terminal ? undefined : session.callId;
      setModernCallId(terminal ? undefined : session.callId);
      setCallMediaMode(session.mediaMode);
      const failedMedia = session.state === 'failed' ? callMediaFailureRef.current : undefined;
      setCallLifecycleState(failedMedia === 'microphone-unavailable' ? 'media-failed' : session.state === 'inviting' || session.state === 'ringing' ? 'ringing' : session.state === 'accepted' || session.state === 'connecting' || session.state === 'reconnecting' ? 'connecting' : session.state === 'connected' ? 'connected' : session.state === 'rejected' ? 'rejected' : session.state === 'cancelled' ? 'cancelled' : session.state === 'expired' ? 'timeout' : session.state === 'ended' ? 'ended' : 'ice-failed');
      setIsIncomingCall(session.state === 'ringing');
      setCallActive(!terminal);
      setCallStatus(failedMedia === 'microphone-unavailable' ? 'Call ended: microphone unavailable' : session.state === 'ringing' ? 'Incoming Call...' : session.state === 'inviting' ? 'Ringing...' : ['accepted', 'connecting'].includes(session.state) ? 'Connecting...' : session.state === 'reconnecting' ? 'Reconnecting...' : session.state === 'connected' ? 'Connected' : terminal ? `Call ${session.state}` : 'Calling...');
      if (terminal) {
        callMediaFailureRef.current = undefined;
        void callNegotiator.current?.end(session.callId).catch(() => undefined);
        clearCallMedia();
      }
      if (session.state === 'accepted' && !locallyAcceptedCalls.current.delete(session.callId)) {
        const negotiator = callNegotiator.current;
        if (negotiator) void negotiator.prepareOutgoing(session).then(() => negotiator.beginOffer(session.callId).catch(async (error: unknown) => {
          const failure = callSetupFailure(error);
          setCallError(failure.message);
          localCallHistory.current.failed(session.callId);
          await negotiator.end(session.callId).catch(() => undefined);
          setCallLifecycleState(failure.kind);
          setCallStatus(failure.kind === 'verification-required' ? 'Verification required' : failure.kind === 'signaling-failed' ? 'Call negotiation failed' : 'Call media could not start');
        })).catch(async (error: unknown) => {
          const failure = callSetupFailure(error);
          setCallError(failure.message);
          localCallHistory.current.failed(session.callId);
          await negotiator.end(session.callId).catch(() => undefined);
          setCallLifecycleState(failure.kind);
          setCallStatus(failure.kind === 'verification-required' ? 'Verification required' : failure.kind === 'signaling-failed' ? 'Call negotiation failed' : 'Call media could not start');
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

  const shareProfile = async (conversation: ModernConversation, storage: BrowserSecureStorage, fingerprint?: string): Promise<void> => {
    if (!fingerprint || !conversation.hasEstablishedSession() || conversation.getSessionHealth() !== 'healthy') return;
    const contact = await conversation.getContact();
    const profile = await readLocalProfile(storage);
    if (!profile || !contact || contact.changeStatus !== 'unchanged' || sentProfiles.current.get(conversation) === profile.revision) return;
    sentProfiles.current.set(conversation, profile.revision);
    try {
      await conversation.sendWithReceipt(encodeProfileMessage({ version: 1, ...profile, identityFingerprint: fingerprint }));
      if (!callActiveRef.current && selectedConversation.current === conversation) await installModernCallSupport(conversation, true);
    }
    catch { sentProfiles.current.delete(conversation); }
  };

  const refreshConversations = async (storage: BrowserSecureStorage, checkRoom = false) => {
    const index = await readConversationIndex(storage, await readConversationDescriptors(storage), checkRoom ? probeConversationRoom : undefined);
    setConversations(index.conversations); setUnavailableConversations(index.unavailable);
    return index;
  };

  const modernProjection = { setCallError, setChannelHash, setContactIdentity, setDeviceLifecycleState, setIsConnected, setModern, setModernCallComposition, setModernCallId, setOwnFingerprint, setPendingDeviceApproval, setPendingDeviceEnrollment, setProtocolMode, setSessionError, setSessionHealth, setSyncStatus, setUserId };
  const muxEligible = async (secureVault: BrowserSecureStorage, descriptor: ConversationDescriptor, sendJoinIntroduction = false): Promise<boolean> => {
    if (!MUX_STAGE1_ENABLED || sendJoinIntroduction || descriptor.relationship !== 'accepted' || !descriptor.remoteAddress || !descriptor.remoteIdentityCommitment) return false;
    const [contact, mode] = await Promise.all([
      new ContactIdentityRegistry(secureVault).get(descriptor.remoteAddress),
      new ConversationModeStore(secureVault).read(descriptor.roomId),
    ]);
    return Boolean(contact && contact.contactId === descriptor.remoteAddress && contact.identityId === descriptor.remoteIdentityCommitment &&
      contact.verification === 'verified' && contact.changeStatus === 'unchanged' && mode?.sessionId &&
      (!mode.remoteAddress || mode.remoteAddress === descriptor.remoteAddress));
  };

  const resolveModern = async (secureVault: BrowserSecureStorage, descriptor: ConversationDescriptor, sendJoinIntroduction = false, operationId?: number, background = false): Promise<ModernConnectionDetails> => {
    if (!background && muxRoomIds.current.has(descriptor.roomId)) {
      const existing = roomStatesRef.current[descriptor.roomId]?.conversation;
      const details = muxDetails.current.get(descriptor.roomId);
      if (existing && details && await muxEligible(secureVault, descriptor, sendJoinIntroduction)) {
        selectedConversation.current = existing;
        setRoomState(descriptor.roomId, { conversation: existing, connection: 'connected', contactIdentity: await existing.getContact() });
        setRoomMessages(descriptor.roomId, await readMessages(secureVault, descriptor.roomId));
        modernProjection.setModern(existing); modernProjection.setChannelHash(descriptor.roomId); modernProjection.setProtocolMode('modern'); modernProjection.setOwnFingerprint(details.ownFingerprint); modernProjection.setUserId(details.ownAddress);
        modernProjection.setContactIdentity(await existing.getContact()); modernProjection.setDeviceLifecycleState(await existing.getDeviceLifecycleState());
        const health = existing.getSessionHealth(); const trust = await existing.getDeviceTrust();
        modernProjection.setSessionHealth(health); modernProjection.setSyncStatus(health !== 'healthy' ? 'blocked' : trust === 'trusted' ? 'ready' : 'blocked'); modernProjection.setIsConnected(true);
        modernProjection.setModernCallComposition(null); modernProjection.setModernCallId(undefined);
        return details;
      }
      if (existing) await existing.close(false).catch(() => undefined);
      muxRoomIds.current.delete(descriptor.roomId); muxDetails.current.delete(descriptor.roomId);
      if (existing) muxConversations.current.delete(existing);
      setRoomState(descriptor.roomId, { conversation: undefined, connection: 'saved' });
    }
    conversationOpenStage('candidate-started');
    await readMessages(secureVault, descriptor.roomId).catch(() => { throw conversationFailure('CONVERSATION_STATE_INCOMPLETE'); });
    conversationOpenStage('history-loaded');
    const useMux = await muxEligible(secureVault, descriptor, sendJoinIntroduction);
    const manager = useMux ? (muxConnection.current ??= new MultiplexedRelayConnection()).forRoom(descriptor.roomId, descriptor.remoteAddress!) : undefined;
    const conversation = new ModernConversation(secureVault, loadVodozemacBindings, manager);
    if (useMux) { muxRoomIds.current.add(descriptor.roomId); muxConversations.current.add(conversation); }
    setRoomState(descriptor.roomId, { conversation, connection: 'connecting' });
    const setCallError: typeof modernProjection.setCallError = value => { if (selectedConversation.current === conversation) modernProjection.setCallError(value); };
    const setChannelHash: typeof modernProjection.setChannelHash = value => { if (selectedConversation.current === conversation) modernProjection.setChannelHash(value); };
    const setContactIdentity: typeof modernProjection.setContactIdentity = value => { if (selectedConversation.current === conversation) modernProjection.setContactIdentity(value); };
    const setDeviceLifecycleState: typeof modernProjection.setDeviceLifecycleState = value => { if (selectedConversation.current === conversation) modernProjection.setDeviceLifecycleState(value); };
    const setIsConnected: typeof modernProjection.setIsConnected = value => { if (selectedConversation.current === conversation) modernProjection.setIsConnected(value); };
    const setMessages = (value: Message[] | ((current: Message[]) => Message[])) => setRoomMessages(descriptor.roomId, value);
    const setModern: typeof modernProjection.setModern = value => { if (selectedConversation.current === conversation) modernProjection.setModern(value); };
    const setModernCallComposition: typeof modernProjection.setModernCallComposition = value => { if (selectedConversation.current === conversation) modernProjection.setModernCallComposition(value); };
    const setModernCallId: typeof modernProjection.setModernCallId = value => { if (selectedConversation.current === conversation) modernProjection.setModernCallId(value); };
    const setOwnFingerprint: typeof modernProjection.setOwnFingerprint = value => { if (selectedConversation.current === conversation) modernProjection.setOwnFingerprint(value); };
    const setPendingDeviceApproval: typeof modernProjection.setPendingDeviceApproval = value => { if (selectedConversation.current === conversation) modernProjection.setPendingDeviceApproval(value); };
    const setPendingDeviceEnrollment: typeof modernProjection.setPendingDeviceEnrollment = value => { if (selectedConversation.current === conversation) modernProjection.setPendingDeviceEnrollment(value); };
    const setProtocolMode: typeof modernProjection.setProtocolMode = value => { if (selectedConversation.current === conversation) modernProjection.setProtocolMode(value); };
    const setSessionError: typeof modernProjection.setSessionError = value => { if (selectedConversation.current === conversation) modernProjection.setSessionError(value); };
    const setSessionHealth: typeof modernProjection.setSessionHealth = value => { if (selectedConversation.current === conversation) modernProjection.setSessionHealth(value); };
    const setSyncStatus: typeof modernProjection.setSyncStatus = value => { if (selectedConversation.current === conversation) modernProjection.setSyncStatus(value); };
    const setUserId: typeof modernProjection.setUserId = value => { if (selectedConversation.current === conversation) modernProjection.setUserId(value); };
    let profileFingerprint: string | undefined;
    let receivedPeerProfile = false;
    const scheduleProfile = () => { window.setTimeout(() => { void shareProfile(conversation, secureVault, profileFingerprint).catch(() => undefined); }, 0); };
    conversation.onSessionHealthUpdate((health) => {
      if (selectedConversation.current !== conversation) return;
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
      if (state === 'accepted') acceptedDeliveries.current.add(clientId);
      else if (state === 'rejected') rejectedDeliveries.current.add(clientId);
      setMessages((current) => current.map((message) => message.id === clientId ? { ...message, delivery: state === 'accepted' ? 'accepted' : state === 'held' ? 'held' : 'failed' } : message));
    });
    try {
      conversationOpenStage('candidate-connect-started');
      const details = await conversation.connect(descriptor.roomId, descriptor.controlCapability, descriptor.remoteAddress, descriptor.remoteIdentityCommitment, async (text, envelopeId) => {
        if (text.startsWith(PROFILE_PREFIX)) {
          const peer = await conversation.getContact();
          const updates = await prepareProfileAcceptance(secureVault, descriptor.roomId, text, peer?.changeStatus === 'unchanged' ? peer.identityId : undefined);
          return { updates, afterCommit: async () => {
            // The first encrypted frame may establish the route in this same commit.
            // Reply once after that binding exists, so a peer whose initial profile
            // arrived before its contact record can safely republish it.
            const bound = await conversation.getContact();
            const profile = decodeProfileMessage(text);
            if (!receivedPeerProfile && profile && bound?.changeStatus === 'unchanged' && profile.identityFingerprint === bound.identityId) {
              receivedPeerProfile = true; sentProfiles.current.delete(conversation);
            }
            await refreshConversations(secureVault); scheduleProfile();
          } };
        }
        const message = { ...displayMessage('contact', text, 'received'), id: envelopeId };
        const historyUpdate = await prepareMessageAcceptance(secureVault, descriptor.roomId, message);
        return {
          updates: [historyUpdate],
          afterCommit: async () => {
            setMessages((previous) => previous.some((item) => item.id === envelopeId) ? previous : [...previous, message]);
            if (message.text.startsWith('k3ncrypt-file-')) setRoomState(descriptor.roomId, { fileReferences: [...new Set([...(roomStatesRef.current[descriptor.roomId]?.fileReferences ?? []), message.text])] });
            deliverNotification({ kind: 'message', conversationId: descriptor.roomId, preview: message.text }, privacyPreferencesRef.current);
            if (selectedConversation.current === conversation && conversation.hasEstablishedSession()) {
              const contact = await conversation.getContact();
              if (!callActiveRef.current && contact?.verification === 'verified' && contact.changeStatus === 'unchanged') {
                await installModernCallSupport(conversation, true).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
              }
            }
          }
        };
      }, async (contact) => {
        setRoomState(descriptor.roomId, { contactIdentity: contact });
        setContactIdentity(contact);
        scheduleProfile();
        if (selectedConversation.current === conversation && (contact.verification !== 'verified' || contact.changeStatus !== 'unchanged')) {
          if (callActiveRef.current) {
            await verificationTerminationRef.current();
          } else {
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
            setModernCallId(undefined);
          }
        }
        if (contact.contactId && (!descriptor.remoteAddress || descriptor.remoteAddress !== contact.contactId || descriptor.remoteIdentityCommitment !== contact.identityId)) {
          const latestDescriptor = (await readConversationDescriptors(secureVault))
            .find((item) => item.roomId === descriptor.roomId) ?? descriptor;
          await saveConversationDescriptor(secureVault, {
            ...latestDescriptor,
            relationship: conversation.hasEstablishedSession() ? 'accepted' : 'invitation',
            remoteAddress: contact.contactId,
            remoteIdentityCommitment: contact.identityId,
            updatedAt: Date.now(),
          });
          await refreshConversations(secureVault);
        }
        if (selectedConversation.current === conversation && !await conversationEligibility(secureVault, (await readConversationDescriptors(secureVault)).find(item => item.roomId === descriptor.roomId))) {
          setChannelHash(descriptor.roomId); setRoomMessages(descriptor.roomId, await readMessages(secureVault, descriptor.roomId));
        }
      }, (event: DeviceControlEvent) => {
        if (event.type === 'enrollment-request') setPendingDeviceEnrollment(event.payload as EnrollmentRequest);
        if (event.type === 'enrollment-approval') setPendingDeviceApproval(event.payload as EnrollmentApprovalPacket);
      }, { sendJoinIntroduction });
      conversationOpenStage('session-connected');
      const restoredContact = await conversation.getContact();
      const lifecycle = await conversation.getDeviceLifecycleState();
      const trust = await conversation.getDeviceTrust();
      if (descriptor.remoteAddress && (!conversation.hasEstablishedSession() || conversation.getSessionHealth() === 'unhealthy')) throw conversationFailure('CONVERSATION_SESSION_MISSING');
      const heldClientIds = new Set(await conversation.heldNotSentSecurelyClientIds());
      const finalHistory = (await readMessages(secureVault, descriptor.roomId)).map(message =>
        heldClientIds.has(message.id) && message.type === 'sent' ? { ...message, delivery: 'held' as const } : message);
      if (heldClientIds.size > 0) await writeMessages(secureVault, descriptor.roomId, finalHistory);
      if (operationId !== undefined && conversationOpenGeneration.current !== operationId) throw new Error('Conversation open was superseded.');
      const previous = selectedConversation.current;
      if (!background) selectedConversation.current = conversation;
      setRoomState(descriptor.roomId, { conversation, connection: 'connected', contactIdentity: restoredContact });
      setRoomMessages(descriptor.roomId, current => {
        const merged = new Map(finalHistory.map(message => [message.id, message]));
        current.forEach(message => {
          const restored = merged.get(message.id);
          merged.set(message.id, restored?.delivery === 'held' && message.delivery !== 'accepted' ? restored : message);
        });
        return [...merged.values()].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
      });
      profileFingerprint = details.ownFingerprint;
      const restoredSessionHealth = conversation.getSessionHealth();
      if (useMux) muxDetails.current.set(descriptor.roomId, details);
      if (!background) {
        setCallError(undefined);
        setModern(conversation);
        setSessionHealth(restoredSessionHealth);
        setModernCallComposition(null);
        setModernCallId(undefined);
        setProtocolMode('modern');
        setChannelHash(descriptor.roomId);
        // Read the final durable contact after mailbox replay so this projection
        // cannot overwrite a first-message identity update with an earlier snapshot.
        setContactIdentity(restoredContact);
        setOwnFingerprint(details.ownFingerprint);
        setUserId(details.ownAddress);
        setDeviceLifecycleState(lifecycle);
        setIsConnected(true);
        setSyncStatus(restoredSessionHealth !== 'healthy' ? 'blocked' : trust === 'trusted' ? 'ready' : 'blocked');
        setSessionError(restoredSessionHealth === 'unhealthy'
          ? 'This conversation’s encrypted session is missing. Your identity, verification, and saved messages remain available; sending and calls are paused until verified renewal.'
          : restoredSessionHealth === 'renewal-pending' ? 'Verified renewal awaits accepted encrypted delivery.' : undefined);
      }
      if (!background && previous && previous !== conversation) {
        const previousRoomId = [...Object.values(roomStates)].find(item => item.conversation === previous)?.roomId;
        if (previousRoomId && !muxConversations.current.has(previous)) {
          setRoomState(previousRoomId, { conversation: undefined, connection: 'saved' });
          void previous.close(false).catch(() => undefined);
        }
      }
      scheduleProfile();
      if (!background && !useMux && restoredContact?.verification === 'verified' && restoredContact.changeStatus === 'unchanged' && conversation.hasEstablishedSession()) {
        await installModernCallSupport(conversation).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
      }
      return details;
    } catch (error) {
      if (useMux) { muxRoomIds.current.delete(descriptor.roomId); muxDetails.current.delete(descriptor.roomId); muxConversations.current.delete(conversation); }
      setRoomState(descriptor.roomId, { conversation: undefined, connection: 'failed' });
      await conversation.close(false).catch(() => undefined);
      const code = classifySafeDiagnostic('conversation-open', error);
      throw conversationFailure(code === 'UNKNOWN_SAFE_FAILURE' ? 'CONVERSATION_RESTORE_FAILED' : code);
    }
  };
  const connectModern = (storage: BrowserSecureStorage, descriptor: ConversationDescriptor, introduce = false, operationId?: number, background = false) =>
    selections.current.run(async () => {
      const details = await resolveModern(storage, descriptor, introduce, operationId, background);
      if (!background && muxRoomIds.current.has(descriptor.roomId)) {
        const saved = await readConversationDescriptors(storage);
        for (const candidate of saved) {
          if (candidate.roomId === descriptor.roomId || muxRoomIds.current.has(candidate.roomId) || !await muxEligible(storage, candidate)) continue;
          try { await resolveModern(storage, candidate, false, undefined, true); }
          catch { /* One revoked or unavailable room cannot stop other room subscriptions. */ }
        }
      }
      return details;
    }, async () => undefined);

  useEffect(() => {
    if (!MUX_STAGE1_ENABLED) return;
    const diagnostics = globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean };
    const target = window as Window & {
      __K3NCRYPT_MUX_SNAPSHOT__?: () => ReturnType<MultiplexedRelayConnection['testOnlySnapshot']> | undefined;
      __K3NCRYPT_MUX_ROOM_BINDINGS__?: () => ReturnType<MultiplexedRelayConnection['testOnlyRoomBindings']> | undefined;
      __K3NCRYPT_MUX_REPLAY_ROOM__?: (roomId: string) => Promise<void>;
      __K3NCRYPT_MUX_RECONNECT__?: () => Promise<void>;
      __K3NCRYPT_MUX_UNSUBSCRIBE_ROOM__?: (roomId: string) => Promise<void>;
      __K3NCRYPT_MUX_RESUBSCRIBE_ROOM__?: (roomId: string) => Promise<void>;
      __K3NCRYPT_MUX_REPLAY_LAST_PROOF__?: () => Promise<boolean>;
      __K3NCRYPT_MUX_FORGED_ACK__?: (payload: Record<string, unknown>) => void;
      __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => ReturnType<ModernConversation['testOnlyTransportKind']> | undefined;
      __K3NCRYPT_ACTIVE_ROOM_V1_PEER__?: () => boolean | undefined;
    };
    if (diagnostics.__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ === true) {
      target.__K3NCRYPT_MUX_SNAPSHOT__ = () => muxConnection.current?.testOnlySnapshot();
      target.__K3NCRYPT_MUX_ROOM_BINDINGS__ = () => muxConnection.current?.testOnlyRoomBindings();
      target.__K3NCRYPT_MUX_REPLAY_ROOM__ = roomId => muxConnection.current!.testOnlyReplayRoom(roomId);
      target.__K3NCRYPT_MUX_RECONNECT__ = () => muxConnection.current!.testOnlyReconnect();
      target.__K3NCRYPT_MUX_UNSUBSCRIBE_ROOM__ = roomId => muxConnection.current!.testOnlyUnsubscribeRoom(roomId);
      target.__K3NCRYPT_MUX_RESUBSCRIBE_ROOM__ = roomId => muxConnection.current!.testOnlyResubscribeRoom(roomId);
      target.__K3NCRYPT_MUX_REPLAY_LAST_PROOF__ = () => muxConnection.current!.testOnlyReplayLastMessageProof();
      target.__K3NCRYPT_MUX_FORGED_ACK__ = payload => muxConnection.current!.testOnlyEmitForgedAck(payload);
      target.__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__ = () => selectedConversation.current?.testOnlyTransportKind();
      target.__K3NCRYPT_ACTIVE_ROOM_V1_PEER__ = () => selectedConversation.current?.testOnlyPeerSupportsRoomMessageV1();
    }
    return () => {
      delete target.__K3NCRYPT_MUX_SNAPSHOT__; delete target.__K3NCRYPT_MUX_ROOM_BINDINGS__;
      delete target.__K3NCRYPT_MUX_REPLAY_ROOM__; delete target.__K3NCRYPT_MUX_RECONNECT__;
      delete target.__K3NCRYPT_MUX_UNSUBSCRIBE_ROOM__; delete target.__K3NCRYPT_MUX_RESUBSCRIBE_ROOM__;
      delete target.__K3NCRYPT_MUX_REPLAY_LAST_PROOF__;
      delete target.__K3NCRYPT_MUX_FORGED_ACK__; delete target.__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__;
      delete target.__K3NCRYPT_ACTIVE_ROOM_V1_PEER__;
    };
  }, []);

  useEffect(() => {
    const history = activeRoom?.messages;
    if (vault && channelHash && protocolMode === 'modern' && history) void writeMessages(vault, channelHash, history).catch((error) => debugError('Message history persistence failed', error));
  }, [activeRoom?.messages, channelHash, protocolMode, vault]);

  const createModernChannel = useCallback(async (passphrase: string, displayName?: string): Promise<string> => {
    if (!chat) throw new Error('Chat not initialized');
    const invite = await chat.getLink();
    const secureVault = vault ?? await openModernVault(passphrase);
    if (displayName !== undefined) setProfileDisplayNameState(await writeProfileName(secureVault, displayName));
    const descriptor: ConversationDescriptor = { version: 1, relationship: 'invitation', roomId: invite.hash, controlCapability: invite.controlCapability, label: 'Private contact', updatedAt: Date.now() };
    const details = await connectModern(secureVault, descriptor);
    await saveConversationDescriptor(secureVault, (await readConversationDescriptors(secureVault)).find(item => item.roomId === descriptor.roomId) ?? descriptor); await refreshConversations(secureVault);
    const fragment = `modern=${encodeURIComponent(invite.hash)}&control=${encodeURIComponent(invite.controlCapability)}&address=${encodeURIComponent(details.ownAddress)}&identity=${encodeURIComponent(details.ownFingerprint)}`;
    return `${window.location.origin}${window.location.pathname}#${fragment}`;
  }, [chat, modern, vault]);

  const joinModernChannel = useCallback(async (roomId: string, capability: string, address: string, identityCommitment: string, passphrase: string, displayName?: string): Promise<void> => {
    const secureVault = vault ?? await openModernVault(passphrase);
    if (displayName !== undefined) setProfileDisplayNameState(await writeProfileName(secureVault, displayName));
    const descriptor: ConversationDescriptor = { version: 1, relationship: 'accepted', roomId, controlCapability: capability, remoteAddress: address, remoteIdentityCommitment: identityCommitment, label: 'Private contact', updatedAt: Date.now() };
    const existing = (await readConversationDescriptors(secureVault)).find((item) => item.roomId === roomId);
    if (existing && existing.remoteIdentityCommitment && existing.remoteIdentityCommitment !== identityCommitment) throw new Error('The invitation identity differs from the saved contact.');
    if (!(existing && roomId === channelHash && modern)) await connectModern(secureVault, existing ?? descriptor, !existing);
    await saveConversationDescriptor(secureVault, existing ?? descriptor); await refreshConversations(secureVault);
  }, [modern, vault, channelHash]);

  const updateProfileDisplayName = useCallback(async (name: string): Promise<void> => {
    if (!vault) throw new Error('Unlock this device before editing your profile.');
    const saved = await writeProfileName(vault, name);
    setProfileDisplayNameState(saved);
    // Publish to each existing protected relationship without selecting it in the UI.
    // The normal message consumer still persists every replayed message atomically.
    void (async () => {
      const contacts = await readConversationDescriptors(vault);
      for (const descriptor of contacts) {
        if (descriptor.roomId === channelHash && modern) { await shareProfile(modern, vault, ownFingerprint); continue; }
        if (!descriptor.remoteAddress || !descriptor.remoteIdentityCommitment) continue;
        const background = new ModernConversation(vault, loadVodozemacBindings);
        try {
          const details = await background.connect(descriptor.roomId, descriptor.controlCapability, descriptor.remoteAddress, descriptor.remoteIdentityCommitment, async (text, id) => {
            if (text.startsWith(PROFILE_PREFIX)) {
              const peer = await background.getContact();
              return { updates: await prepareProfileAcceptance(vault, descriptor.roomId, text, peer?.changeStatus === 'unchanged' ? peer.identityId : undefined), afterCommit: async () => { await refreshConversations(vault); } };
            }
            return { updates: [await prepareMessageAcceptance(vault, descriptor.roomId, { ...displayMessage('contact', text, 'received'), id })] };
          });
          await shareProfile(background, vault, details.ownFingerprint);
        } catch { /* Keep the local name; reconnect retries the durable profile outbox or republishes it. */ }
        finally { await background.close(false).catch(() => undefined); }
      }
    })().catch(() => undefined);
  }, [vault, modern, channelHash, ownFingerprint]);

  const setContactNickname = useCallback(async (roomId: string, nickname: string): Promise<void> => {
    if (!vault) throw new Error('Unlock this device before editing contacts.');
    const existing = conversations.find((item) => item.roomId === roomId);
    if (!existing) throw new Error('Saved contact is unavailable.');
    const trimmed = nickname.trim();
    if (trimmed.length > 80 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('Contact name must be 1–80 characters.');
    const label = trimmed.replace(/\s+/g, ' ') || 'Private contact';
    await saveConversationDescriptor(vault, { ...existing, label, localNickname: trimmed || undefined, updatedAt: Date.now() }); await refreshConversations(vault);
  }, [conversations, vault]);

  const restoreSession = useCallback(async (passphrase: string): Promise<void> => {
    const secureVault = await openModernVault(passphrase);
    const index = await refreshConversations(secureVault, true);
    for (const descriptor of index.conversations) {
      try { await connectModern(secureVault, descriptor); return; }
      catch (error) {
        const code = classifySafeDiagnostic('conversation-open', error);
        setUnavailableConversations(current => [...current, code]);
        setConversations(current => current.filter(item => item.roomId !== descriptor.roomId));
      }
    }
    for (const descriptor of await readConversationDescriptors(secureVault)) {
      if (await conversationEligibility(secureVault, descriptor, probeConversationRoom) !== 'CONVERSATION_INVITATION_UNACCEPTED') continue;
      try { await connectModern(secureVault, descriptor); break; } catch { /* Preserve unavailable pending invitation. */ }
    }
    setAccountState('ready');

  }, [modern]);

  const openConversation = useCallback(async (roomId: string): Promise<void> => {
    const operationId = ++conversationOpenGeneration.current;
    setPendingConversation({ roomId, operationId });
    setConversationOpenError(current => current?.roomId === roomId ? undefined : current);
    conversationOpenStage('started');
    if (roomId === channelHash && modern) {
      if (conversationOpenGeneration.current === operationId) setPendingConversation(undefined);
      conversationOpenStage('same-room'); return;
    }
    try {
      if (!vault) throw new Error('Unlock this device before opening a conversation.');
      const descriptor = conversations.find((item) => item.roomId === roomId);
      if (!descriptor) throw new Error('Conversation is unavailable.');
      const failure = await conversationEligibility(vault, descriptor, probeConversationRoom);
      if (failure) throw conversationFailure(failure);
      conversationOpenStage('eligible');
      await connectModern(vault, descriptor, false, operationId);
      conversationOpenStage('connected');
      if (conversationOpenGeneration.current === operationId) {
        setPendingConversation(undefined);
        setConversationOpenError(current => current?.roomId === roomId ? undefined : current);
      }
    } catch (error) {
      conversationOpenStage('failed');
      const code = classifySafeDiagnostic('conversation-open', error);
      if (conversationOpenGeneration.current === operationId) {
        setPendingConversation(undefined);
        setConversationOpenError({ roomId, operationId, code });
        if (['CONVERSATION_RECORD_INVALID', 'CONVERSATION_INVITATION_UNACCEPTED', 'CONVERSATION_INVITATION_EXPIRED', 'CONVERSATION_SESSION_MISSING', 'CONVERSATION_ROOM_MISSING', 'CONTACT_REGISTRY_MISSING', 'ROOM_MEMBERSHIP_MISMATCH', 'CONVERSATION_STATE_INCOMPLETE', 'CONVERSATION_RESTORE_FAILED'].includes(code)) {
          setConversations(current => current.filter(item => item.roomId !== roomId));
          setUnavailableConversations(current => [...current, code]);
        }
      }
      throw error;
    }
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
    setContactIdentity(await modern.getContact());
    if (callActiveRef.current) await verificationTerminationRef.current();
    else {
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
    }
  }, [modern]);

  const acceptChangedIdentity = useCallback(async (): Promise<void> => {
    if (!modern) throw new Error('No modern contact is open.');
    if (callActiveRef.current) await verificationTerminationRef.current();
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
        setupChatListeners(chat, roomId);

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
      const ownerRoomId = channelHash || 'legacy';
      const outgoing = { ...displayMessage(userId, text, 'sent'), delivery: 'pending' as const };
      try {
        if (protocolMode === 'modern') {
          const roomId = ownerRoomId;
          const activeConversation = modern!;
          const clientId = await modern!.sendWithReceipt(text, async (id) =>
            prepareMessageAcceptance(vault!, roomId, { ...outgoing, id }));
          const accepted = acceptedDeliveries.current.delete(clientId);
          const rejected = rejectedDeliveries.current.delete(clientId);
          addMessage(roomId, { ...outgoing, id: clientId, delivery: accepted ? 'accepted' : rejected ? 'failed' : 'pending' });
          const contact = await activeConversation.getContact();
          if (!callActiveRef.current && activeConversation.hasEstablishedSession() && contact?.verification === 'verified' && contact.changeStatus === 'unchanged' && selectedConversation.current === activeConversation) {
            await installModernCallSupport(activeConversation, true).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
          }
          return;
        }
        await chat!.encrypt({ text, image: '' }).send();
        addMessage(ownerRoomId, { ...outgoing, delivery: 'accepted' });
      } catch (err) {
        addMessage(ownerRoomId, { ...outgoing, delivery: 'failed' });
        debugError('Message send failed', err);
        throw err;
      }
    },
    [addMessage, channelHash, chat, modern, protocolMode, userId, vault]
  );

  const retryMessage = useCallback(async (messageId: string): Promise<void> => {
    const failed = messages.find((message) => message.id === messageId && message.type === 'sent' && ['failed', 'held'].includes(message.delivery ?? ''));
    if (!failed) throw new Error('Message retry is unavailable.');
    const roomId = channelHash;
    if (failed.delivery === 'held') {
      if (failed.text.startsWith('k3ncrypt-file-')) throw new Error('Select the original file and send a new protected transfer.');
      if (protocolMode !== 'modern' || !modern || !vault || !userId) throw new Error('A secure retry is unavailable.');
      const outgoing = { ...displayMessage(userId, failed.text, 'sent'), delivery: 'pending' as const };
      const clientId = await modern.sendWithReceipt(failed.text, async (id) =>
        prepareHeldTextRetry(vault, roomId, failed.id, { ...outgoing, id }), failed.id);
      const accepted = acceptedDeliveries.current.delete(clientId);
      const rejected = rejectedDeliveries.current.delete(clientId);
      setRoomMessages(roomId, (current) => [...current.filter((message) => message.id !== failed.id), {
        ...outgoing, id: clientId, delivery: accepted ? 'accepted' : rejected ? 'failed' : 'pending',
      }]);
      return;
    }
    if (protocolMode === 'modern' && modern && vault && userId && await modern.isTerminallyRejected(messageId)) {
      const outgoing = { ...displayMessage(userId, failed.text, 'sent'), delivery: 'pending' as const };
      const clientId = await modern.sendWithReceipt(failed.text, async (id) =>
        prepareMessageAcceptance(vault, roomId, { ...outgoing, id }));
      const accepted = acceptedDeliveries.current.delete(clientId);
      const rejected = rejectedDeliveries.current.delete(clientId);
      addMessage(roomId, { ...outgoing, id: clientId, delivery: accepted ? 'accepted' : rejected ? 'failed' : 'pending' });
      return;
    }
    setRoomMessages(roomId, (current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'pending' } : message));
    try {
      if (protocolMode === 'modern') await modern?.retryPending();
      else {
        if (!chat) throw new Error('Chat is unavailable.');
        await chat.encrypt({ text: failed.text, image: '' }).send();
        setRoomMessages(roomId, (current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'accepted' } : message));
      }
    } catch (error) {
      setRoomMessages(roomId, (current) => current.map((message) => message.id === messageId ? { ...message, delivery: 'failed' } : message));
      throw error;
    }
  }, [addMessage, channelHash, chat, messages, modern, protocolMode, setRoomMessages, userId, vault]);

  useEffect(() => {
    const retry = () => { if (modern) void modern.retryPending(); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [modern]);

  const updatePrivacyPreferences = useCallback((next: Partial<PrivacyPreferences>): void => {
    setPrivacyPreferences((current) => writePrivacyPreferences({ ...current, ...next, analytics: false }));
  }, []);

  const attachmentRequestHeaders = useCallback(async (operation: 'attachment:create' | 'attachment:read' | 'attachment:write' | 'attachment:delete' = 'attachment:read'): Promise<Record<string, string>> => {
    if (!modern || protocolMode !== 'modern') throw new Error('Protected media requires a modern private session.');
    return modern.attachmentAuthorizationHeaders(operation);
  }, [modern, protocolMode]);

  const roomConversation = (roomId: string): ModernConversation => {
    const state = roomStatesRef.current[roomId];
    if (!state || state.connection !== 'connected' || !state.conversation) throw new Error('This room is not connected for protected operations.');
    return state.conversation;
  };

  const attachmentRequestHeadersForRoom = useCallback(async (roomId: string, operation: 'attachment:create' | 'attachment:read' | 'attachment:write' | 'attachment:delete' = 'attachment:read'): Promise<Record<string, string>> => {
    return roomConversation(roomId).attachmentAuthorizationHeaders(operation);
  }, []);

  const fileTransferBindingForRoom = useCallback(async (roomId: string, verified: boolean) => {
    return roomConversation(roomId).fileTransferBinding(verified);
  }, []);

  const fileTransferBinding = useCallback(async (verified: boolean) => {
    if (!channelHash || protocolMode !== 'modern') throw new Error('Verified modern contact required.');
    return fileTransferBindingForRoom(channelHash, verified);
  }, [channelHash, fileTransferBindingForRoom, protocolMode]);

  const sendMessageForRoom = useCallback(async (roomId: string, text: string): Promise<void> => {
    if (!vault || !userId) throw new Error('Chat not ready.');
    const conversation = roomConversation(roomId);
    const outgoing = { ...displayMessage(userId, text, 'sent'), delivery: 'pending' as const };
    try {
      const clientId = await conversation.sendWithReceipt(text, async id => prepareMessageAcceptance(vault, roomId, { ...outgoing, id }));
      const accepted = acceptedDeliveries.current.delete(clientId);
      addMessage(roomId, { ...outgoing, id: clientId, delivery: accepted ? 'accepted' : 'pending' });
      if (text.startsWith('k3ncrypt-file-')) setRoomState(roomId, { fileReferences: [...new Set([...(roomStatesRef.current[roomId]?.fileReferences ?? []), text])] });
      const contact = await conversation.getContact();
      if (!callActiveRef.current && conversation.hasEstablishedSession() && contact?.verification === 'verified' && contact.changeStatus === 'unchanged' && selectedConversation.current === conversation) {
        await installModernCallSupport(conversation, true).catch(() => setCallError('Call signaling is unavailable for this saved contact.'));
      }
    } catch (error) {
      addMessage(roomId, { ...outgoing, delivery: 'failed' });
      throw error;
    }
  }, [addMessage, vault, userId]);

  const clearCallMedia = useCallback((): void => {
    if (callMediaPoll.current) clearInterval(callMediaPoll.current);
    callMediaPoll.current = undefined;
    activeLegacyCall.current = undefined;
    setLocalCallStream(undefined);
    setRemoteCallStream(undefined);
    setMicrophoneMutedState(false);
    setCameraEnabledState(false);
    setCallMediaMode('audio');
    callMediaFailureRef.current = undefined;
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
      const conversation = modern;
      if (!conversation || selectedConversation.current !== conversation) { callStartDiagnostic('conversation'); throw new Error('Modern conversation is not ready for calling.'); }
      if (callActiveRef.current) throw new Error('A call is already active.');
      try { await installModernCallSupport(conversation, true); }
      catch (error) { callStartDiagnostic('support', error); throw error; }
      if (selectedConversation.current !== conversation || callSupportConversation.current !== conversation || !callNegotiator.current) {
        callStartDiagnostic('support'); throw new Error('Authenticated call media is not ready. Reverify this contact.');
      }
      let composition;
      try { composition = await conversation.createAuthenticatedCallComposition(); }
      catch (error) { callStartDiagnostic('composition', error); throw error; }
      setModernCallComposition(composition);
      try { await composition.invite(); }
      catch (error) { callStartDiagnostic('invite', error); throw error; }
      return;
    }
    throw new Error('Verification required: legacy conversations have no local contact verification authority.');
  }, [modern, protocolMode]);

  const startVideoCall = useCallback(async () => {
    if (protocolMode === 'modern') {
      setCallError(undefined);
      const conversation = modern;
      if (!conversation || selectedConversation.current !== conversation) { callStartDiagnostic('conversation'); throw new Error('Modern conversation is not ready for calling.'); }
      if (callActiveRef.current) throw new Error('A call is already active.');
      try { await installModernCallSupport(conversation, true); }
      catch (error) { callStartDiagnostic('support', error); throw error; }
      if (selectedConversation.current !== conversation || callSupportConversation.current !== conversation || !callNegotiator.current) {
        callStartDiagnostic('support'); throw new Error('Authenticated call media is not ready. Reverify this contact.');
      }
      let composition;
      try { composition = await conversation.createAuthenticatedCallComposition(); }
      catch (error) { callStartDiagnostic('composition', error); throw error; }
      setModernCallComposition(composition);
      try { await composition.invite('video'); }
      catch (error) { callStartDiagnostic('invite', error); throw error; }
      return;
    }
    throw new Error('Verification required: legacy conversations have no local contact verification authority.');
  }, [modern, protocolMode]);

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
        const failure = callSetupFailure(error);
        setCallError(failure.message);
        localCallHistory.current.failed(modernCallId);
        await callNegotiator.current?.end(modernCallId).catch(() => undefined);
        setCallLifecycleState(failure.kind);
        setCallStatus(failure.kind === 'verification-required' ? 'Verification required' : failure.kind === 'signaling-failed' ? 'Call negotiation failed' : 'Call media could not start');
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
  verificationTerminationRef.current = async (): Promise<void> => {
    if (verificationTerminationPending.current) return verificationTerminationPending.current;
    const callId = modernCallIdRef.current;
    const composition = modernCallCompositionRef.current;
    const termination = (async (): Promise<void> => {
      setCallError('Verification required: this contact must be reverified before calling.');
      setCallActive(false);
      callActiveRef.current = false;
      setIsIncomingCall(false);
      setCallDuration(0);
      if (callId && composition) {
        await composition.terminateLocally(callId).catch(() => undefined);
        await callNegotiator.current?.terminateLocally(callId).catch(() => undefined);
      }
      callMediaUnsubscribe.current?.();
      callMediaUnsubscribe.current = null;
      callStateUnsubscribe.current?.();
      callStateUnsubscribe.current = null;
      callProtocolUnsubscribe.current?.();
      callProtocolUnsubscribe.current = null;
      await callNegotiator.current?.dispose();
      callNegotiator.current = undefined;
      callSupportConversation.current = null;
      modernCallCompositionRef.current = null;
      setModernCallComposition(null);
      setModernCallId(undefined);
      modernCallIdRef.current = undefined;
      setCallLifecycleState('verification-required');
      setCallStatus('Verification required');
      clearCallMedia();
    })();
    verificationTerminationPending.current = termination;
    try { await termination; }
    finally { if (verificationTerminationPending.current === termination) verificationTerminationPending.current = undefined; }
  };

  useEffect(() => {
    if (!callActive || protocolMode !== 'modern' || !modernCallId || !modernCallComposition) return;
    return modernCallComposition.watchVerification(() => verificationTerminationRef.current());
  }, [callActive, modernCallComposition, modernCallId, protocolMode]);

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

  const setCameraEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (protocolMode === 'modern') {
      const activeCallId = modernCallIdRef.current;
      if (!activeCallId) return;
      try {
        const applied = await callNegotiator.current?.setCameraEnabled(activeCallId, enabled);
        if (!applied) throw new Error('Camera control is unavailable for this call.');
        const local = callNegotiator.current?.getStreams(activeCallId).local;
        setLocalCallStream(local);
        setCameraEnabledState(enabled);
      } catch (error) {
        setCameraEnabledState(false);
        setCallError(error instanceof Error ? error.message : 'Camera could not be changed.');
      }
      return;
    }
    const call = activeLegacyCall.current;
    if (!call || !call.localStream?.getVideoTracks().length) return;
    call.setCameraEnabled(enabled);
    setCameraEnabledState(enabled);
  }, [protocolMode]);

  // Add message to state
  // Setup chat listeners
  const setupChatListeners = (chatInstance: IChatE2EE, roomId: string) => {
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
      addMessage(roomId, message);
      deliverNotification({ kind: 'message', conversationId: roomId || 'legacy', preview: message.text }, privacyPreferencesRef.current);
    });

    chatInstance.on('call-added', (call: IE2ECall) => {
      setActiveCallRoomId(roomId);
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
        setActiveCallRoomId(roomId);
        setCallActive(true);
      }
      if (['ended', 'verification-required', 'rejected', 'timeout', 'cancelled', 'no-peer', 'media-denied', 'media-failed', 'signaling-failed', 'ice-failed'].includes(update.state)) {
        if (update.state === 'timeout') deliverNotification({ kind: 'missed-call', conversationId: roomId || 'legacy' }, privacyPreferencesRef.current);
        setActiveCallRoomId(current => current === roomId ? undefined : current);
        setCallActive(false);
        setIsIncomingCall(false);
        setCallDuration(0);
      }
    });

    chatInstance.on('call-removed', () => {
      setActiveCallRoomId(current => current === roomId ? undefined : current);
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
      'verification-required': 'Verification Required',
      rejected: 'Call Rejected',
      'no-peer': 'No Peer Available',
      'media-denied': 'Microphone Permission Denied',
      'media-failed': 'Call Media Failed',
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
      if (vault && channelHash) { await removeConversationDescriptor(vault, channelHash); await refreshConversations(vault); }
      setModern(null);
      setModernCallComposition(null);
      setModernCallId(undefined);
      setProtocolMode('legacy');
      setChannelHash('');
      if (channelHash) setRoomMessages(channelHash, []);
      return;
    }
    if (!chat) return;
    try {
      await chat.delete();
      setIsConnected(false);
      setChannelHash('');
      if (channelHash) setRoomMessages(channelHash, []);
    } catch (err) {
      debugError('Conversation deletion failed', err);
      throw err;
    }
  }, [chat, channelHash, modern, protocolMode, vault]);

  const value: ChatContextType = {
    chat,
    userId,
    channelHash,
    pendingConversation,
    conversationOpenError,
    activeCallRoomId,
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
    unavailableConversations,
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
    fileTransferBinding,
    sendMessageForRoom,
    fileTransferBindingForRoom,
    attachmentRequestHeadersForRoom,
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
