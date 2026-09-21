# Phase 6C security principles

Status: design only. Baseline: `fe59eed5576fa453407766272c594727ea81ca2c`.
The [architecture](PHASE6C_COMPLETE_ARCHITECTURE_SPECIFICATION.md),
[threat model](PHASE6C_THREAT_MODEL.md), and
[roadmap](PHASE6C_IMPLEMENTATION_ROADMAP.md) form one design package.
These are proposed Phase 6C decisions, not evidence of implemented capabilities.

## Authority and confidentiality

1. User devices own identity and decryption material. Servers may route, deny,
   store ciphertext, and enforce quotas; they cannot approve identity, enrollment,
   recovery, membership, or verification. Operator access never confers trust.
2. Each device retains independent keys and sessions. A routing identifier,
   directory entry, digest, backup secret, or server assertion alone never proves
   that a device owns an existing verified identity.
3. No server master decryption key, escrow, administrator recovery, universal
   password, or mandatory biometric. A local passcode/passphrase unlock path is
   required. Biometrics may optionally release a local wrapping key.
4. Unknown trust, missing membership evidence, contradictory epochs, uncertain
   transactions, and unsupported security profiles stop sensitive operations.
   Cached local reads follow vault policy; uncertainty never authorizes release.
5. Recovery after full loss creates a fresh identity and explicit trust reset.
   Possession of a backup does not recreate old peer verification or session state.
6. Revocation protects future authorized release after the relevant participants
   adopt and enforce it. It cannot erase copies, undo prior disclosure, compel a
   malicious endpoint, or guarantee instantaneous partition-wide invalidation.

## Extension boundaries

Vodozemac, CryptoSession internals, existing message/mailbox formats, attachments,
media, one-to-one calls, and legacy behavior remain frozen. Future group protocols
are separately versioned adapters and require approval and independent review.
Their protocol-specific keys must bind to existing device authority; they must
not introduce a parallel account authority. No automatic migration or downgrade.

Trust-changing transitions require explicit visible confirmation, authenticated
evidence, and durable atomic persistence before success is exposed. A local
wrapper type or TypeScript `private` annotation alone is not a security proof.
Code must derive identities from verified runtime context, recheck trust at use,
and keep unsafe entry points unreachable in production composition.

## Privacy and operations

Permissions are purpose-specific and requested at the foreground action. Capture
indicators persist while tracks are active; cancel/end/error releases tracks.
There is no recording feature, background collection, or default analytics.
Server inability to decrypt does not imply anonymity: routing, IP addresses,
traffic volume, push delivery, and participation timing can remain observable.

Client updates are part of the security boundary. A malicious authorized binary
can steal plaintext on an unlocked endpoint. Release signing, review, reproducible
build evidence and transparency reduce risk; they do not make such compromise
impossible. Recovery kits must never appear in telemetry, crash dumps, clipboard
history, notification bodies, or automatically synchronized OS backups.

## Evidence standard

Passing unit tests does not close a finding without production-path evidence.
An interface is not a deployed durable store; a factory is not runtime delivery;
a local phase enum is not distributed agreement. Every readiness claim must name
its concrete implementation, adversarial tests, supported platforms, and remaining
limitations. Phase 6B findings F-01–F-09 remain open until independently reverified.
