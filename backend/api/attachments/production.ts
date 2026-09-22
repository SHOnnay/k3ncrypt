import { createHash, timingSafeEqual } from 'crypto';
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
import { durableDeviceTrustAuthority } from '../../security/durableDeviceTrust';

const ADDRESS = /^[0-9a-f-]{36}$/i;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const proofHash = (proof: string): string => createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest('hex');
const proofMatches = (proof: string, expected: string): boolean => {
  if (!PROOF.test(proof) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(proofHash(proof), 'hex'), Buffer.from(expected, 'hex'));
};

interface AccessDocument extends AttachmentAccessRecord { attachmentId: string; }
class MongoAttachmentAccessStore implements AttachmentAccessStore {
  constructor(private readonly records: Collection<AccessDocument>) {}
  async register(attachmentId: string, record: AttachmentAccessRecord): Promise<void> { await this.records.insertOne({ attachmentId, ...record }); }
  async lookup(attachmentId: string): Promise<AttachmentAccessRecord | undefined> {
    const record = await this.records.findOne({ attachmentId });
    return record ? { conversationId: record.conversationId, ownerParticipantId: record.ownerParticipantId } : undefined;
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
      isMember: async (conversationId, participantId) => {
        const record = await database.collection(PREKEY_COLLECTION).findOne({ channel: conversationId, address: participantId, expiresAt: { $gt: new Date() } });
        return !!record;
      },
    };
    service = createProductionAuthenticatedAttachmentService({ memberships, access }, new PersistentAttachmentDeliveryStore(persistence));
  }
  return service;
};

const authenticate = async (request: Request): Promise<AuthenticatedContext | undefined> => {
  const conversationId = request.get('X-K3ncrypt-Conversation') ?? '';
  const participantId = request.get('X-K3ncrypt-Participant') ?? '';
  const capability = request.get('X-K3ncrypt-Control-Capability') ?? '';
  const proof = request.get('X-K3ncrypt-Routing-Proof') ?? '';
  const requestId = request.get('X-K3ncrypt-Request-Id') ?? '';
  const deviceProofText = request.get('X-K3ncrypt-Device-Proof') ?? '';
  const deviceNonce = request.get('X-K3ncrypt-Device-Nonce') ?? '';
  if (!isValidRoomId(conversationId) || !ADDRESS.test(participantId) || !isValidControlCapability(capability) || !PROOF.test(proof) || !UUID.test(requestId)) return undefined;
  if (!await authorizeRoomControl(conversationId, capability)) return undefined;
  const record = await db.findOneFromDB<{ renewalProofHash: string; expiresAt: Date }>({ channel: conversationId, address: participantId }, PREKEY_COLLECTION);
  if (!record || !(record.expiresAt instanceof Date) || record.expiresAt.getTime() <= Date.now() || !proofMatches(proof, record.renewalProofHash)) return undefined;
  let operation: DeviceOperation | undefined;
  if (request.method === 'POST' && request.path === '/create') operation = 'attachment:create';
  else if (request.method === 'PUT') operation = 'attachment:write';
  else if (request.method === 'GET') operation = 'attachment:read';
  else if (request.method === 'DELETE') operation = 'attachment:delete';
  if (!operation || !/^[A-Za-z0-9_-]{16,128}$/.test(deviceNonce)) return undefined;
  let deviceProof: DeviceAuthorizationProof;
  try { deviceProof = JSON.parse(Buffer.from(deviceProofText, 'base64url').toString('utf8')) as DeviceAuthorizationProof; } catch { return undefined; }
  const authority = durableDeviceTrustAuthority(db.getDatabase());
  if (!authority || deviceProof.nonce !== deviceNonce) return undefined;
  try { await authority.verify(deviceProof, operation, { conversationId }); } catch { return undefined; }
  productionService();
  const now = Date.now();
  const verifiedDevice = { deviceId: deviceProof.deviceId, accountIdentityReference: deviceProof.accountIdentityReference, trustEpoch: deviceProof.trustEpoch, operation, expiresAt: deviceProof.expiresAt };
  return {
    sessionId: `attachment:${participantId}`,
    participantId,
    conversationId,
    permissions: ['attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete'],
    requestId,
    createdAt: now,
    expiresAt: now + 30_000,
    deviceTrust: { assertTrusted: async () => {
      if (verifiedDevice.expiresAt <= Date.now() || verifiedDevice.deviceId !== deviceProof.deviceId || verifiedDevice.accountIdentityReference !== deviceProof.accountIdentityReference || verifiedDevice.operation !== operation) throw new Error('Device trust unavailable.');
    } },
  };
};

/** Production-only route: Mongo stores ciphertext; routing proof authenticates the modern device endpoint. */
export const createProductionAttachmentRouter = (): express.Router => createAttachmentRouter({
  authenticate,
  attachments: {
    createUpload: (...args) => productionService().createUpload(...args),
    storeChunk: (...args) => productionService().storeChunk(...args),
    completeUpload: (...args) => productionService().completeUpload(...args),
    getChunks: (...args) => productionService().getChunks(...args),
    deleteAttachment: (...args) => productionService().deleteAttachment(...args),
  } as ReturnType<typeof createProductionAuthenticatedAttachmentService>,
});
