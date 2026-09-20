export type AttachmentPermission = 'attachment:create' | 'attachment:write' | 'attachment:read' | 'attachment:delete';

/** Per-request context supplied by an existing authenticated session verifier. */
export interface AuthenticatedContext {
  sessionId: string;
  participantId: string;
  conversationId: string;
  permissions: readonly AttachmentPermission[];
  requestId: string;
  createdAt: number;
  expiresAt: number;
  /** Optional Phase 6B trust adapter supplied by the authenticated runtime. */
  deviceTrust?: { assertTrusted(): Promise<void> };
}

export interface ConversationMembershipStore {
  isMember(conversationId: string, participantId: string): Promise<boolean>;
}

export interface AttachmentAccessRecord {
  conversationId: string;
  ownerParticipantId: string;
}

export interface AttachmentAccessStore {
  register(attachmentId: string, record: AttachmentAccessRecord): Promise<void>;
  lookup(attachmentId: string): Promise<AttachmentAccessRecord | undefined>;
}

const ID = /^[A-Za-z0-9._:-]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): Error => new Error('Authorization failed.');

/**
 * Authorization-only boundary. It accepts identity/session assertions from an
 * existing verifier and never creates credentials or handles private keys.
 */
export class ConversationAuthorizationService {
  private readonly consumedRequests = new Set<string>();

  constructor(private readonly memberships: ConversationMembershipStore, private readonly attachments: AttachmentAccessStore, private readonly now: () => number = Date.now) {}

  async authorizeConversation(context: AuthenticatedContext, conversationId: string, permission: AttachmentPermission): Promise<void> {
    this.validateContext(context);
    await context.deviceTrust?.assertTrusted();
    if (context.conversationId !== conversationId || !context.permissions.includes(permission) || !(await this.memberships.isMember(conversationId, context.participantId))) throw fail();
    this.consumeRequest(context.requestId);
  }

  async authorizeAttachment(context: AuthenticatedContext, attachmentId: string, permission: Exclude<AttachmentPermission, 'attachment:create'>): Promise<AttachmentAccessRecord> {
    this.validateContext(context);
    await context.deviceTrust?.assertTrusted();
    let record: AttachmentAccessRecord | undefined;
    try { record = await this.attachments.lookup(attachmentId); } catch { throw fail(); }
    if (!record || record.conversationId !== context.conversationId || !context.permissions.includes(permission) || !(await this.memberships.isMember(record.conversationId, context.participantId))) throw fail();
    this.consumeRequest(context.requestId);
    return record;
  }

  private validateContext(context: AuthenticatedContext): void {
    if (!context || !Array.isArray(context.permissions) || !ID.test(context.sessionId) || !ID.test(context.participantId) || !UUID.test(context.conversationId) || !UUID.test(context.requestId) || !Number.isFinite(context.createdAt) || !Number.isFinite(context.expiresAt) || context.expiresAt <= context.createdAt || context.expiresAt <= this.now()) throw fail();
  }

  private consumeRequest(requestId: string): void { if (this.consumedRequests.has(requestId)) throw fail(); this.consumedRequests.add(requestId); }
}

export class MemoryAttachmentAccessStore implements AttachmentAccessStore {
  private readonly records = new Map<string, AttachmentAccessRecord>();
  async register(attachmentId: string, record: AttachmentAccessRecord): Promise<void> { if (this.records.has(attachmentId)) throw fail(); this.records.set(attachmentId, { ...record }); }
  async lookup(attachmentId: string): Promise<AttachmentAccessRecord | undefined> { const record = this.records.get(attachmentId); return record ? { ...record } : undefined; }
}
