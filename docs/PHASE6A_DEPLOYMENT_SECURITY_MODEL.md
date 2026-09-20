# Phase 6A deployment security model

Phase 6A hardens deployment composition around the existing Phase 1–5 boundaries. It does not alter Vodozemac, CryptoSession, message/mailbox protocols, attachment encryption, media encryption, or call-signaling cryptography.

## Request authentication and authorization

Attachment routes may be mounted only when the host supplies a real authenticated session verifier. The verifier must derive a short-lived `AuthenticatedContext` containing participant, conversation, scoped permission, request ID, creation time, and expiry. Client-provided participant headers, room IDs, attachment IDs, or test authenticators are not authentication.

`ConversationAuthorizationService` remains the authorization boundary. It must consult durable membership/revocation state and a durable attachment-access registry, fail closed on expiry/replay/wrong conversation, and return generic errors. `createProductionAuthenticatedAttachmentService` composes those stores with the existing `AttachmentService` and persistent ciphertext delivery store; it does not mount routes or create credentials.

## Storage and privacy

Metadata storage may contain only encrypted metadata, opaque IDs, chunk counts/sizes, status, and timestamps. Chunk storage contains ciphertext, nonce/authentication data, indexes, and timestamps. No server component may decrypt, inspect media, store attachment keys, generate previews, or expose public URLs. Mongo indexes and cleanup must be created during controlled startup and verified after restart/failover.

## Logging and monitoring

Logs and metrics must be generic and redacted. Never record message/media plaintext, identity private material, CryptoSession state, attachment capabilities, HTTP authorization headers, QR/recovery secrets, SDP/ICE payloads, or full URLs containing sensitive fragments. Monitor authorization failures, expiry, replay/capacity outcomes, storage errors, rate limits, and abnormal attachment/call volume without turning telemetry into a content side channel.

## Secrets management

Use a deployment secret manager for database credentials, session-verifier keys, TURN credentials, signing/configuration secrets, and operator access. Do not commit secrets, place them in browser bundles, or reuse test credentials. Rotate credentials with an incident/revocation plan and verify that logs, crash reports, backups, and CI artifacts do not retain them.

## TURN/relay and network controls

TURN credentials must be short-lived and scoped to the call service. Prefer relay-only policy where peer-IP privacy requires it; document the metadata and availability visible to relay operators. Enforce same-origin/restricted CORS, CSRF protection for authenticated HTTP routes, secure headers/CSP, TLS termination review, rate limits, request-size limits, and bounded connection lifetimes.

## Browser and CI validation

The Playwright configuration uses isolated backend/client ports and Chromium, Firefox, and WebKit projects. Chromium and WebKit modern-conversation flows pass locally. Firefox remains a supported-CI requirement because the local macOS host has not completed that flow. Tests must not disable browser sandboxing, weaken assertions, or reuse uncontrolled servers.

## Operational gates

Before mounting production routes, obtain evidence for: authenticated Alice/Bob attachment access; wrong participant/conversation/capability rejection; expiry and restart recovery; ciphertext-only Mongo/object storage inspection; multi-instance replay claims; secret rotation; log redaction; backup/restore; rate-limit and denial-of-service behavior; and incident rollback. Until these gates pass, keep the route factory unmounted and report protected media as unavailable.
