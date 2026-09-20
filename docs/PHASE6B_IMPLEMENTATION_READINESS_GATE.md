# K3ncrypt Phase 6B implementation-readiness gate

Status: **NOT READY**. This is a review checklist derived from the existing Phase 6B design package. It does not introduce a new protocol or authorize implementation.

## 1. Current status

The Phase 6B architecture, enrollment ceremony, revocation policy, recovery direction, epoch model, and fail-closed conflict policy are documented. Implementation is blocked only where the existing documents leave a security authority or wire-level contract ambiguous. Items that can safely be resolved while implementing adapters are explicitly separated below.

## 2. Blocking decisions

Only classifications **A** and **B** block coding.

| ID | Blocker | Class | Why it blocks implementation | Required decision | Who decides | Completion criteria |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Author proof for a device-list mutation is not concrete | A/B | The design chooses an existing verified device, but does not establish whether the current identity/session APIs can provide the required proof on every delivery path. A digest cannot authenticate an author. | Use the existing authenticated `CryptoSession` as the sole Phase 6B control-path proof; permit no offline/list-relay path until an existing identity signature capability is confirmed, or explicitly approve a reviewed existing capability if one is already exposed. | Security architect + identity/session owner | A written API-level proof contract names the exact existing primitive, covered bytes, expected author identity, and rejection behavior. No new key or detached signature is required. |
| B2 | Canonical serialization and fingerprint encoding are unspecified | A/B | Different clients could compute different list commitments or show different enrollment fingerprints, causing split-brain membership or unsafe user confirmation. | Select one deterministic encoding, field order, integer/time representation, Unicode policy, hash/commitment algorithm already permitted by the frozen boundary, and human-display format. | Protocol architect + client/platform owner | Cross-platform test vectors are published; two independent implementations produce identical bytes, commitment, and displayed fingerprint; unknown fields and duplicate IDs fail closed. |
| B3 | Full-device-loss identity continuity is not decided | A/B | Recovery changes every trust relationship. Engineers cannot safely decide whether the replacement is continuity of the same user grouping or a new identity without defining contact verification and old-device invalidation. | Recommended: generate a fresh device identity and new membership epoch; mark all prior devices `recovery-replaced`/revoked; require contacts to review and re-verify. Do not preserve prior verification silently. | Security architect + identity/verification owner | Recovery state transition, contact event, old-device invalidation, and “all recovery material lost” behavior are specified with deterministic tests and no server reset path. |
| B4 | Epoch enforcement at existing adapters is not contractually bounded | A/B | Without a precise gate, one subsystem could accept stale membership while another rejects it, allowing revoked devices to send messages, retrieve attachments, or signal calls. | Define the adapter contract: current epoch is required for new admission/control authorization; stale state must reconcile or fail closed; existing ciphertext/session formats are not rewritten. | Phase 3–5 owners + security architect | Message/mailbox, attachment, call, and verification adapters each expose a documented stale/revoked outcome and integration test; no frozen protocol field changes. |

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

The smallest safe remaining design work is **four short normative addenda**, not another architecture document:

1. **Proof contract:** record the answer to B1 against the actual existing identity/session API and explicitly prohibit every unauthenticated/list-relay path.
2. **Canonical vectors:** record B2's serialization, hash input, QR fields, and cross-platform test vectors.
3. **Recovery state table:** record B3's fresh-identity replacement, contact trust reset, and all-material-lost outcome.
4. **Epoch adapter matrix:** record B4's accepted/reconcile/rejected result for each existing message, mailbox, attachment, call, and verification operation.

Once these four addenda are reviewed and acceptance criteria are testable, engineers may begin **Phase 6B.1 local model and canonical validation**. Durable deployment persistence, notification operations, and browser-specific presentation remain later gates and must not be faked during 6B.1.

## 5. Final implementation checklist

- [ ] Device authority finalized (B1 proof contract)
- [ ] Enrollment protocol finalized (including proof, nonce, expiry, and pending/active transitions)
- [ ] Revocation finalized (epoch advance, stale behavior, notification semantics)
- [ ] Recovery finalized (fresh identity, trust reset, prior-device invalidation)
- [ ] Encoding finalized (canonical bytes, commitment, fingerprint/QR vectors)
- [ ] Epoch behavior finalized (adapter matrix and rollback/conflict outcomes)
- [ ] Integration boundary finalized (existing identity/session APIs only; no new primitive)

## 6. Final verdict

**NOT READY.**

The next action is not to write Phase 6B code. The security and protocol owners must approve B1–B4, publish the four normative addenda listed above, and attach cross-platform vectors plus adapter acceptance tests. After that review passes, start only Phase 6B.1; do not begin enrollment/recovery integration or change any Phase 1–5 protocol until the later gates are separately satisfied.
