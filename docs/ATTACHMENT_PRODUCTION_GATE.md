# Attachment production gate

Status: **not ready to mount**. This is a boundary review, not a production attachment deployment.

## Existing implementation

The browser-side media workflow encrypts bytes locally and puts the attachment key, capability, and media reference inside an existing E2EE message. The HTTP route factory in `backend/api/attachments/index.ts` requires an injected request authenticator and `AuthenticatedAttachmentService`. That service applies `ConversationAuthorizationService` before calling `AttachmentService`; `MongoAttachmentPersistence` can store encrypted metadata and ciphertext chunks with unique indexes. The default API router does **not** mount the attachment factory; the app's `MediaProvider` has no production workflow injection. The only `X-Test-Participant` authenticator is created inside isolated test applications.

## Missing dependencies and security reason

1. A real application session verifier must authenticate every HTTP request against the already established participant identity and conversation, derive a short-lived `AuthenticatedContext` with a unique request ID and scoped permissions, and reject expiry/replay. A client-provided participant ID, room ID, or test header cannot establish membership. Current socket/invitation state does not provide this verified HTTP assertion.
2. A reviewed, durable `ConversationMembershipStore` must establish current participant-to-conversation authorization across processes and restarts, including removal/revocation. A room link alone is not proof of identity.
3. A durable `AttachmentAccessStore` must bind an opaque attachment ID to its conversation and owner across restarts. The existing memory implementation is for tests; attachment metadata persistence does not itself supply the membership/access registry. Request-replay tracking also needs deployment-wide behavior, not only the current in-process `Set`.
4. Composition with the actual Mongo connection needs startup index creation, lifecycle/expiry cleanup, failure/restart and multi-instance tests, quotas, and storage/log inspection. The test persistence fixture is not Mongo evidence. The client gateway must obtain context only from the real application session; it must never send an unprotected attachment secret in a URL.

Without these pieces, mounting routes would allow an untrusted HTTP assertion or inconsistent authorization and would claim delivery that the default app cannot provide. No mock verifier, public URL, independent identity system, or cryptographic change is authorized to fill the gap.

## Future integration contract

After an independent security review of the existing session-to-HTTP binding, supply `authenticate(request): Promise<AuthenticatedContext | undefined>` to `createAttachmentRouter`; back `ConversationAuthorizationService` with durable membership and attachment-access adapters; compose `AuthenticatedAttachmentService` with `AttachmentService(new PersistentAttachmentDeliveryStore(new MongoAttachmentPersistence(db)))`. Preserve generic route errors, scoped hashed capabilities, local-only decryption, and ciphertext-only storage. Wire the client workflow only when the authenticated transport exists. Gate release on Alice/Bob authorization, wrong participant/conversation/capability, replay/expiry, restart/failover, bounds, Mongo record inspection, and deployment log review. Until then the route remains unmounted and the UI reports media unavailable.
