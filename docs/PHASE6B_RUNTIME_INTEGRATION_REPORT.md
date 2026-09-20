# Phase 6B runtime integration report

## Implemented

- Added `AuthenticatedDeviceControlChannel`, which encrypts device-control messages through the existing modern signaling `CryptoSession` and exposes no raw send path.
- Added `SecureStorageDeviceLifecyclePersistence` as a local single-record adapter that commits list, epoch, commitment, and authorization state together. It is not a replacement for a durable multi-instance deployment adapter.
- Connected `ModernConversation` to initialize the local device lifecycle state only for the modern path and to expose device lifecycle operations through the authenticated context.
- Added request, approval, rejection, and revocation control-message delivery boundaries.
- Added client settings controls for requesting approval, approving/rejecting a pending request, and revoking another active device. Legacy conversations do not expose these controls.
- Added runtime/control-channel regression tests and retained lifecycle attack tests.

## Security guarantees

- The lifecycle service requires an encrypted, ready `CryptoSession` and verified device context.
- Author, target, epoch, commitment, digest, expiry, and replay checks remain mandatory.
- Legacy `ChatE2EE` never constructs or exposes device lifecycle operations.
- Device control is fail-closed when the session is unavailable or unauthenticated.
- No Vodozemac, CryptoSession internals, messaging, mailbox, attachment, media, call, or legacy protocol code was changed.
- No recovery flow or private-key transfer was added.

## Validation

- Lifecycle and control-channel Jest tests pass.
- Full Jest, TypeScript, ESLint, client production build, npm audit, and diff checks are required for the final commit.

## Remaining risks and boundaries

1. Incoming approval/revocation requires a target-side ceremony and durable replay/list persistence before production deployment; malformed controls are dropped rather than trusted.
2. The local SecureStorage adapter is single-record and browser-local. A shared atomic multi-instance adapter remains a deployment requirement.
3. The UI exposes only explicit controls; it does not implement recovery, mobile sync, notifications, or automatic trust changes.
4. Epoch enforcement in messaging, attachments, and calls remains an adapter integration gate; historical ciphertext is unchanged.
