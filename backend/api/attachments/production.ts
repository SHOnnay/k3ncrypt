import { authorizeCurrentRouting, bindVerifiedRouting, currentRoutingIdentity, durableRoutingEnabled, routingContinuation } from '../../security/routingOwnership';
import express, { type Request } from 'express';
import type { Collection } from 'mongodb';
import { PersistentAttachmentDeliveryStore } from '../../../service/src/attachments';
import db from '../../db';
import { PREKEY_COLLECTION } from '../../db/const';
import { MongoAttachmentPersistence } from '../../attachments';
import { authorizeRoomControl, isValidControlCapability, isValidRoomId } from '../../security/controlCapability';
import { createProductionAuthenticatedAttachmentService } from '../../security/productionAttachmentComposition';
import type { AttachmentAccessRecord, AttachmentAccessStore, AuthenticatedContext, ConversationMembershipStore } from '../../security/authorizationContext';
import { createAttachmentRouter } from './index';
import { type DeviceAuthorizationProof, type DeviceOperation } from '../../security/deviceTrust';
import { attachmentTrustGuard } from '../../security/attachmentTrust';
import { durableDeviceTrustAuthority } from '../../security/durableDeviceTrust';
import { fingerprintVodozemacIdentity, type VodozemacPublicIdentity } from '../../../service/src/identity/vodozemacIdentity';

const ADDRESS = /^[0-9a-f-]{36}$/i;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f-]{36}$/i;

interface AccessDocument extends AttachmentAccessRecord { attachmentId: string; }
class MongoAttachmentAccessStore implements AttachmentAccessStore {
  constructor(private readonly records: Collection<AccessDocument>) {}
  async register(attachmentId: string, record: AttachmentAccessRecord): Promise<void> { await this.records.insertOne({ attachmentId, ...record }); }
  async lookup(attachmentId: string): Promise<AttachmentAccessRecord | undefined> {
    const record = await this.records.findOne({ attachmentId });
    return record ? { conversationId: record.conversationId, ownerParticipantId: record.ownerParticipantId, recipientParticipantId: record.recipientParticipantId, senderIdentityReference: record.senderIdentityReference, recipientIdentityReference: record.recipientIdentityReference } : undefined;
  }
}

let service: ReturnType<typeof createProductionAuthenticatedAttachmentService> | undefined;
const productionService = () => {
  const database = db.getDatabase();
  if (!database) throw new Error('Persistent attachment storage unavailable.');
  if (!service) {
    const persistence = new MongoAttachmentPersistence(database);
    const accessCollection = database.collection<AccessDocument>('attachment_access');
    const access = new MongoAttachmentAccessStore(accessCollection);
    const memberships: ConversationMembershipStore = {
      isMember: async (conversationId, participantId) => !!await currentRoutingIdentity(conversationId, participantId, !durableRoutingEnabled()),
      identityReference: async (conversationId, participantId) => currentRoutingIdentity(conversationId, participantId, !durableRoutingEnabled()),
    };
    service = createProductionAuthenticatedAttachmentService({ memberships, access }, new PersistentAttachmentDeliveryStore(persistence));
  }
  return service;
};

export const authenticateAttachment = async (request: Request, requiredOperation?: DeviceOperation): Promise<AuthenticatedContext | undefined> => {
  const conversationId = request.get('X-K3ncrypt-Conversation') ?? '';
  const participantId = request.get('X-K3ncrypt-Participant') ?? '';
  const capability = request.get('X-K3ncrypt-Control-Capability') ?? '';
  const proof = request.get('X-K3ncrypt-Routing-Proof') ?? '';
  const requestId = request.get('X-K3ncrypt-Request-Id') ?? '';
  const deviceProofText = request.get('X-K3ncrypt-Device-Proof') ?? '';
  const deviceNonce = request.get('X-K3ncrypt-Device-Nonce') ?? '';
  if (!isValidRoomId(conversationId) || !ADDRESS.test(participantId) || !isValidControlCapability(capability) || !PROOF.test(proof) || !UUID.test(requestId)) return undefined;
  if (!await authorizeRoomControl(conversationId, capability)) return undefined;
  const record = await db.findOneFromDB<{ renewalProofHash: string; expiresAt: Date; bundle?: { identity?: VodozemacPublicIdentity } }>({ channel: conversationId, address: participantId }, PREKEY_COLLECTION);
  if (!await authorizeCurrentRouting(conversationId, participantId, proof)) return undefined;
  let operation: DeviceOperation | undefined;
  if (request.method === 'POST' && request.path === '/create') operation = 'attachment:create';
  else if (request.method === 'POST' && request.path.endsWith('/complete')) operation = 'attachment:write';
  else if (request.method === 'PUT') operation = 'attachment:write';
  else if (request.method === 'GET') operation = 'attachment:read';
  else if (request.method === 'DELETE') operation = 'attachment:delete';
  operation = requiredOperation ?? operation;
  if (!operation || !/^[A-Za-z0-9_-]{16,128}$/.test(deviceNonce)) return undefined;
  let deviceProof: DeviceAuthorizationProof;
  try { deviceProof = JSON.parse(Buffer.from(deviceProofText, 'base64url').toString('utf8')) as DeviceAuthorizationProof; } catch { return undefined; }
  const database = db.getDatabase();
  const authority = durableDeviceTrustAuthority(database);
  if (!authority || deviceProof.nonce !== deviceNonce) return undefined;
  let trustedDevice;
  try { trustedDevice = await authority.verify(deviceProof, operation, { conversationId }); } catch { return undefined; }
  let owner;
  try { owner = await bindVerifiedRouting(conversationId, participantId, proof, trustedDevice, deviceProof.expiresAt); } catch { return undefined; }
  let identityReference: string;
  if (owner) identityReference = owner.identityReference;
  else {
    if (!record?.bundle?.identity) return undefined;
    try { identityReference = await fingerprintVodozemacIdentity(record.bundle.identity); } catch { return undefined; }
  }
  if (trustedDevice.deviceIdentityReference !== identityReference || deviceProof.deviceIdentityReference !== identityReference) return undefined;
  productionService();
  const now = Date.now();
  const expiresAt = Math.min(now + 30_000, deviceProof.expiresAt);
  return {
    sessionId: `attachment:${participantId}`,
    participantId,
    conversationId,
    permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'],
    requestId,
    identityReference,
    accountIdentityReference: trustedDevice.accountIdentityReference,
    createdAt: now,
    expiresAt,
    deviceTrust: {
      assertTrusted: async () => {
        await attachmentTrustGuard(database!, trustedDevice, expiresAt).assertTrusted();
        if (owner) await routingContinuation(conversationId, participantId, owner, expiresAt).assertTrusted();
      },
    },
  };
};

/** Production-only route: Mongo stores ciphertext; routing proof authenticates the modern device endpoint. */
export const createProductionAttachmentRouter = (): express.Router => createAttachmentRouter({
  authenticate: authenticateAttachment,
  attachments: {
    createUpload: (...args) => productionService().createUpload(...args),
    storeChunk: (...args) => productionService().storeChunk(...args),
    completeUpload: (...args) => productionService().completeUpload(...args),
    getChunks: (...args) => productionService().getChunks(...args),
    deleteAttachment: (...args) => productionService().deleteAttachment(...args),
  } as ReturnType<typeof createProductionAuthenticatedAttachmentService>,
});
