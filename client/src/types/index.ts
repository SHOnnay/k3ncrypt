/**
 * Type definitions for Chat E2EE application
 */

import type { IChatE2EE } from '@chat-e2ee/service';
import type { CallLifecycleState } from '@chat-e2ee/service';
import type { StoredContactIdentity, EnrollmentRequest, EnrollmentApprovalPacket, LifecycleStateSnapshot } from '@chat-e2ee/service';

// Message type
export interface Message {
  sender: string;
  text: string;
  type: 'sent' | 'received';
  timestamp: Date;
  delivery?: 'pending' | 'accepted' | 'failed';
  media?: { kind: 'image' | 'file' | 'voice' | 'video'; mimeType?: string; size?: number; reference?: string };
}

// Setup view states
export type SetupView = 'initial' | 'create' | 'join';

// A freshly created invitation: a public room id + a client-generated secret
// that is only ever shared via the URL fragment, never sent to the server.
export interface InviteInfo {
  roomId: string;
  secret: string;
  controlCapability: string;
  link: string;
  absoluteLink: string | undefined;
}

// Chat app state
export interface AppState {
  chat: IChatE2EE | null;
  userId: string;
  channelHash: string;
  setupView: SetupView;
  messages: Message[];
  isConnected: boolean;
  callActive: boolean;
}

// Chat context type
export interface ChatContextType {
  // State
  chat: IChatE2EE | null;
  userId: string;
  channelHash: string;
  messages: Message[];
  isConnected: boolean;
  callActive: boolean;
  callStatus: string;
  callDuration: number;
  callLifecycleState: CallLifecycleState;
  isIncomingCall: boolean;
  protocolMode: 'legacy' | 'modern';
  ownFingerprint?: string;
  contactIdentity?: StoredContactIdentity;
  deviceLifecycleState?: LifecycleStateSnapshot;
  pendingDeviceEnrollment?: EnrollmentRequest;
  pendingDeviceApproval?: EnrollmentApprovalPacket;

  // Methods
  initializeChat: () => Promise<void>;
  createNewChannel: () => Promise<InviteInfo>;
  createModernChannel: (passphrase: string) => Promise<string>;
  joinModernChannel: (roomId: string, controlCapability: string, address: string, passphrase: string) => Promise<void>;
  verifyContact: () => Promise<void>;
  acceptChangedIdentity: () => Promise<void>;
  requestDeviceEnrollment: (deviceId: string, publicIdentityReference: string, algorithm: string) => Promise<void>;
  approveDeviceEnrollment: () => Promise<void>;
  rejectDeviceEnrollment: () => Promise<void>;
  confirmDeviceEnrollment: () => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
  joinChannel: (roomId: string, secret: string, controlCapability: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  cancelCall: () => Promise<void>;
  endCall: () => Promise<void>;
  addMessage: (message: Message) => void;
  setCallDuration: (duration: number) => void;
  deleteChannel: () => Promise<void>;
}

// Common component props
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'tiny' | 'small' | 'medium' | 'large';
  icon?: boolean;
  circle?: boolean;
  children: React.ReactNode;
}

export interface InputProps {
  id?: string;
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  type?: string;
  className?: string;
}

// Setup overlay props
export interface SetupOverlayProps {
  setupView: SetupView;
  onViewChange: (view: SetupView) => void;
  onChannelJoin: (roomId: string, secret: string, controlCapability: string) => Promise<void>;
  status?: string;
}
