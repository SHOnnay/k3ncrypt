# Attachment backend security model

The attachment backend boundary is represented by `AttachmentService` over the
existing `AttachmentDeliveryStore`. It requires an already authorized
conversation context; it does not create users, sessions, passwords, public
URLs, or a parallel authentication system.

## Request flow

1. An existing conversation participant supplies the conversation context and
   encrypted metadata/size/chunk declaration.
2. The service creates one opaque attachment ID and a single-upload capability.
   The delivery store retains only a hash of the scoped credential.
3. Chunk writes validate authorization, index, nonce, size, expiry, duplicate
   consistency, and bounded limits.
4. Completion requires every chunk. Retrieval returns ciphertext chunks only.
5. Delete and expiry clear ciphertext state.

The capability is scoped to the conversation participant and attachment
credential created for that upload. Wrong participant, malformed capability,
unknown ID, expired upload, and replayed/invalid access fail with generic
errors. HTTP route handlers are intentionally not added until the repository's
existing authenticated conversation context is available to Express.

## Storage boundaries

Metadata storage may contain only opaque ID, encrypted metadata, size/count,
timestamps, expiry, status, and delivery state. Ciphertext storage contains
encrypted chunks. No key, filename, plaintext MIME, path, preview, thumbnail,
identity, or message content is accepted. The server never decrypts media.

Production Mongo/object-storage adapters must preserve this split and add
atomic quota accounting, TTL cleanup, rate-limit hooks, and restart-safe
idempotency. No cloud provider or public object URL is part of this design.

## Threat model and limitation

The relay/storage operator sees ciphertext size, timing, opaque IDs, expiry,
and authorized delivery metadata, but cannot decrypt media. A compromised
unlocked endpoint/browser remains outside the model. Because no existing
Express middleware currently exposes a verified participant/session context,
this phase stops at the authenticated service boundary rather than shipping an
insecure route that would impersonate authentication.
