import type { Db, Collection } from 'mongodb';
import type { NetworkMembershipEvent } from '../../service/src/devices/trustProtocol';
import type { DeviceAuthorizationProof } from './deviceTrust';
import { verifyNetworkMembershipSignature } from './lifecycleEvent';
import { MongoDeviceTrustStore, DurableDeviceTrustAuthority } from './durableDeviceTrust';

export type NetworkMemberRecord = { networkId: string; accountIdentityReference: string; deviceId: string; identityReference: string; state: 'active' | 'removed'; epoch: number; deviceTrustEpoch: number; capabilities: readonly string[]; updatedAt: number };
export class DurableNetworkMembershipAuthority {
  private readonly members: Collection<NetworkMemberRecord>;
  private readonly events: Collection<{ eventId: string; networkId: string; createdAt: number }>;
  constructor(private readonly database: Db, private readonly deviceStore = new MongoDeviceTrustStore(database)) { this.members = database.collection('private_network_members'); this.events = database.collection('private_network_membership_events'); }
  async apply(event: NetworkMembershipEvent, proof: DeviceAuthorizationProof): Promise<NetworkMemberRecord> {
    const now = Date.now(); const issuer = await this.deviceStore.read(event.accountIdentityReference, event.issuerDeviceId); const targetDevice = await this.deviceStore.read(event.accountIdentityReference, event.targetDeviceId); const target = await this.members.findOne({ networkId: event.networkId, deviceId: event.targetDeviceId }); const owner = await this.members.findOne({ networkId: event.networkId, accountIdentityReference: event.accountIdentityReference, deviceId: event.issuerDeviceId, state: 'active', capabilities: 'network-owner' });
    if (!issuer || issuer.state !== 'active' || !targetDevice || targetDevice.state !== 'active' || targetDevice.deviceIdentityReference !== event.targetIdentityReference || !owner || event.issuerIdentityReference !== issuer.deviceIdentityReference || !verifyNetworkMembershipSignature(event, issuer.verificationKeyReference, now) || event.previousEpoch !== issuer.trustEpoch || proof.operation !== 'device-control' || proof.deviceId !== event.issuerDeviceId || proof.accountIdentityReference !== event.accountIdentityReference) throw new Error('Network membership rejected.');
    const authority = new DurableDeviceTrustAuthority(this.deviceStore, process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET ?? ''); await authority.verify(proof, 'device-control');
    if (target && target.epoch !== event.previousEpoch && event.operation !== 'add-member') throw new Error('Network membership epoch rejected.');
    if (event.operation === 'add-member' && target?.state === 'active') throw new Error('Network member already exists.');
    try { await this.events.insertOne({ eventId: event.eventId, networkId: event.networkId, createdAt: event.createdAt }); } catch { throw new Error('Network membership replayed.'); }
    const record: NetworkMemberRecord = { networkId: event.networkId, accountIdentityReference: event.accountIdentityReference, deviceId: event.targetDeviceId, identityReference: event.targetIdentityReference, state: event.operation === 'remove-member' ? 'removed' : 'active', epoch: event.nextEpoch, deviceTrustEpoch: targetDevice.trustEpoch, capabilities: event.capabilities, updatedAt: now };
    await this.members.replaceOne({ networkId: event.networkId, deviceId: event.targetDeviceId }, record, { upsert: true }); return record;
  }
}
