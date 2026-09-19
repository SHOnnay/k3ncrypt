# Authenticated authorization context security model

This phase adds an authorization-only boundary for future attachment routes.
It does not create accounts, passwords, bearer tokens, or a second identity
system. An existing session verifier must provide the per-request
`AuthenticatedContext`.

## Trust boundary

The verifier is the trust boundary. It supplies an opaque session ID,
participant ID, conversation ID, scoped permissions, request ID, and short
creation/expiry timestamps. The context contains no message content, keys,
passwords, or private identity material.

`ConversationAuthorizationService` then fails closed unless the context is
well formed, unexpired, scoped to the requested conversation, carries the
required permission, belongs to a known conversation member, and has not
already been consumed for another request.

## Request flow

1. Route middleware asks the existing session verifier for a context.
2. The authorization service validates expiry, scope, membership, permission,
   and request replay.
3. Attachment access additionally resolves the opaque attachment ID and checks
   that its recorded conversation matches the context.
4. Only then does `AuthenticatedAttachmentService` call `AttachmentService`.
5. AttachmentService still validates the capability hash and lifecycle state.

The route contracts cover `POST /attachments/create`,
`PUT /attachments/:id/chunk`, `POST /attachments/:id/complete`,
`GET /attachments/:id/chunks`, and `DELETE /attachments/:id`. No Express
handlers are registered until a real verifier is available; mock
authentication would weaken the boundary.

## Token and replay model

This layer does not mint session tokens. An upstream verifier is responsible
for short-lived, purpose-scoped session credentials and hash-only persistence.
The authorization service consumes a unique request ID once and rejects an
expired or replayed context. Attachment capabilities remain hashed and
constant-time checked by the existing delivery store.

## Threat model and limitations

Cross-participant, cross-conversation, expired-context, missing-permission,
unknown-attachment, and replay attempts fail with one generic authorization
error. The server still cannot decrypt attachment ciphertext or access media
keys. A compromised authenticated endpoint remains outside this boundary.

The repository does not yet expose a production session verifier or persistent
conversation-membership/attachment directory. Those are explicit adapter
interfaces; wiring them requires the deployment's existing authentication
system and database, not a new credential scheme.
