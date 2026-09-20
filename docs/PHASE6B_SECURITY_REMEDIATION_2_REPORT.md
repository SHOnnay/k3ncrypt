# Phase 6B Security Remediation 2 Report

## Scope

This remediation adds an explicit target-side lifecycle ceremony. An issuer's
approval no longer activates an enrolled device. Revocation also requires an
explicit confirmation object before the lifecycle mutation is committed.

## Changes

- Device lifecycle states now distinguish `pending_enrollment`,
  `approved_pending_confirmation`, `active`, and `revoked`.
- Enrollment approval commits the target as
  `approved_pending_confirmation`; it cannot become active through approval
  alone.
- `confirmEnrollment` requires a valid confirmation digest, unexpired
  authorization, matching target device and identity, an authenticated verified
  target context, the expected epoch/commitment, and a one-time confirmation
  nonce. Only then is the target promoted to `active`.
- `applyRevocation` now requires an explicit, authenticated confirmation object;
  silent issuer-side mutation is rejected.
- The settings flow asks for explicit user confirmation before revocation.
- Lifecycle tests cover approval without confirmation, target mismatch,
  confirmation replay, stale state, forged confirmation, and successful target
  confirmation, alongside the existing authorization attacks.

## Security boundary

The target identity is taken from `AuthenticatedDeviceContext.authenticatedSender`
and is compared with the authorization target. It is not read from UI input or
trusted solely from the authorization payload. Confirmation digests provide
canonical integrity; authenticated CryptoSession context remains the authority.
No Vodozemac, CryptoSession internals, messaging, mailbox, attachments, media,
or calls were changed.

## Remaining limitations

- A production target-side transport adapter must persist and stage incoming
  approval events against the target's local device list before confirmation.
- Persistence remains the existing local non-atomic adapter; no database or
  recovery design was added.
- Revocation propagation to other devices and session invalidation remain future
  lifecycle integration work.
- Recovery is intentionally not implemented.

## Validation

Ran npm clean-install dependencies, Jest, service TypeScript, ESLint, client
production build, npm audit, and `git diff --check`.

