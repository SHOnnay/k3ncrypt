# Delivery foundation blocker resolution

Branch: connectivity/delivery-foundation-blockers
Base: connectivity/delivery-foundation-closure at 8c4afe88089859d319e1e67026631da0c9ef01af
Comparison snapshot: local origin/main at 3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f

Scope: review and protocol decisions only. This branch adds the specification map and this report. It does not change production code, test guards, crypto, transport, ACK payloads, retry policy, trust, or UI. It does not merge main or import delivery-coordinator, Android readiness/trust-state, SAS, or LAN implementation work.

## 1. Current state

- PASS — branch isolation: worktree started at the closure commit; tracked files were clean before these two documents were added.
- PASS — production path: closure source uses the existing relay path on Web and Android. A relay-path adapter exists; the separate DeliveryCoordinator implementation is on an unmerged sibling ref. No LAN, direct or multipath path was added or activated here.
- BLOCKED — main distinction: inspected origin/main is 3e26ce9; it has no tracked docs/connectivity files and does not contain closure sender-history changes, shared M1 implementation, tests or conservative relay-status copy. This report is based on closure, not a claim those changes are deployed on main. The remote was not fetched during this review, so comparison is to the local tracking snapshot.
- PASS — implementation boundary: no application source or test files changed in this task.

## 2. Android evidence

- PASS — SDK installed: Android SDK packages exist at /opt/homebrew/share/android-commandlinetools: platform 35, build-tools 34.0.0, platform-tools 37.0.1, emulator 37.1.11, NDK 27.2.12479018 and Android 35 Google APIs arm64 system image.
- PASS — Gradle SDK configuration: ANDROID_HOME and ANDROID_SDK_ROOT were unset and android/local.properties is absent. Supplying both variables for the command made Gradle resolve the SDK; no project config was changed.
- PASS — disposable AVD: avdmanager lists k3ncrypt-instrumentation-disposable (Android 15/API 35, arm64). The emulator was launched only with that disposable AVD; the persistent beta AVD was not started or altered. Existing verify-disposable-avd.sh was left unchanged.
- PASS — Kotlin unit tests: with the SDK variables set, ./gradlew test completed successfully. Across Debug and Release variants: 52 XML reports, 121 test executions, 0 failures/errors, 0 skipped. This includes Android messaging/persistence tests and EnvelopeIdentityTest; the shared Kotlin fixture case “matches shared TypeScript fixture exactly” passed. Two existing test-source nullability warnings were emitted.
- BLOCKED — instrumentation tests: connectedDebugAndroidTest ran on the guarded disposable AVD and built/installed test APKs, but all five app instrumentation tests failed. Four could not open per-test SQLite databases because /data/user/0/com.k3ncrypt.app/databases did not exist. SessionRenewalPersistenceTest failed Android Keystore key generation with ProviderException. These are observed failures, not successful Android validation. The run also warned libk3ncrypt_android_crypto.so could not be stripped.
- BLOCKED — Android validation conclusion: unit coverage passed; requested messaging/persistence instrumentation evidence did not. Android is not validated for this gate.

## 3. Specification map

- PASS — inventory produced: specification-map.md catalogs relevant connectivity documents found across local branches and remote-tracking refs. It records each document's path, source ref, purpose/status, runtime dependency and conflicts.
- BLOCKED — one adopted normative source: no single reconciled normative specification exists in the closure branch or inspected origin/main. Approved HANDOFF, delivery-state, M1, receipt, capability, transport-selection and LAN decision materials live across unmerged branches.
- DECISION — chronological ADR versions: closure ADR 0002 records Web inbound option A and supersedes older “options/no choice” characterization drafts for this branch. The later M1 ADR revision is accepted as a design specification and closure implements local M1; neither fact closes dedupe horizon.
- OPEN — decisions retained: D-R remains unapproved for a future receipt frame. M6 offline freshness and LAN decisions D13/D14 remain open. ADR 0009 explicitly keeps production LAN NO-GO.
- OPEN — main user-facing copy: inspected origin/main still uses Web “Delivered” and Android “Message delivered” after relay-controlled signals. Closure contains conservative relay-attributed copy but is unmerged.

## 4. Dedupe analysis

OPEN — DEDUPE HORIZON = OPEN. The maximum legitimate time an identical encrypted envelope can reappear is not bounded by current protocol or code.

Evidence from closure source:

- Web retries exact saved ciphertext. Its active retry timer runs every 5 seconds and skips an item for 5 seconds after an attempt. Join/reconnect also triggers retry. There is no maximum envelope age; encrypted outbox survives reload until relay completion clears it or local vault data is removed.
- Android keeps the exact serialized envelope in its Room outbox and retries pending rows on connection/reconnection. Each send ACK wait is capped at 20 seconds; a send ACK clears the row, while timeout/error leaves it available for a later connection. There is no shared maximum age or expiration.
- Relay offline mailbox has a 7-day TTL and 64-message per-mailbox cap. Duplicate insertion suppression is keyed to the mailbox record and ends when that record expires or is deleted. The relay waits up to 5 seconds for a live receiver handler, and up to 10 seconds for a mailbox-replay ACK. A mailbox claim lease is 30 seconds. These are per-attempt controls, not a maximum envelope lifetime. Replay runs when relay delivery/replay handling is triggered; there is no fixed overall retry expiry.
- Web retains at most 1,024 replay markers by count, not elapsed time. Android's durable accepted-message identity records have no observed per-record age/count pruning policy. Restart preserves Web and Android outboxes.
- Current production has no overlapping paths. Future path copies have no specified expiry and could arrive after relay TTL and relay dedupe expiry.

OPEN — exact missing protocol fact: a globally enforced maximum age, measured from an agreed event, for an envelope to remain retryable or deliverable from any sender outbox, relay mailbox or future path copy, including behavior at expiry. The contract must define clock/expiry authority, old-client behavior and common Web/Android tombstone cleanup. Without that fact, no finite shared dedupe retention value can be derived.

DECISION — no retention number selected. Do not assign a convenient arbitrary Web/Android cleanup value in this phase. A common policy can be specified and tested only after maximum reappearance age and post-expiry behavior are chosen.

## 5. Receipt semantics

DECISION — “Relay/transport acknowledgements do not mean peer persistence.” The current relay-only beta does not require a sender-verifiable, peer-persisted receipt as a product guarantee. Current ACKs remain useful for relay queue/outbox management; no receipt protocol is added.

| Evidence boundary | What current signal proves | What it does not prove |
|---|---|---|
| Transport accepted/submitted | Local transport adapter completed the submission operation it exposes. Timeout can still leave outcome unknown. | Does not independently prove relay durability or recipient handling. |
| Relay accepted | Positive chat-message ACK is relay's assertion that it accepted the send. With stored:true, relay reports mailbox storage of the opaque envelope; the row has a 7-day TTL. Common client abstraction does not preserve this distinction consistently. | Does not prove peer received, decrypted or persisted the envelope; a malicious relay can lie about relay-controlled state. |
| Recipient received/handler accepted | Receiver normally emits received only after authenticated app handler returns accepted; mailbox replay deletes after receiver ACK. Sender hears only through relay. | Not a cryptographically authenticated peer statement; not independently verifiable against malicious relay. |
| Recipient persisted | Web closure path atomically commits message/history/session/replay before positive receive acceptance; Android commits Room state before acceptance. | No sender-verifiable cryptographic receipt proves this boundary today. |
| Recipient displayed/read | No read/display receipt is sent. | No current ACK claims human display or reading. |

- PASS — receipt boundary documented: current ACKs are not classified as peer-persisted or displayed/read.
- OPEN — production-main wording: origin/main still displays “Delivered” / “Message delivered”; this may imply recipient delivery beyond relay evidence. Closure's “Relay acknowledged/accepted” copy is more accurate but not merged into the inspected main snapshot.
- OPEN — future receipts: if multipath later requires peer-persistence semantics, stop at protocol design and obtain independent security review of conversation, envelope, sender/receiver identity, freshness, replay and durable-acceptance binding. ADR 0007 is requirements/specification only; no construction or frame is invented here.

## 6. Remaining risks

- BLOCKED — Android instrumentation: four SQLite directory failures and one Android Keystore failure prevent passing Android integration evidence.
- OPEN — retention mismatch: Web's count-capped 1,024 IDs and Android's unbounded rows are not a shared elapsed-time policy.
- BLOCKED — specification adoption: normative documents and later ADRs are spread across refs not present in main or this closure branch.
- OPEN — capability authentication: current relay-forwarded protocolFeatures are not bound into the device authorization proof. ADR 0008 specifies a future model; authenticated negotiation is not implemented.
- OPEN — introduction parity: closure review records Web join-introduction support but no Android parity/fixture. Do not infer it from M1 fixture parity.
- OPEN — receipt/UI mismatch on main: delivery wording on main is stronger than its signal; closure wording is unmerged.
- OPEN — offline LAN prerequisites: M6, D13 and D14 remain open under ADR 0009.

## 7. LAN readiness decision

| Gate | Result |
|---|---|
| A. Android validated? | BLOCKED — 121 unit executions passed; five disposable-AVD app instrumentation tests failed. |
| B. Cross-platform envelope identity validated? | PASS, bounded to Web ↔ Android M1 — closure's TypeScript shared-fixture test passed in recorded validation; this task's Kotlin shared-fixture test passed. No Rust M1 implementation/fixture consumer exists, so no three-language claim is made. |
| C. Normative specifications reconciled? | BLOCKED — map and conflicts are recorded, but docs remain spread across unmerged refs with open owner decisions. |
| D. Dedupe horizon defined? | OPEN — DEDUPE HORIZON = OPEN; no global maximum retry/path-copy age exists. |
| E. Receipt semantics explicitly bounded? | DECISION — relay/transport ACKs do not mean peer persistence; beta adds no peer-persistence promise or receipt frame. Main display copy remains a separate OPEN mismatch. |
| F. Sender-history recovery closed? | PASS, scoped — closure atomically records new Web sender history with session/outbox and updates history/outbox together on relay completion. It cannot reconstruct pre-existing historyless outbox rows, remove the 2,000-row product-history cap or prove power-loss durability. |
| G. Relay-only production behavior preserved? | PASS — task is documentation-only; closure Web/Android continue to use relay as their only production message path. |

BLOCKED — LAN FEASIBILITY = NOT READY. Android instrumentation fails; dedupe horizon is open; normative source adoption is incomplete; D13/D14/M6 remain open. No LAN, multipath or direct path may be enabled based on this review.

## 8. Exact next implementation step

DECISION — Next work should be isolated Android instrumentation-failure triage, not a transport feature. Preserve the guard and use only k3ncrypt-instrumentation-disposable. Inspect the test context/Room setup behind the missing databases directory and the emulator Keystore provider failure; determine whether each is test-fixture or application behavior before changing anything. Rerun all five tests and report individual outcomes. Do not alter production behavior or the test guard merely to make tests green.

After Android evidence, the next protocol decision must set maximum envelope reappearance age (sender outbox, relay TTL/replay, old clients, future copies) and expiry behavior before selecting a common Web/Android tombstone policy. Adopt exact normative revisions in a later branch. LAN remains prohibited until those gates and HANDOFF M6/D13/D14 conditions are closed.
