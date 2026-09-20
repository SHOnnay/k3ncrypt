# Phase 6B Security Remediation 1 Report

## Scope

This remediation closes the authority-boundary weakness identified in the
Phase 6B assault review. It is limited to lifecycle authorization binding and
apply-path author verification. It does not change persistence, recovery,
target-side ceremonies, epoch enforcement in other subsystems, or any
cryptographic primitive.

## Before

`AuthenticatedDeviceContext` exposed `authorDeviceId` and
`authorIdentityReference` as free-form fields. Lifecycle code compared
authorization fields with those values, while the authorization digest was
only SHA-256 integrity metadata. A digest alone could not prove which
authenticated device approved a mutation.

## After

Lifecycle contexts now carry an explicit `authenticatedSender` assertion from
the authenticated runtime boundary:

- device identifier
- identity reference
- user scope
- verified status

Every enrollment approval/apply and revocation approval/apply path now:

1. requires an encrypted, ready CryptoSession;
2. requires a verified authenticated sender;
3. resolves the author device from the current device list using that sender;
4. requires the author to be active and in the same identity scope;
5. requires authorization author fields to match the authenticated sender;
6. validates epoch, previous commitment, expiry, and the canonical digest.

The modern runtime constructs this context from its local authenticated
Vodozemac identity/session boundary. UI input and request payloads are not used
as the author identity. Legacy conversations have no lifecycle construction
path.

The digest remains an integrity check. Authenticity comes from the existing
authenticated CryptoSession context and the runtime verifier; no new keys,
identity system, or signing infrastructure was introduced.

## Regression tests

Added adversarial coverage for:

- fake authorization fields;
- modified author identity;
- wrong authenticated sender device;
- wrong user scope;
- unverified sender;
- valid authorized mutation;
- existing revoked-device, replay, expiry, epoch, commitment, and duplicate
  protections.

## Security boundary

Unchanged: Vodozemac, CryptoSession internals, message encryption, mailbox,
attachments, media, calls, and legacy behavior. The remediation only narrows
the lifecycle service's authorization input and modern runtime context.

## Remaining Phase 6B findings

- The local persistence adapter is not an atomic multi-instance compare-and-set
  store; concurrent mutation and crash consistency require a production adapter.
- Incoming approval/revocation target-side ceremonies remain intentionally
  unimplemented and must be designed before distributed lifecycle completion.
- Stored commitments should be recomputed and checked on read.
- Same-epoch divergent commitments should be rejected by synchronization
  helpers.
- Pending enrollment state is not yet durable across restart.

## Validation

The remediation was validated with npm clean-install dependencies, lifecycle
regression tests, full Jest, TypeScript, ESLint, client production build,
`npm audit`, and `git diff --check`.

