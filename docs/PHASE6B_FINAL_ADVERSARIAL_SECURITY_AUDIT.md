# Phase 6B Final Adversarial Security Audit

## Reviewer conclusion

The audit reviewed the device identity model, lifecycle service, target
confirmation, persistence integrity, trust enforcement, modern messaging, call
composition, and attachment authorization boundaries. The system rejects the
tested forgery, replay, rollback, corruption, stale-writer, and identity-scope
attacks. One critical runtime bypass was found and fixed during this audit.

Phase 6B is **not ready for distributed production deployment**. The local
application boundary is substantially hardened, but cross-device propagation,
shared persistence, and target-side synchronization remain deployment blockers.

## Critical issue found and fixed

### F-01 — Revoked device could reconnect/decrypt before an operation check

- Severity: Critical
- Affected component: `ModernConversation.connect` and inbound `receive`
- Attack: A device whose local lifecycle entry was revoked could restore or
  establish a session. Outbound send and call composition checked trust, but
  connect and inbound message handling did not, allowing protected content to
  be received by a revoked local device.
- Fix: The runtime now asserts `DeviceTrustEnforcer` immediately after local
  lifecycle initialization and before transport startup, and asserts trust
  before any inbound message decryption.
- Regression: Revoked-device trust tests and modern conversation regression
  coverage remain passing.

## Bypass review

### Device identity and scope

Device entries are scoped by one identity reference and retain independent
device identifiers/public references. Lifecycle authorization uses the
authenticated sender context rather than request/UI identity fields. Wrong
scope, wrong identity reference, duplicate device, and forged author cases are
rejected.

### Enrollment

Approval stages `approved_pending_confirmation`; it cannot activate a device.
Target confirmation requires matching target identity, authenticated verified
context, commitment/epoch, expiry, confirmation digest, and replay protection.
Modified approvals, stale approvals, expired confirmations, and replayed
confirmations fail.

### Revocation

Revocation requires an active author and explicit confirmation. A revoked local
device now fails at reconnect, inbound receive, outbound message, call, and
device-control boundaries. Attachment authorization also requires a trust
adapter and rejects absent or revoked trust.

### State and persistence

Reads recompute commitments. Writes use expected epoch/commitment checks,
process-local serialization, duplicate nonce checks, high-water rollback
protection, and same-epoch fork rejection. Corrupt records and simulated
partial writes fail closed.

### Direct construction paths

The authenticated call composition now requires a `deviceTrust` adapter; raw
factory callers cannot silently construct an application call path without
trust enforcement. Attachment HTTP authorization contexts likewise require a
trust adapter. The lower-level attachment store and raw crypto primitives are
not application authorization surfaces and remain isolated behind their
existing authenticated boundaries.

## Tests attempted

- Fake device identity, wrong scope, identity substitution
- Approval without target confirmation and confirmation replay
- Modified authorization/confirmation and stale epoch/commitment
- Revoked-device trust, reconnect/inbound-operation enforcement
- Wrong call trust adapter and missing attachment trust context
- Corrupt storage, partial write, stale writer, rollback, and same-epoch fork
- Full existing messaging, attachment, call, media, and identity regressions

## Remaining findings and required fixes

| Finding | Severity | Status | Required next step |
|---|---|---|---|
| Shared multi-process/device atomic lifecycle store is not implemented | High | Open | Deploy a transactional compare-and-swap/high-water adapter with uniqueness constraints. |
| Remote revocation propagation and session invalidation are incomplete | High | Open | Deliver authenticated lifecycle events to every device and invalidate affected sessions before accepting content. |
| Target-side approval staging across a real second-device runtime is not wired end-to-end | High | Open | Add authenticated target persistence and synchronization tests before production rollout. |
| Epoch enforcement is not independently integrated into every future sync/media adapter | Medium | Open | Require `DeviceTrustEnforcer` and current epoch in each production adapter. |

## Readiness decision

**NOT READY for distributed production deployment.** The application-local
security boundary now fails closed for revoked devices and direct construction
bypasses, but production requires shared atomic state, revocation propagation,
and real two-device synchronization before Phase 6B can be considered complete.

No Vodozemac, CryptoSession internals, messaging encryption, mailbox,
attachment encryption, media encryption, or call encryption was modified.

