# Phase 6B.8 synchronization implementation roadmap

Status: design only. No stage below is implemented or enabled by this milestone.
Use [architecture](PHASE6B8_MULTI_DEVICE_SYNC_ARCHITECTURE.md) as the design
contract and [threat model](PHASE6B8_SYNC_THREAT_MODEL.md) as the attack checklist.
Baseline reviewed: `09f121b61f189701a15a88c3140364580b9bf48a`.

## 1. Scope and sequencing

Deliver independently keyed replicas of one user through isolated adapters.
Sequence: establish trustworthy scope/freshness -> durable sync contracts ->
explicit bootstrap -> incremental synchronization -> adversarial rollout gate.
Recovery, groups, mobile apps, live call handoff, legacy migration, and new
cryptographic primitives remain separate work. A Windows PC uses the same
browser adapter in this scope; native platform implementation is not assumed.

## 2. Entry gates with concrete acceptance criteria

| Gate | Owner/responsibility | Required evidence |
| --- | --- | --- |
| Common user scope and stable device binding | Identity/runtime maintainers | Three independently generated identities share one pinned lifecycle scope; routing changes and conversation changes do not change device identity; a payload cannot choose another user's scope. |
| Real target bootstrap | Lifecycle/runtime maintainers | Verified pairwise session, staged approval, target confirmation and durable activation run on two independent stores; no imported snapshot can activate a device. |
| Authenticated control framing and origin | Transport/runtime maintainers | Real send/encrypt/relay/decrypt/decode round trip, wrong-peer rejection and bounded cross-purpose parsing; forwarded authorization digest never substitutes for session-origin proof. |
| Freshness quarantine and all operation paths | Security/runtime maintainers | Future/fork events persist quarantine; restart does not clear it; outbox retries, incoming signaling, cached call handles and attachment admission cannot retain stale authority. |
| Shared durable consistency | Persistence maintainers | Actual multi-process transactional CAS and replay uniqueness, crash recovery, admission/mutation serialization, durable high-water and event outbox; no process-local mutex presented as distributed evidence. |
| Strict partition contract | Protocol/security review | Model and failure tests cover partition, split view, missing ACK, timeout and simultaneous revocation; stale operation cannot complete after a conflicting committed boundary. Availability restrictions documented. |
| Remote contact compatibility | Messaging adapter/security review | B uses its own session and identity; contact explicitly binds B to the logical conversation; unsupported contact disables direct send; no key/session cloning or hidden impersonating forwarder. |

Schema/test-vector work can begin before deployment adapters exist. No end-user
sync enablement may precede these gates. Any gate needing frozen protocol changes
stops for a separate design review; there is no legacy or raw transport fallback.

## 3. Milestone S1 — Contracts and persistence

Objective: define typed allow-listed records, manifest, causal journal, admission
port and failure states around the existing primitives.

Required components: isolated sync package codec; same-user binding port;
trust-admission/reconciliation port; snapshot exporter/importer interfaces;
durable recipient outbox and atomic inbox/apply/ACK adapter. Suggested location:
`service/src/sync/` for domain/adapters and tests, with composition in existing
runtime boundaries. These paths are proposals only.

Security requirements: strict version/purpose parser, explicit identity/epoch
binding, no raw vault exports, separate destination encryption, bounded storage,
no generic setter for lifecycle/verification. Follow the architecture's numerical
limits and retain replay/deletion evidence through compaction.

Tests: independently published canonical byte/digest vectors; malformed/duplicate
fields, wrong scope/target, oversized input, sequence conflicts, expired admission,
partial commit, crash before/after encryption persistence, and restart replay.

Completion: contracts and vectors reviewed; real adapter passes cross-process
atomicity/fault tests; uncertain commit returns blocked rather than success;
source freeze confirmed by diff. No UI or network feature is enabled.

## 4. Milestone S2 — Approved-device snapshot bootstrap

Objective: laptop transfers explicitly selected state to an approved phone.
Dependencies: S1 and all scope, target, control and freshness gates.

Required components: existing ceremony integration, direct per-peer identity
binding, local transfer selection, snapshot frontier, encrypted manifest/chunks,
staging, atomic publication and authenticated ACK. Generate independent keys and
vaults; never transfer session or unlock state.

Security requirements: no content before activation; explicit history selection;
history provenance; imported contact evidence cannot mark a changed fingerprint
verified; independent attachment authorization. Failed or expired transfer remains
invisible and produces a bounded user-facing unavailable state.

Tests: three devices with independent stores and sessions; unauthorized new
device; snapshot tampering/missing chunks; interrupted/restarted transfer;
revocation mid-transfer; source identity change; server inspection with canary
plaintext; new device never receives source private material.

Completion: phone shows the same selected logical conversations/contacts without
creating another user scope; history imports exactly once; no hidden trust
upgrade; transfer resumes or safely restarts at every simulated crash boundary.

## 5. Milestone S3 — Incremental state and offline reconciliation

Objective: converge new messages, read state, contacts and eligible preferences
through authenticated per-device journals.
Dependencies: S2, durable admission serialization and contact compatibility gate.

Required components: per-destination fan-out, source sequences/digest chains,
causal dependencies, bounded delta import, tombstones, explicit conflict views,
reconciliation-first reconnect and lifecycle fencing. No server plaintext index.

Security requirements: do not use last-writer-wins for trust, identities or
conflicting edits; no delivery under unresolved epoch; old-epoch packets cannot
be relabeled. Security conflicts block; ordinary conflicting values require a
user choice. Incomplete contact support leaves direct sending unavailable.

Tests: phone offline/laptop edits, simultaneous edits, reordered/dropped deltas,
duplicate ACK, same sequence/different digest, deletion resurrection, forked lists,
revocation while queued, stale service process, and invalidated session handles.
Assert every actual operation boundary, not just a fake enforcer result.

Completion: devices converge for supported non-conflicting data; conflicts remain
explicit; no stale authenticated operation bypass; offline availability matches
the documented strict policy; historical messages/protocol modes remain unchanged.

## 6. Milestone S4 — Deployment evidence and controlled enablement

Objective: prove invariants under independent processes and hostile delivery.
Dependencies: S1–S3 complete; security review of adapter implementation.

Required components: isolated browser/service fixtures, durable storage backend,
fault-injection transport, payload-free observability, quotas/expiry jobs and
opt-in feature control. No production credentials in tests.

Validation requirements:

- Unit/parser vectors and lifecycle/security regression suite.
- Integration tests using actual vault and authenticated session boundaries.
- Multi-process races, stale replicas, checkpoint loss, full restart, dropped
  notifications, forked delivery, expiry and partition recovery.
- Chromium, Firefox and WebKit bootstrap/reconnect/privacy checks; unsupported
  combinations documented and blocked from enabled sync.
- TypeScript, lint, production build, dependency audit and unchanged-core diff.
- Storage/log inspection proving ciphertext-only server content, independent
  device keys, no exposed credentials, and bounded retained metadata.

Completion: every threat-model invariant has reproducible evidence; limitations
and pre-revocation ciphertext exposure are documented; all entry gates closed.
Do not label production-ready based solely on green unit tests.

Rollback: disable new sync admissions and leave existing local records/protocol
modes intact. Preserve high-water/replay/tombstone data and pending-operation
evidence. Do not lower epochs, reactivate devices, copy keys, or fall back to
plaintext/raw transport. A downgrade cannot open a snapshot whose version it
does not understand.

## 7. Design milestone validation and readiness

For this documentation-only milestone, verify all three files exist, relative
references resolve, `git diff --check` passes, and only these documents are staged.
No implementation tests are added or claimed; no runtime/security guarantee is
changed by this commit.

Architecture decisions are concrete enough for S1 adapter design work. **Runtime
synchronization remains NOT READY for rollout.** The exact next implementation
step is to close common-scope/session-origin/control-framing and persistent
freshness gates, then establish the real atomic admission/persistence boundary.
History transfer must not be used to conceal missing enrollment or trust plumbing.
