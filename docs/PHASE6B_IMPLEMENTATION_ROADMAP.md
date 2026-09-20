# K3ncrypt Phase 6B implementation roadmap

Status: design-only roadmap. Phase 6B must not begin implementation until the threat model and protocol design receive an independent security review.

## Phase 6B.1 — device model and enrollment ceremony

**Goal:** define and implement independently keyed device records and explicit enrollment without changing existing conversations.

**Dependencies:** Phase 6A authenticated session boundary, durable membership/revocation storage, approved canonical device-list schema, user-facing verification ceremony design.

**Security requirements:** per-device key generation; one-time expiring enrollment; public-only QR/code payload; trusted-device authorization; no automatic verification inheritance; monotonic epoch and rollback rejection; no server-created identity.

**Testing requirements:** fake-server enrollment, QR/code tampering, replay/expiry, wrong participant, malicious relay, device substitution, concurrent enrollment, stale epoch, downgrade, and storage leakage tests.

**Completion criteria:** an independent review accepts the device model and ceremony; a new device is visibly pending until verified; no private key or recovery secret leaves its origin device; existing conversations and protocol modes are unchanged.

## Phase 6B.2 — verification, revocation, and session fan-out

**Goal:** make device trust explicit and ensure revoked/stale devices cannot receive future protected traffic.

**Dependencies:** 6B.1 device records/epochs, existing contact verification/change-review model, mailbox/transport adapters, durable revocation state.

**Security requirements:** per-device verification; changed-pending-review on key/epoch mismatch; revocation advances epoch and fails closed; device-scoped sessions; no copied private session state; bounded offline delivery; attachment/call authorization tied to current membership.

**Testing requirements:** revocation races, offline device reconciliation, compromised secondary device, post-revocation delivery, session restore, replay, cross-conversation/device access, call admission, attachment authorization, and legacy isolation.

**Completion criteria:** users can inspect and revoke devices; revoked devices cannot establish or receive new sessions; conflicting/offline updates fail closed; contacts receive appropriate identity-change warnings; existing two-party flows pass regression and migration tests.

## Phase 6B.3 — recovery and operational acceptance

**Goal:** provide an optional user-controlled recovery path without server key escrow or silent identity replacement.

**Dependencies:** accepted enrollment/revocation protocol, recovery threat model, encrypted storage/backup provider boundary, deployment logging and incident-response plan.

**Security requirements:** encrypted/versioned recovery package; one-time expiring ceremony; rollback detection; explicit replacement/revocation of prior devices; no plaintext recovery secret; no support/admin bypass; clear irrecoverability behavior.

**Testing requirements:** stolen recovery material, malicious server, restore rollback, partial restore, lost-all-devices, recovery replay, concurrent recovery, backup leakage, endpoint compromise, and user-cancellation tests.

**Completion criteria:** recovery is optional and user-controlled; a restored identity cannot silently inherit old verification; prior devices are visibly handled; backups contain ciphertext only; external review accepts the availability/security tradeoff.

## Release gates

Each sub-phase must retain the complete Phase 1–5 regression suite and add unit, integration, adversarial, browser/native lifecycle, restart/failover, and deployment tests. No sub-phase may modify Vodozemac, CryptoSession internals, message/mailbox semantics, attachment/media encryption, call cryptography, or legacy behavior. No production default or automatic migration may change until rollback and downgrade evidence is reviewed.

If a proposed shortcut copies private keys, trusts a server device flag, uses a permanent QR bearer token, disables verification after recovery, or exposes plaintext backup/recovery material, reject it rather than reducing the scope of the threat model.
