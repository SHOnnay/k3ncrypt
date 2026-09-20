# Phase 6B Integration Security Gate Report

## Enforcement boundary

`DeviceTrustEnforcer` is the single read-only trust decision boundary. It
loads the current lifecycle snapshot, revalidates the canonical commitment,
matches device identity and scope, and returns only `trusted`, `revoked`, or
`unavailable`. Mutating lifecycle logic remains in `DeviceLifecycleService`.

ModernConversation creates the enforcer from its authenticated Vodozemac
identity/session boundary. New messages and authenticated call signaling now
require `assertTrusted()`. Device-control mutations also require the same
decision. Attachment authorization contexts can carry the same trust adapter;
the existing authenticated attachment boundary fails closed when that adapter
rejects. No lifecycle logic is duplicated in UI or transport code.

## Revocation behavior

A revoked, pending, mismatched, missing, or corrupted device is never treated as
trusted. Messaging, call invitation/response, and device-control operations
reject before encryption or transport. Attachment authorization can apply the
same check before membership/capability evaluation. Existing ciphertext and
historical messages are not modified.

## Approved-device behavior

An active approved entry is accepted only when its device identifier,
public-identity reference, user scope, and current commitment match. Device
entries remain independent; approval does not create a second user identity.

## Integration tests

Added trust-boundary tests for:

- active approved device acceptance;
- revoked device rejection;
- wrong identity rejection;
- corrupted device-list rejection.

Existing lifecycle attack suites continue to cover stale epochs, forged
authorization, replay, target confirmation, and commitment failures.

## Remaining production requirements

- A shared server-side/device-synchronized trust adapter must provide atomic
  high-water and compare-and-swap semantics across processes.
- Every production attachment request context must populate `deviceTrust` from
  the authenticated session verifier; absent context remains fail-closed.
- Target-side approval/revocation propagation and session invalidation remain
  separate lifecycle deployment work. Recovery and multi-device synchronization
  are not implemented.

## Security boundary review

Unchanged: Vodozemac, CryptoSession internals, message encryption, mailbox,
attachment encryption, media encryption, call encryption, and legacy behavior.

## Validation

Run: Jest, service TypeScript, ESLint, client production build, npm audit, and
`git diff --check`.

