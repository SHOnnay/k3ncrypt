# Connectivity specification reconciliation — C1

Exact base: 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1.
Review branch: connectivity/peer-admission-freshness-review, 2026-10-05.
These immutable sources were inspected locally; historical refs were neither
merged nor cherry-picked. Status is relative to this base, not deployment/main.
Rows explicitly preserve conflicting statements instead of silently adopting
the newest document. See the self-contained requirements/review package.

## Reconciliation table

| Topic | Document / ref / commit / blob | Statement | Status | Current? | Conflict | Governing rule for this review |
|---|---|---|---|---|---|---|
| Handoff/main | docs/connectivity/HANDOFF.md @ 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; commit 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; blob 18064d08ca06ca590d53f96225c6745baa2bb124 | 2026-10-03 main-specific branch status and historical instrumentation failures | BRANCH-ONLY / VALIDATED | Historical, not this base's status | Says M1/coordinator absent and instrumentation failed; newer base contains M1/coordinator and later successful tests | Preserve historical evidence; exact sender-origin source governs this review |
| Sender/local origin | docs/connectivity/dedupe-expiry-policy.md @ 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; commit 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; blob 1216c7d392832d7e563fd5c655fc4fe273692532 | M1 dual read/write; atomic sender origin marker; no trusted timestamp/T | IMPLEMENTED / OPEN | Yes | Finite expiry/retention still unresolved | Marker is local semantic commit event only, never freshness |
| Current relay foundation | docs/connectivity/lan-transport-foundation.md @ 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; commit 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1; blob ec87434d73966ddb8e29b6bb490ec1b5e708a98f | Relay-only seams/checklist; no optional adapter; gating docs branch-only | IMPLEMENTED / OPEN | Source yes; older no-live-M1 paragraphs stale | Subsequent base adopted live M1 and atomic sender | Exact code and named validation supersede only obsolete branch facts |
| Connectivity contract | docs/connectivity/connectivity-v1.md @ connectivity/spec; commit 3636ef3e972ce199cb0e3eced1edbb3cfa17594e; blob ce19dc86e1b33496d2a84689243c187f0ed02e04 | Owner owns crypto/state; adapters carry saved ciphertext; future paths opt-in | PLANNED | Requirements yes, no runtime authorization | Immediate fallback phrasing vs later ambiguous-send gates | No cross-path runtime/fallback until all delivery gates closed |
| Phase 0 behavior | docs/connectivity/current-behavior.md @ connectivity/spec; commit 3636ef3e972ce199cb0e3eced1edbb3cfa17594e; blob b55c9c23161bd51cccca30ccde7069e1ad43c6f2 | Main 3e26ce9 source trace, separate Web sender/session/seen writes | VALIDATED | Historical baseline only | Atomic/M1 base is newer | Do not reuse old line numbers as current implementation |
| M1 design | docs/connectivity/adr/0001-envelope-identity.md @ connectivity/envelope-identity; commit 0b9b83eda772ced3b96ed05b802da45dc38dc57e; blob 663f68cac3d2aca6f7c07cc91db097fe7c0dcdf8 | Conversation/exact ciphertext SHA256 with U32BE/UTF8 | DECISION / IMPLEMENTED | Live local implementation in this base | Design approval not finite retention or sender authentication | M1 supports dedupe; not admission identity/freshness |
| Foundation report | docs/connectivity/delivery-foundation-report.md @ connectivity/delivery-foundation; commit 77caacbf0d810f877f3b366a999e84aedc456588; blob 2471ae7b9026d109098dd48ff304d75929c609c4 | M1 and atomic acceptance branch source and bounded evidence | BRANCH-ONLY / VALIDATED | Historical | Not all earlier source adoption is in this newer parallel foundation base | Compare exact current base instead of merging report claims |
| Foundation review | docs/connectivity/delivery-foundation-review.md @ connectivity/delivery-foundation-review; commit 35afc151357ba08edddcb99b0a44abf1eee10ab2; blob adfc5b919e68b0af2b99a913f85e527933fd0797 | Sender-history and horizon open, Android SDK blocked | VALIDATED / OPEN | Historical, horizon still open | Sender/history and Android evidence later changed | Old failures do not erase newer scoped evidence or imply physical crash proof |
| Closure | docs/connectivity/delivery-foundation-closure.md @ connectivity/delivery-foundation-closure; commit 8c4afe88089859d319e1e67026631da0c9ef01af; blob f6cb5158bdd029cbfce087005e1485a85ac65d4c | Atomic sender history/session/outbox on that branch | BRANCH-ONLY / VALIDATED | Provenance; current parallel implementation separately checked | Historical closure is not automatic adoption | Current encryptAndCommitOutbound source establishes exact boundary |
| Blocker report | docs/connectivity/foundation-blocker-resolution.md @ connectivity/delivery-foundation-blockers; commit 7a823b6a0a971d4c90e9f91ad7c001e87b9b2bb2; blob 02cba2d3d50d68c05ac6eed2752abd992fa93512 | 121 Android units passed, five instrumentation failed; M6/D13/D14 open | VALIDATED / OPEN | Historical execution; open decisions current | Later sender/M1 instrumentation succeeds on its own base | Record scope and do not rerun unrelated instrumentation here |
| Prior map | docs/connectivity/specification-map.md @ connectivity/delivery-foundation-blockers; commit 7a823b6a0a971d4c90e9f91ad7c001e87b9b2bb2; blob ca3c25ff3c4324b5504a8b1b73debce5c552bd86 | Distributed docs and conflicting approval/readiness wording | BRANCH-ONLY / OPEN | Provenance | No single approved optional-path specification | This reconciliation records conflicts without granting approval |
| Coordinator/receipt | docs/connectivity/adr/0007-authenticated-receipts.md @ connectivity/delivery-coordinator; commit f34b981f5b7465ea2355776c8c051327aae123bb; blob 30e05a53e6b1dfd20b1c11c99e368de958da0252 | Transport ACK not peer persistence; future receipts remain unapproved | OPEN / PLANNED | Yes requirement | Early ADR 0003 default is proposal only | No receipt or outbox completion redesign in C1 |
| Control gating | docs/connectivity/adr/0004-transport-control-gating.md @ connectivity/spec; commit 3636ef3e972ce199cb0e3eced1edbb3cfa17594e; blob cf812de7da3f20273fd165e699089ef58e3c6d88 | Proposes transport-control-v1 via existing relay hint | PLANNED | Cannot authorize control | ADR 0008 exposes unauthenticated list and old-server unknown-ID rejection | Fresh authenticated offers/selection required; no new advertised ID |
| Later controls | docs/connectivity/transport-control-v1.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 29e9d0cb478ec68e679ba3cb58091f0f64987faf | Control use requires transcript authentication and compatible rollout | PLANNED / OPEN | Yes requirement, unapproved frames | No current frame discriminator/wire exchange | A1 must close old-parser and rollover safety |
| Capabilities | docs/connectivity/adr/0008-capability-negotiation.md @ connectivity/transport-policy; commit a80672fb739936620c18f149ea63475e499a0dcc; blob 8c0080fe6e95d969d6169ec632bbfcf41ea31f9e | Complete offers/highest mutual selection and downgrade bound to fresh transcript | PLANNED / OPEN | Yes requirements | Authentication placement/limits/IDs remain undecided | C1 requirements feed A1; hint cannot authorize |
| Transport ranking | docs/connectivity/transport-selection-v1.md @ connectivity/transport-policy; commit a80672fb739936620c18f149ea63475e499a0dcc; blob 994ec86aca3184d7053d2334915c37a5a722d6cb | Eligibility before ranking; privacy before gathering; ambiguous sends gated | PLANNED / OPEN | Yes requirements | Pure policy/fake adapters are not authentication | Relay-only current coordinator; no runtime optional selection |
| Admission M5 | docs/connectivity/peer-admission-v1.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 99092a52bc233f4e15a5f6aca2531bd71d77d33b | Two identities/nonces/roles/versions plus both DTLS fingerprints; binary prefixes | PLANNED / OPEN | Yes minimum requirements | Exact order/flight/bounds/actual channel and signatures unapproved | Candidate vector bytes remain review-only; independent approval required |
| Eligibility | docs/connectivity/path-eligibility-v1.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 7125a6960b51625e32d53a5c306b2afb86fc3fcb | Verified unchanged, active/freshness, healthy session, opt-in/privacy | PLANNED | Minimum yes, insufficient on its own | Current pure checklist also requires capabilities/ID/dedupe/horizon/receipt/completion | Do not relax current broader optional-path checklist |
| M6 | docs/connectivity/adr/0005-offline-freshness.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 4cff6ca48605ec7790019ef8d6912cac14c4b6ac | F1/F2/F3 owner decision, no age selected; signatures not global freshness | OPEN | Yes principle; Android gate assumption stale | Current Web gate has no TTL and Android has no equivalent | Current trace plus unapproved owner form govern; absent evidence fail closed |
| D13/D14 | docs/connectivity/adr/0009-lan-transport-architecture.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 4497144b8c4239166569091edf6ed98fff5b0f2a | NSD hints + DataChannel candidate, production NO-GO | DECISION / OPEN | Candidate direction yes | Heading 'decision' does not close carrier/advertising/M6 | Raw TCP unsupported; D13/D14 separate |
| Carrier evidence | docs/connectivity/lan-transport-decision-v1.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob f13439a5d341e656b328dd7d1e4d3f1bd6a0878f | Browser constraints, host-only offline feasibility and real-device gates | PLANNED / OPEN | Yes scoped constraints | Existing voice WebRTC/spike not messaging evidence | No physical/offline feasibility claim |
| Carrier test plan | docs/connectivity/lan-decision-test-plan.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob 830472e4ae542a642df694a9e1bb2f20dba4def8 | Real WiFi/discovery/carrier/offline/privacy matrix | PLANNED | Plan only | No execution by C1; two-phone requirement differs from wider three-device matrix | Meet final approved plan; emulator never substitutes physical evidence |
| Threat model | docs/connectivity/threat-model.md @ connectivity/lan-decision; commit bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2; blob e8589490f819eb3a08863576ee8e58ead8c1987f | Spoofing, substitution, replay, revocation and privacy threats | PLANNED | Yes requirements | No active optional controls | Apply threat catalog without enabling paths |
| Trust-state adoption | docs/invitations/implementation-plan.md @ invitation-redesign/trust-state; commit ed02b497f116a7c6cdfaaa8460afd619adeab422; blob a0a94a93dbcbf9c6c05e0d5796cf3a300425b317 | Explicit Android verification independent of contact route | BRANCH-ONLY | Prerequisite, not in base | Current SavedConversationIndex.isTrusted still route/fingerprint based | Adoption and trust-writer review required before admission |
| Invitation UX | docs/invitations/ux-flow.md @ invitation-redesign/trust-state; commit ed02b497f116a7c6cdfaaa8460afd619adeab422; blob 2cc7c624f81017880bf6fd70a3c0db14783c4207 | Invitation/QR setup is not verification; user action independent | BRANCH-ONLY / PLANNED | Security principle yes | SAS planned, never implemented by C1 | No automatic verification or ceremony change |
| Readiness/native verifier | docs/invitations/verification-readiness.md @ verification/readiness; commit 11b45172c5ba59a1e7e5c831944bcfdbf2f8207b; blob d7a2bbb386c5b5d99117154843a2be0b7cdddce0 | Native verifier and introduction parity prerequisite source/tests | BRANCH-ONLY | Not in base, adoption prerequisite | Native test source/instrumentation pending is not live validation | Do not cherry-pick; separate adoption/current validation |

## Current implementation decisions and bounded evidence

- IMPLEMENTED: Web relay-only DeliveryCoordinator/RelayPathAdapter wiring,
  live pre-decrypt M1 plus legacy reads/atomic acceptance; Android M1/legacy
  checks and Room acceptance; Web sender account/session/exact outbox/history
  CAS and Android sender Room/local origin marker.
- VALIDATED on sender-origin base as recorded by its task: root 106 suites /
  527 tests, service 74 / 413, Android 68 debug + 65 release units, focused
  Room sender instrumentation 1 and full guarded instrumentation 5. No claim
  that readiness's verifier instrumentation or physical LAN ran.
- OPEN: M1 horizon/legacy retention, message-age T/time/restore, authenticated
  capability wire negotiation, peer lifecycle mapping, M6, D13/D14, receipt
  requirements and optional outbox completion. Passing M1 does not close them.
- BRANCH-ONLY: Android explicit verification state, native verifier and
  join-introduction parity at verification/readiness. Their source is absent
  and ancestry does not include that ref. A route/fingerprint cannot replace it.
- DECISION: required missing/ambiguous optional admission evidence blocks
  optional paths; otherwise valid relay continues under existing authorization.
- PLANNED: same-LAN/direct, file sharing, video, notifications, optional
  self-hosted nodes and transparency. VPN/TUN is a separate architecture.

## Conflicts that remain explicit

1. Historical main versus current base: HANDOFF and foundation documents have
   different ancestry and dates. Their old absence/failure claims are preserved
   as historical provenance, not current state.
2. ADR 0004 relay hint gating versus ADR 0008 authenticated negotiation: hints
   cannot authorize admission or controls; exact authenticated rollout is OPEN.
3. "LAN architecture decided" versus D13/D14/M6 NO-GO: candidate module direction
   is not carrier/advertising/freshness approval.
4. Android verified-looking labels versus explicit verification: base's route/
   fingerprint-presence gate is unsuitable; readiness adoption is not inferred.
5. "Trust freshness" name versus time/current authority: local epoch equality
   and authenticated peer bytes do not prove newest global revocation state.
6. Both DTLS fingerprints versus exact channel: certificate reuse and SCTP
   multiplexing mean the pair alone is not sufficient instance/stream binding.
7. Bare u32 version lists in review vectors versus complete A1: fixture projection
   is not full capability/dependency negotiation or an approved wire schema.
8. Receipt requirement versus relay-only beta: future optional checklist still
   blocks without approved receipt/completion requirements; no D-R decision here.
9. Old successful tests/old failed instrumentation versus protocol approval:
   source and bounded runs are not adoption, release or physical crash/LAN proof.

No contradiction is closed by a merge or normative promotion on this branch.
