# K3ncrypt Phase 6B implementation-readiness gate

Status: **READY FOR IMPLEMENTATION** for the scoped Phase 6B.1 local model and canonical validation work. This gate records the approved normative addenda; it does not authorize changes to Phase 1–5 protocols or cryptographic primitives.

## 1. Current status

The Phase 6B architecture, enrollment ceremony, revocation policy, recovery behavior, epoch model, authority proof, canonical encoding, and fail-closed conflict policy are now normative. The approved decisions are recorded in [the authority specification](PHASE6B_DEVICE_LIST_AUTHORITY_SPEC.md), [the canonical encoding specification](PHASE6B_CANONICAL_ENCODING_SPEC.md), and [the epoch matrix](PHASE6B_EPOCH_ENFORCEMENT_MATRIX.md). Items that can safely be resolved while implementing deployment adapters remain non-blocking.

## 2. Blocking decisions

The previously blocking A/B decisions are resolved by the approved addenda below. No A/B blocker remains for Phase 6B.1.

| ID | Blocker | Class | Why it blocks implementation | Required decision | Who decides | Completion criteria |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Author proof for a device-list mutation | Resolved | The authority addendum makes the existing authenticated `CryptoSession` the sole proof boundary and rejects digest-only or server authorization. | Implement only the session-bound control path. | Security architect + identity/session owner | See [device-list authority specification](PHASE6B_DEVICE_LIST_AUTHORITY_SPEC.md) and its proof/test contract. |
| B2 | Canonical serialization and fingerprint encoding | Resolved | The encoding addendum fixes canonical JSON rules, SHA-256 commitment, fingerprint representation, versioning, and vector requirements. | Implement only the normative encoding. | Protocol architect + client/platform owner | See [canonical encoding specification](PHASE6B_CANONICAL_ENCODING_SPEC.md). |
| B3 | Full-device-loss identity continuity | Resolved | Recovery is explicitly a fresh identity/new epoch event with old-device invalidation and contact re-verification. | Implement only the explicit replacement ceremony; no silent continuity. | Security architect + identity/verification owner | Recovery transitions and rejection cases are specified in the authority addendum. |
| B4 | Epoch enforcement at existing adapters | Resolved | The epoch matrix fixes current-epoch requirements and stale/revoked outcomes for authorization, sessions, calls, attachments, verification, and historical data. | Implement adapter gates without changing frozen formats. | Phase 3–5 owners + security architect | See [epoch-enforcement matrix](PHASE6B_EPOCH_ENFORCEMENT_MATRIX.md). |

### Decision questions for A/B blockers

#### B1 — What authenticates a device-list mutation?

**Question:** Can the existing authenticated modern `CryptoSession` be the complete author proof for every device-list control message, including relay delivery and restart, without an offline detached signature?

- Option 1: session-bound control only; no list update is accepted outside an authenticated modern session. **Recommended.**
- Option 2: expose an existing identity signature capability, if the current API already provides one, and bind it to the same canonical object; do not create a new key.
- Option 3: add a new root/device-list signing key. **Rejected** because it changes the frozen key hierarchy and recovery model.

**Reason:** Option 1 preserves the current trust boundary and prevents a digest from being mistaken for identity proof. Option 2 is acceptable only as an existing primitive adapter and requires API evidence.

**Acceptance:** the proof contract names the session channel, author device identity, canonical bytes, expiry/sequence/epoch binding, and exact fail-closed errors for wrong author, wrong scope, stale epoch, and replay.

#### B2 — What are the canonical bytes and user-visible fingerprint?

**Question:** Which exact serialization and display encoding are normative for a device-list commitment and enrollment comparison?

- Option 1: versioned canonical JSON with sorted keys/records, UTF-8, integer milliseconds, explicit null/omission rules, and a fixed hash; fixed-width grouped hexadecimal for display. **Recommended only if independently vector-tested.**
- Option 2: a binary canonical format already supported by the project, with published byte vectors and a fixed display encoding.
- Option 3: runtime-native JSON/stringification. **Rejected** because ordering and numeric/Unicode behavior vary.

**Acceptance:** normative field order/types, Unicode and timestamp rules, hash input, display grouping, QR payload schema, and at least two cross-platform vectors are committed to the protocol test plan before implementation.

#### B3 — Does full-device-loss recovery preserve identity continuity?

**Question:** After all trusted devices are lost, does replacement retain prior contact verification?

- Option 1: fresh replacement device identity, new epoch, all prior devices revoked/recovery-replaced, contacts re-verify. **Recommended.**
- Option 2: preserve a stable user/root identity through recovery material. **Not selected**; it requires a separately reviewed root-key and continuity design.
- Option 3: server/admin reset. **Rejected.**

**Acceptance:** one-time recovery transaction, fresh identity fingerprint, contact notification, prior-device invalidation, replay/rollback handling, and irrecoverable-loss behavior are specified as state transitions and tests.

#### B4 — What does an epoch gate mean to each existing subsystem?

**Question:** Which operations require current epoch equality, and what happens when a peer is stale?

- Option 1: gate only new device admission and membership-sensitive control operations; reconcile before message/attachment/call admission; preserve existing ciphertext and formats. **Recommended.**
- Option 2: rewrite or rekey existing conversations on every epoch. **Rejected** because it changes frozen Phase 1–5 protocols.

**Acceptance:** a table maps each operation to `accepted`, `reconcile-required`, or `rejected`; stale/revoked tests cover messaging/mailbox, attachments, calls, and verification without protocol migration.

## 3. Non-blocking items

These do not prevent starting Phase 6B.1, provided their interfaces are recorded and tests use deterministic fakes.

| Item | Class | Why non-blocking | Required before rollout |
| --- | --- | --- | --- |
| Durable shared list/replay persistence and atomic claim implementation | D | Phase 6B.1 can validate local state with an explicit persistence interface and memory test adapter. | Production adapter review, restart/failover tests, TTL cleanup, multi-instance atomicity. |
| Offline notification delivery and retry policy | C/D | Core conflict behavior can fail closed without a final notification transport policy. | Deployment contract for delivery, retention, retry, and user-visible warning. |
| Device labels, retention, and operational metrics | D | Metadata ergonomics do not define cryptographic authority. | Privacy review of retention and logs; no secrets or plaintext identifiers in metrics. |
| Browser/platform keystore and QR presentation details | C/D | The state machine can be tested with injected local storage and presentation adapters. | Platform-specific permission, persistence, and visual-comparison tests. |
| Capacity/rate limits and abuse handling | D | These are bounded service controls, not membership authority. | Deployment limits, monitoring, and generic-error behavior. |

## 4. Minimum design completion before Phase 6B.1

The four required normative addenda are now complete:

1. **Proof contract:** `PHASE6B_DEVICE_LIST_AUTHORITY_SPEC.md`.
2. **Canonical vectors/encoding contract:** `PHASE6B_CANONICAL_ENCODING_SPEC.md`.
3. **Recovery state and authority contract:** `PHASE6B_DEVICE_LIST_AUTHORITY_SPEC.md`.
4. **Epoch adapter matrix:** `PHASE6B_EPOCH_ENFORCEMENT_MATRIX.md`.

Engineers may now begin **Phase 6B.1 local model and canonical validation**. Durable deployment persistence, notification operations, and browser-specific presentation remain later gates and must not be faked during 6B.1.

## 5. Final implementation checklist

- [x] Device authority finalized (B1 proof contract)
- [x] Enrollment protocol finalized (including proof, nonce, expiry, and pending/active transitions)
- [x] Revocation finalized (epoch advance, stale behavior, notification semantics)
- [x] Recovery finalized (fresh identity, trust reset, prior-device invalidation)
- [x] Encoding finalized (canonical bytes, commitment, fingerprint/QR vectors)
- [x] Epoch behavior finalized (adapter matrix and rollback/conflict outcomes)
- [x] Integration boundary finalized (existing identity/session APIs only; no new primitive)

## 6. Final verdict

**READY FOR IMPLEMENTATION** (Phase 6B.1 only).

The next action is to implement and test only the local model, canonical serialization, commitments, lifecycle validation, and epoch invariants in Phase 6B.1. Before enrollment/recovery integration or deployment, publish the required canonical test vectors and satisfy the non-blocking persistence, notification, platform, and adapter test gates. No Phase 1–5 protocol or cryptographic primitive may change.
