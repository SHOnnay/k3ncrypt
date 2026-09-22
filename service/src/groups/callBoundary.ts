import type { GroupMembershipSnapshot } from './contracts';

export interface GroupCallKeyAdapter { establish(snapshot: GroupMembershipSnapshot): Promise<void>; rotate(snapshot: GroupMembershipSnapshot): Promise<void>; revokeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void>; }
export interface GroupCallMediaBoundary { readonly endpointEncrypted: true; authorizeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void>; releaseParticipant(deviceId: string): Promise<void>; }

export class EncryptedGroupCallBoundary implements GroupCallMediaBoundary {
    public readonly endpointEncrypted = true as const;
    private readonly participants = new Set<string>();
    private epoch = -1;
    public constructor(private readonly keys: GroupCallKeyAdapter) {}
    public async authorizeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void> { const member = snapshot.members.find((candidate) => candidate.deviceId === deviceId); if (!member || member.state !== 'active' || snapshot.group.epoch < this.epoch) throw new Error('Group call participant rejected.'); if (this.participants.size === 0) { await this.keys.establish(snapshot); this.epoch = snapshot.group.epoch; } this.participants.add(deviceId); }
    public async removeParticipant(deviceId: string, snapshot: GroupMembershipSnapshot): Promise<void> { if (snapshot.group.epoch < this.epoch || !this.participants.delete(deviceId)) throw new Error('Group call participant unavailable.'); await this.keys.revokeParticipant(deviceId, snapshot); await this.keys.rotate(snapshot); this.epoch = snapshot.group.epoch; }
    public async releaseParticipant(deviceId: string): Promise<void> { this.participants.delete(deviceId); }
}
