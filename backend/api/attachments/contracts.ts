import type { AuthenticatedContext } from '../../security/authorizationContext';

export interface AttachmentRouteRequest {
  params: { id?: string };
  body: unknown;
  authenticatedContext?: AuthenticatedContext;
}

export interface AttachmentRouteContract {
  create: 'POST /attachments/create';
  chunk: 'PUT /attachments/:id/chunk';
  complete: 'POST /attachments/:id/complete';
  retrieve: 'GET /attachments/:id/chunks';
  delete: 'DELETE /attachments/:id';
}

/** Route handlers must obtain context from existing auth middleware before dispatch. */
export interface AttachmentRouteDependencies {
  authenticate(request: AttachmentRouteRequest): Promise<AuthenticatedContext | undefined>;
}
