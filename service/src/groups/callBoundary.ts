import type { GroupMembershipSnapshot } from './contracts';

export interface GroupCallKeyAdapter { establish(snapshot: GroupMembershipSnapshot): Promise<void>; rotate(snapshot: GroupMembershipSnapshot): Promise<void>; revokeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void>; }
export interface GroupCallMediaBoundary { readonly endpointEncrypted: true; authorizeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void>; releaseParticipant(deviceId: string): Promise<void>; }
