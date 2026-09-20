# Phase 6B.2/6B.3 device lifecycle completion report

## Scope

Implemented an isolated device lifecycle service for enrollment and revocation. Recovery, enrollment UI, notifications, mobile synchronization, production database adapters, and changes to frozen protocols were not implemented.

## Implementation summary

- Added `service/src/devices/lifecycle.ts`.
- Added enrollment request creation with bounded expiry and cryptographically random nonce generation.
- Added enrollment authorization objects binding user scope, author/target identities, previous epoch/commitment, sequence, nonce, timestamp, and expiry.
- Added SHA-256 authorization digest verification over deterministic canonical fields.
- Added an explicit `AuthenticatedDeviceContext` requiring an encrypted, ready `CryptoSession`, verified context, conversation scope, and author identity references.
- Added the required injected `DeviceAuthorizationVerifier`; there is no permissive or raw-transport fallback.
- Added `DeviceLifecyclePersistence` interfaces with atomic enrollment/revocation commit contracts. No fake production database implementation was added.
- Added enrollment and revocation state transitions, immutable list generation, epoch increments, commitment chaining, duplicate/rollback/stale checks, and revoked-device invalidation.
- Exported the lifecycle boundary from the isolated devices module/SDK.

## Security guarantees

- Fake issuers and wrong author identity references are rejected by the authenticated-context verifier boundary.
- Wrong targets, duplicate device IDs, expired requests, malformed/tampered authorization, replayed authorization, stale epochs, rollback, and commitment mismatch fail closed.
- Enrollment and revocation require the current list epoch and previous commitment.
- Device-list, epoch, commitment, authorization claim, and lifecycle status are required to commit atomically through the persistence interface.
- Revoked devices cannot authorize future lifecycle operations; lifecycle state is immutable in each historical snapshot.
- No private key, CryptoSession internals, message content, mailbox state, attachment key, media key, or recovery secret is stored or transferred.

## Tests

Lifecycle tests cover:

- successful enrollment and active-device verification;
- successful revocation and revoked-device verification;
- fake issuer and fake target;
- expired request;
- authorization tampering and commitment mismatch;
- replayed enrollment/revocation;
- wrong/stale epoch and rollback;
- commitment chain and epoch increments;
- unauthorized revoke and already-revoked target.

## Validation

The lifecycle module has a passing TypeScript check and targeted Jest coverage. Full repository validation is required before treating this as deployment-ready. The persistence interface intentionally remains unimplemented until a reviewed durable atomic adapter is selected.

## Remaining risks

1. The runtime must compose `AuthenticatedDeviceContext` from the real `ModernConversation`/`CryptoSession` identity boundary; the lifecycle service does not infer identity from routing IDs.
2. A production persistence adapter must provide atomic claim-and-commit, uniqueness, TTL cleanup, restart recovery, and multi-instance consistency.
3. Enrollment/revocation control envelopes, notifications, and UI are not wired into application flows.
4. Recovery and full-device-loss identity replacement remain out of scope.
5. Existing Phase 1–5 messaging, mailbox, attachment, media, call, and legacy protocols remain frozen and require later epoch-adapter integration tests.
