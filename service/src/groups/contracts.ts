export type GroupMemberState = 'pending' | 'active' | 'removed';
export interface GroupMember { readonly memberId: string; readonly userIdentityReference: string; readonly deviceId: string; readonly state: GroupMemberState; }
export interface GroupIdentity { readonly groupId: string; readonly version: 1; readonly genesisCommitment: string; readonly epoch: number; }
export interface GroupMembershipSnapshot { readonly group: GroupIdentity; readonly members: readonly GroupMember[]; readonly transcriptCommitment: string; }
export interface GroupAuthorization { readonly groupId: string; readonly actorDeviceId: string; readonly targetDeviceId?: string; readonly epoch: number; readonly expiresAt: number; }
export interface GroupKeyManagementAdapter { establish(snapshot: GroupMembershipSnapshot): Promise<void>; rotate(snapshot: GroupMembershipSnapshot): Promise<void>; removeMember(memberId: string, snapshot: GroupMembershipSnapshot): Promise<void>; }
export interface GroupAuthorizationBoundary { authorize(change: GroupAuthorization, snapshot: GroupMembershipSnapshot): Promise<void>; }
