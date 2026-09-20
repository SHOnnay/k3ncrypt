import type { AttachmentDeliveryStore } from '../../service/src/attachments';
import { AttachmentService } from '../../service/src/attachments';
import { AuthenticatedAttachmentService } from './authenticatedAttachmentService';
import { ConversationAuthorizationService, type AttachmentAccessStore, type ConversationMembershipStore } from './authorizationContext';

/**
 * Production composition boundary. The host must provide durable membership
 * and attachment-access stores; this module supplies no authenticator or
 * persistence implementation and does not mount routes.
 */
export interface ProductionAttachmentAuthorizationDependencies {
  readonly memberships: ConversationMembershipStore;
  readonly access: AttachmentAccessStore;
}

export const createProductionAuthenticatedAttachmentService = (
  authorization: ProductionAttachmentAuthorizationDependencies,
  delivery: AttachmentDeliveryStore,
  now?: () => number,
): AuthenticatedAttachmentService => new AuthenticatedAttachmentService(
  new ConversationAuthorizationService(authorization.memberships, authorization.access, now),
  new AttachmentService(delivery),
  authorization.access,
);
