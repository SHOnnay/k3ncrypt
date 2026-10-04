# Envelope expiry and cross-path deduplication policy

**Status:** Owner-recommended policy draft. **T** is intentionally symbolic. This document does not ratify a numeric lifetime, define a wire encoding, or authorize runtime transport changes.

**Branch/base:** connectivity/dedupe-expiry-policy from 7f12dd655e7008bb592136fbae0656d4f2ba717 (connectivity/android-instrumentation-triage), based on ca814d2fcad370dc03504abc67f5567f6a081d18.

**Production boundary:** Relay remains the only production/default messaging path. This policy adds no LAN discovery, socket, DataChannel, PeerAdmission, multipath, fallback, receipt, or verification behavior.

## 1. Authority and recommendation

The checked-in connectivity foundation says the shared dedupe horizon is open. There is no single repository-wide ratified expiry protocol on this base. Related ADRs and reports live on sibling branches and have different status. This document reconciles them as evidence and recommends a direction; it does not silently adopt a sibling branch as authority.

Recommended transition:

1. Treat every existing envelope and every peer without authenticated support for the new contract as **legacy**. Preserve current relay behavior and do not apply T to legacy envelopes.
2. Define a new, reviewed, versioned envelope contract for optional-path-capable sends. A finite T applies only to that contract; its numeric value remains an owner decision.
3. Start T at the durable sender-side transaction that commits the post-encryption ratchet/account state, exact ciphertext, retry record, and age/version metadata together. No submission, relay, receiver, or server timestamp restarts the age.
4. Make the receiver's stable M1 envelope identity the primary durable dedupe key. Continue checking and writing the existing platform legacy digest during migration. Do not prune a marker while a copy can still be accepted.
5. Require a mutually authenticated, downgrade-resistant capability negotiation before sending the new contract or using an optional path. Current relay protocolFeatures is not that negotiation.
6. Keep the relay mailbox's existing TTL as independent mailbox storage policy. It is not T, a sender retry limit, or proof that all copies have expired.

The policy can be implemented only after the owner selects T and an independent security review approves the time-confidence and expiry-authentication model. If a platform cannot establish whether a new-contract envelope is fresh, it fails closed for that envelope: do not send or accept it, do not reset its age, and do not silently re-encrypt it.

## 2. Revalidated implementation

| Area | Behavior on this branch |
|---|---|
| Web outbound | `ModernConversation.sendUnlocked()` validates trust, prepares first-send pre-key material without committing it, and calls `VodozemacRuntime.encryptAndCommitOutbound()`. One secure-storage CAS persists the post-ratchet session, and for a first outbound session also the post-pre-key account, exact envelope/outbox, product history, session mode/audit, and renewal correlation when applicable. New pending records carry local `senderOrigin` v1 metadata. Relay submission starts only after the CAS resolves as committed; retry retains the exact envelope and marker. Existing records without the marker remain readable and relay-only. The five-second retry throttle remains; no maximum age or expiry enforcement exists. |
| Web sender history and deletion | New modern sends include their pending product-history row in the sender CAS (client/src/context/ChatContext.tsx; client/src/product/messageStore.ts). Subsequent delivery-state projection still merges into that durable row. Legacy retry still uses `chat.encrypt()`. Modern conversation deletion soft-deletes the server link and removes selected local outbox, seen, session, mode, and contact records, while the separate product message record remains. No account-wide deletion/backup anti-rollback contract was found in the audited paths. |
| Web inbound dedupe | Live `ModernConversation.receive()` computes M1 and the compatibility digest before decrypt. Acceptance atomically commits session state, product message, M1, and legacy replay records through secure-storage CAS. Duplicate copies are returned before a second decrypt. |
| Android outbound | `sendTextInternal()` encrypts once, serializes the exact envelope, snapshots account/session, and calls `commitOutbound()` before relay submission. Room commits account, session, exact envelope/outbox, outbound history, and local `senderOrigin` v1 metadata together. ACK removal remains a separate outbox transaction; reconnect retry reads and submits the stored envelope string. `createdAt` remains product history only, not age origin. |
| Android inbound dedupe | `InboundMessageProcessor.receive()` checks M1 and the legacy digest before decrypt. `commitInbound()` rechecks and commits account/session/message/M1/legacy digest/delivery records together in Room. Existing append-only replay records remain; the legacy digest key is not conversation-scoped. |
| Android deletion | The audited Android messaging/storage path has no conversation/account deletion operation that removes its outbox, accepted digest, and message records together. Those encrypted Room records remain until an external app-data/database removal; no protocol tombstone/retention rule is present. |
| Relay mailbox | backend/socket.io/listeners.ts:16-20, 105-132 defines a 7-day mailbox TTL, 64-item per-mailbox cap, server dedupe key over channel/mailbox/sender/envelope, and expiry from relay receipt time. Claims use a 30-second lease; mailbox replay waits 10 seconds for the receiver callback and deletes only after acceptance (:135-154). Live delivery waits 5 seconds; on failure the relay stores the same envelope (:251-319). received deletes by relay ID (:358-369). The persistent database uses a unique dedupeKey and TTL index (backend/db/index.ts:117-159; backend/db/migrations.ts:9-12). Suppression is record-scoped: after an ACK deletion or physical expiry deletion, the same envelope can be inserted with a new relay ID and a new relay timestamp/TTL. Mongo TTL deletion is asynchronous; before an expired row is physically removed, a duplicate lookup can still find that row even though mailbox claiming excludes expired rows. Live sends are not globally deduped by envelope identity. |
| Relay ACK and capabilities | A live positive response or stored:true is relay-controlled evidence, not a sender-verifiable peer persistence receipt. The relay does not parse or enforce envelope expiry. parseProtocolFeatures() currently recognizes only join-introduction-v1; missing metadata maps to no feature (backend/socket.io/listeners.ts:23, 64-70). Device authorization authenticates the joining device, but does not bind that feature list into an authenticated negotiation. |
| M1 | The current base includes TypeScript/Kotlin M1 helpers and shared vectors through ca814d2, but live Web and Android receive code does not call them. M1 is a conversation-scoped hash of the exact validated inner Olm ciphertext; JSON wrapper order/spacing and transport path do not enter its input. It is correlation/dedupe metadata, not sender authentication or a receipt (service/src/delivery/envelopeIdentity.ts:27-57; android/messaging/src/main/kotlin/com/k3ncrypt/messaging/EnvelopeIdentity.kt; protocol-fixtures/v1/envelope-identity.json). |

The maximum legitimate reappearance time on this branch is therefore unbounded by contract: Web/Android outboxes can survive restart and retry without an overall age, while relay mailbox records have their own independent seven-day storage TTL. A relay ACK timeout, five/ten/twenty-second per-attempt wait, or server timestamp does not bound that lifetime.

## 3. Proposed expiry contract

### 3.1 Versioning and age origin

Let t0 be the instant the sender's durable transaction commits all of the following as one indivisible state transition:

- the ratchet/account state after encrypting the message;
- the exact encrypted application envelope;
- the retry/outbox record for that exact envelope;
- the new-contract version and the age/expiry metadata needed by that contract.

The transaction must complete before any transport submission. The age is now minus t0; the deadline is conceptually t0 plus T. Reconnect, relay acceptance, mailbox storage, receiver delivery, retry, or restore never moves t0 or extends the deadline. Store history timestamps are not substitutes for t0.

`connectivity/sender-age-origin` adds an encrypted-at-rest local `senderOrigin` marker `{version: 1, basis: "durable-commit"}` to newly committed Web and Android pending sends. It is written in the same sender transaction as the exact envelope and ratchet/account state. The marker identifies the transaction boundary semantically; it contains no clock reading, elapsed age, deadline, or wire field and cannot establish freshness. Existing pending records without it keep legacy relay-only behavior. The Web product-history timestamp and Android `createdAt` are not substituted for t0. The clock representation and time-confidence/restore model remain owner/security decisions.

This branch closes Web's sender ratchet/outbox/history boundary and adds the same local marker to Android's existing Room sender transaction. Neither platform stores a clock-derived origin or implements the complete expiry candidate contract.

### 3.2 Authenticated expiry metadata

The existing envelope has no sender age or expiry field. A receiver cannot safely reject a previously unseen stale envelope from a relay timestamp, a local receive time, or M1 alone. The future contract needs a versioned authenticated metadata tuple that binds at least:

- the delivery-contract version;
- the canonical conversation identifier;
- the sender identity/device expected by that conversation;
- the M1 identity of the exact validated inner ciphertext;
- the sender's committed age origin and derived expiry boundary.

The tuple must be unambiguously encoded and authenticated by a reviewed mechanism bound to the already established peer identity/session. If it must be checked before decrypt, that authentication must also be verifiable before decrypt; merely adding unsigned outer JSON is insufficient. The M1 hash itself is not authentication. The sender's authenticated timestamp remains a sender assertion, not cryptographic proof of UTC or proof that the sender's clock was correct. No trusted remote timestamp is invented here.

Consequently, a new envelope/wire contract is required before a receiver can enforce expiry on a first-seen envelope. Field names, exact serialization, authentication construction, and version number remain unassigned pending protocol and security review. Existing clients must continue to receive the existing envelope shape.

### 3.3 Clock rules and ambiguous time

The application must not use Date.now() alone as a freshness authority.

- Within one OS boot, measure local elapsed age with the platform monotonic clock. Wall-clock rollback does not reset elapsed age. A forward wall-clock jump does not by itself prove expiry.
- Persist the immutable t0/deadline metadata and a clock-continuity/high-water record atomically with the outbox. Do not replace the saved origin on restart or retry.
- A monotonic clock generally resets on reboot, and ordinary Web/Android app APIs do not establish a common tamper-proof UTC clock across devices. If the implementation cannot prove elapsed time across reboot, shutdown, clock change, or restore, classify the envelope as expiry-unknown: do not transmit it or accept it as a new message until a reviewed trustworthy time source resolves the uncertainty. Do not turn uncertainty into a fresh lifetime.
- A receiver may classify a signed deadline as fresh or expired only against an independently reviewed local time-confidence model. If its confidence interval straddles the deadline, it is expiry-unknown; do not decrypt, display, or terminally acknowledge it. This avoids inventing a remote clock guarantee from the signed field.
- Time spent offline before the first network submission counts from t0. No “first sent” clock starts.
- A sender that is offline past T must not retry an expired envelope. A copy already in flight, relay-stored, or delayed on any later path keeps the original deadline and is stale after that deadline; delivery/transport timestamps do not refresh it.
- After a restart, preserve the exact outbox state and origin. If time is definitely past the deadline, expire it. If continuity/time is ambiguous, hold it without retry and expose an unresolved state; do not silently drop it or re-encrypt it.
- Backup/restore must preserve the origin, version, M1 state, and monotonic/high-water state. If a restore can roll back either the expiry state or dedupe tombstones and no reviewed anti-rollback check can detect it, disable optional paths and fail closed for new-contract delivery. Restored pending ciphertext must never receive a new t0.

These rules are safety-complete but not yet platform-implementable without an approved time-confidence source/restore model. That is an explicit owner/security-review blocker, not permission to substitute server time.

### 3.4 Sender, receiver, and relay at expiry

| Layer | Required behavior for a new-contract envelope |
|---|---|
| Sender | Before T, retry only the exact saved ciphertext. At a definitely established expiry, atomically stop all path retries and remove the ciphertext from the active retry queue; retain plaintext message history and an expired/undelivered status. If expiry is uncertain, hold and do not transmit. A user retry is a new logical send with a new client ID, new ratchet operation, new ciphertext, and new origin; never re-encrypt the old pending ratchet message silently. |
| Receiver | Check durable M1/legacy duplicate state before any second decrypt. For a first-seen new-contract envelope, validate the authenticated metadata and time confidence. A definitely stale envelope is not decrypted or displayed; durably record its M1 rejection tombstone before reporting it terminally handled to the relay. expiry-unknown is held/rejected without a positive mailbox ACK so it is not silently discarded. A duplicate already durably accepted returns the existing duplicate/accepted result and does not display or decrypt again. A stale result is not a peer-persistence receipt. |
| Relay | Keep its independent mailbox TTL/capacity and existing relay identifiers/dedupe key. Its receipt time never changes t0 or T. It need not interpret the authenticated application metadata for end-to-end stale rejection if every new-contract receiver enforces it. It may still hold/replay an expired opaque copy until its independent TTL; the receiver terminally rejects it. A backend change is required only if policy additionally demands that the server stop storing, claiming, or replaying copies at T rather than relying on the receiver. Do not change server identifiers to M1. |

The relay's independent TTL can therefore exceed the remaining sender lifetime. This is safe for message acceptance only after new receivers can verify expiry and persist terminal rejection. It is not a global lifetime bound and does not establish peer persistence.

## 4. M1 migration and retention

### Lookup, writes, and legacy compatibility

For a strictly validated modern envelope, calculate the M1 ID from canonical conversation ID plus exact inner ciphertext before decrypt. M1 is the primary stable key for all paths. Also calculate the current platform's legacy digest exactly as that platform does and check it as a compatibility alias. Do not alter relay mailbox IDs or its server dedupeKey.

On accepted new or legacy messages, atomically write the M1 record and the legacy digest with the ratchet/account state and accepted message. On Web, that requires the crash-consistent acceptance transaction described by the branch-only ADR 0002; the policy base lacked it, and `connectivity/m1-live-dedupe` adds it. On Android, add M1 to the existing Room transaction and retain the pre-decrypt check plus transaction recheck.

An incoming envelope that exactly matches an old legacy digest can be recognized before decrypt and may add its now-computable M1 alias without decrypting. A legacy digest alone cannot be converted to M1: old records contain hashes, not the original validated ciphertext. Do not rewrite, discard, or speculate about unpaired legacy records. Keep the exact existing digest compatibility lookup for rollback/old local binaries.

The legacy digest algorithms are not cross-platform identities: Web hashes JavaScript JSON.stringify(envelope) in a room-scoped list; Android hashes the raw serialized envelope string into an account-wide digest namespace. They can differ for wrapper formatting and Android's key is not conversation-scoped. M1 corrects those properties for new records while compatibility lookups preserve exact historic behavior.

### Retention and tombstone cleanup

- Until expiry is ratified and implemented, do not use finite M1 retention to authorize optional paths. A still-retryable message must never lose its dedupe marker. Storage pressure must fail closed rather than evict a live marker and acknowledge a possible duplicate.
- Legacy messages have no agreed expiry. Retain legacy compatibility state without time-based retirement unless the owner approves a separate legacy retirement/minimum-version rule. The current Web 1,024-entry limit remains a known limitation, not evidence of a safe horizon.
- For new-contract messages, retain accepted M1 markers through the authenticated expiry boundary. Cleanup is allowed only when trusted local time proves the deadline has passed; if time is ambiguous, retain the marker. Post-expiry copies remain rejectable before decrypt only because the expiry metadata is authenticated and independently checked.
- Persist a terminal-stale M1 tombstone before acknowledging a relay copy as handled. It may be retired at the same proven expiry boundary, because all later copies are stale by authenticated metadata. If that pre-decrypt authentication or time proof is unavailable, do not clean the marker and do not claim bounded retention.
- Restore must not roll tombstones back undetectably. Conversation deletion may clear local state only as part of deleting that conversation/session and disabling further use of its old identity; server mailbox rows are not purged by the current soft-delete link operation and expire independently.

For the M1 migration implementation, the interim treatment is append-only with no time/count pruning: **retention pending owner-approved horizon**. If the secure record cannot hold the additional marker state, acceptance fails closed instead of evicting markers. This is a temporary implementation treatment, not a permanent unbounded-retention product decision.

M1 still does not identify a logical user action across re-encryption, different ratchet ciphertext, or different devices. A deliberate user retry after expiry is a new envelope and a new M1 ID.

## 5. Compatibility and optional-path gate

| Sender / receiver | Envelope and path behavior |
|---|---|
| NEW ↔ NEW | Use the new expiry-capable envelope only after both sides prove the reviewed contract/version in an authenticated, fresh, downgrade-resistant negotiation. Optional paths may become eligible only after expiry, M1 retention, pre-decrypt duplicate handling, crash-consistent acceptance, current trust/admission, privacy, outbox completion, and every other existing eligibility gate passes. |
| NEW → OLD | Send the existing legacy envelope over relay only. Do not send unknown version/metadata/control fields. Do not assume the old receiver enforces T. |
| OLD → NEW | Accept through existing relay behavior as legacy. Do not assume expiry metadata or optional-path support; do not route it over an optional path. |
| OLD ↔ OLD | Unchanged existing relay behavior. |
| Any peer with missing, stripped, malformed, stale, or unauthenticated capability evidence | Treat as legacy and use relay-only behavior. A local feature flag or local implementation support is not peer support. |

The authenticated capability transcript must bind the two peer-device identities, canonical conversation, fresh negotiation context, offered and selected exact contract versions, and downgrade outcome to an authenticated conversation/admission context. Current protocolFeatures is relay-forwarded, unauthenticated metadata and is insufficient. The new envelope version itself must be bound to the negotiated version so an attacker cannot strip metadata and silently downgrade a new-contract send into an apparently valid legacy send.

This branch does not implement PeerAdmission, authenticated capability negotiation, receipts, SAS, or a new cryptographic mechanism. Existing eligibility also asks for authenticated receipts; ADR 0007 leaves their frame unapproved. This policy does not waive that gate.

## 6. Specification reconciliation

Branch refs below are provenance snapshots available in the local audit clone. They are not all merged into this branch or into one authority.

| Topic | Current implementation on 7f12dd6 | Branch-only evidence/status | Approved normative rule on this base | Recommended rule | Stale/conflicting statement | Owner decision / independent review |
|---|---|---|---|---|---|---|
| Envelope age/expiry | No sender/receiver envelope expiry; sender outboxes may retry across restart. Relay TTL is separate. | delivery-foundation-blockers@7a823b6 and handoff-v2@6b1be2c both record the horizon as open. | None. | New version only, finite symbolic T, from atomic sender commit. Legacy stays unchanged. | Any statement that seven days or a retry wait bounds all envelope copies is stale/incorrect. | Owner selects numeric T, what counts as max legitimate in-flight/replay, and legacy retirement; independent review approves time/clock model. |
| Age-origin atomicity | On 7f12dd6, Web session and outbox were separate; Android already grouped account/session/envelope/outbox but had no marker. | `connectivity/m1-live-dedupe` closes Web inbound acceptance. This branch closes Web sender account/session/outbox/history and adds local `senderOrigin` v1 metadata on both platforms. | No clock encoding or freshness authority is approved. | One transaction includes post-ratchet state, exact ciphertext, outbox, required local metadata, and coupled history/mode records. | A commit-origin marker is not a timestamp and does not make expiry implementable. | Owner/security approves clock representation, time-confidence/restore model, and T; validate Web CAS and Android Room boundaries. |
| M1 and live dedupe | Live M1 was absent on 7f12dd6. | `connectivity/m1-live-dedupe` adopts M1 pre-decrypt with the legacy alias on Web and Android, atomically written at acceptance. | Local M1 computation is present; no common retention or adoption rule. | M1 primary, legacy digest compatibility alias, pre-decrypt lookup, atomic durable write, no marker eviction while a copy remains valid. | M1 proves correlation/dedupe identity, not sender authentication or receipt. | Approve permanent-vs-bounded legacy retention and storage-pressure behavior; review migration/rollback behavior. |
| Web/Android acceptance | Web on 7f12dd6 wrote session, application message, and seen marker in separate boundaries. Android committed account/session/message/digest in Room. | `connectivity/m1-live-dedupe` adds atomic Web inbound acceptance and live M1; Android extends Room with M1 while preserving the legacy digest. | Current runtime keeps both compatibility and M1 markers. | Commit M1, legacy digest, ratchet, and message at one receiver transaction before positive relay acceptance. | Historical ADR statuses describe their source branches; current code is described in §2. | Review transaction recovery, duplicate races, and cross-platform restart tests. |
| Relay TTL/dedupe | Seven days from relay receipt, max 64 queued per mailbox; key exists only while mailbox row exists; ACK/TTL deletion permits later reinsertion. | current-behavior.md on connectivity/spec@3636ef3 and foundation-blocker-resolution.md on delivery-foundation-blockers@7a823b6 document this as independent relay storage. | Existing server behavior; no global lifetime rule. | Preserve mailbox policy and server IDs; receiver enforces new-contract expiry. Add server expiry enforcement only if server-side no-store/no-replay after T is a separate requirement. | Treating mailbox TTL as T conflicts with both current code and the handoff/foundation gate. | Owner chooses whether relay storage itself must be capped by T; backend review if so. |
| Capability/downgrade | Relay protocolFeatures is unauthenticated peer metadata; only join-introduction-v1 is recognized now. | transport-policy@a80672f ADR 0008 specifies transcript-bound capabilities but authorizes no wire/runtime migration. Older ADR 0004 material proposes using existing feature negotiation for controls. | No authenticated expiry capability protocol exists on this base. | Require authenticated fresh version negotiation; otherwise legacy relay-only. | ADR 0004's existing-list suggestion cannot establish authenticated support; later ADR 0008 explicitly says the list is not bound into the device proof/transcript. | Owner selects rollout/version rules; independent review of stripping, replay, overclaim, and downgrade. |
| ACK / receipts | Sender-visible events are relay-controlled; no authenticated peer-persistence receipt exists. | transport-policy@a80672f ADR 0006 specifies evidence states; ADR 0007/receipts-v1.md specify requirements but leave the receipt frame unapproved. handoff-v2@6b1be2c says relay ACK is not persistence. | The handoff's explicit boundary is that relay/transport ACKs do not mean peer persistence. | Never use relay ACK as expiry origin, peer persistence, or optional-path authorization. Retain the current receipt eligibility gate until separately resolved. | A proposed session-encrypted/batched D-R option is not an approved receipt protocol. | Owner decides whether product requires receipts; independent cryptographic review if a frame is proposed. |
| Offline freshness / PeerAdmission / LAN | No production LAN messaging or PeerAdmission. Relay remains sole production/default. | transport-policy@a80672f ADR 0005 leaves M6 open; lan-decision@bf71235 ADR 0009 is architecture direction only and keeps production LAN NO-GO. | No approved runtime admission/freshness protocol on this base. | Expiry support does not bypass verified unchanged contact, trust freshness, privacy, authenticated admission, or default-off gates. | The selected candidate carrier/discovery direction in ADR 0009 is not an implementation approval. | Owner resolves M6/D13/D14; independent review of PeerAdmission and actual-device evidence. |
| Deletion / restored state | Web deletion is partial local cleanup plus server soft-delete; it leaves the separate product-message record. No Android app-level conversation/account deletion was found. Relay mailbox rows are not deleted by link soft-delete. | No reconciled cross-platform tombstone/deletion/backup rule was found in the inspected connectivity ADRs. | None. | Deletion stops future use of the old conversation and clears its local queues/markers coherently; relay rows expire independently. Restores must preserve origin/tombstones or fail closed. | “Deleted conversation” must not be read as proof that every relay copy or separately stored local history row has been erased. | Owner approves deletion/data-retention product semantics; review backup rollback and tombstone erasure. |

### Owner choices and security review still open

- Numeric T; it is deliberately not selected here.
- A trustworthy time-confidence model shared by Web and Android, especially across shutdown/reboot, clock changes, offline receipt, and restored/rolled-back storage. Sender-signed time authenticates who asserted the value, not that it is correct UTC.
- Exact new envelope version/metadata encoding and a pre-decrypt verifiable binding of version, conversation, sender identity, M1, and original expiry. This is a wire-format change and needs an independent protocol/security review.
- Whether T only limits acceptance/retry or also requires the relay to stop storing/claiming/replaying at that boundary. The latter requires backend behavior changes.
- Legacy M1/digest retention, capacity exhaustion, rollback/minimum-version rules, and eventual tombstone cleanup.
- Whether an authenticated peer-persistence receipt remains an eligibility requirement for any future optional path; D-R is not closed.
- Conversation/account deletion semantics and how backups or sync preserve anti-rollback guarantees for outboxes and tombstones.

## 7. Safe characterization tests and next implementation boundaries

This policy branch adds no numeric-T or wire-format test. Safe current-behavior tests characterize that an accepted exact Web envelope is recognized before a second decrypt, and that relay dedupe suppression ends when its mailbox row is deleted. Existing tests already cover M1 fixture/JSON-format invariance, exact-ciphertext Web retry after restart, the unresolved horizon eligibility blocker, and relay capacity/expiry/deletion behavior.

Recommended implementation sequence after this policy review:

1. **First code-changing branch — connectivity/m1-live-dedupe:** adopt M1 in live Web and Android inbound processing, dual-read legacy digest plus M1, dual-write both at durable acceptance, preserve old records without speculative conversion, and add pre-decrypt/restart/fault tests. Include Web's atomic inbound acceptance boundary; Android extends its current Room transaction. Keep all transports relay-only, do not add expiry fields, choose T, or prune M1 markers. Fail closed on inability to persist dedupe state.
2. **connectivity/sender-age-origin:** close Web's ratchet/outbox transaction gap and add equivalent durable origin metadata to Android's existing outbound transaction. Do not activate expiration until a reviewed clock source and owner-selected T exist.
3. **connectivity/envelope-expiry-vN:** after the owner selects T and reviewers approve the time/binding contract, add the versioned authenticated metadata, sender state transitions, receiver stale/unknown handling, compatibility negotiation, and boundary fixtures. Do not silently re-encrypt expired work.
4. **connectivity/dedupe-retention:** implement bounded cleanup only after all valid copy/retry/replay sources are proven to stop at or before the authenticated deadline, with migration/rollback/backup and cleanup-boundary tests.
5. **connectivity/authenticated-capabilities:** implement and review version negotiation/downgrade separately from relay metadata; retain relay-only fallback for old or uncertain peers. PeerAdmission, receipts, and optional-path enablement remain separate gates.
6. **Relay changes only if required:** a server-side cutoff/purge at T is a separate backend branch; preserve the current server dedupe key and relay IDs. Do not combine it with M1 migration.

No branch in this sequence authorizes runtime LAN discovery, sockets, DataChannel messaging, multipath, PeerAdmission, or LAN-to-relay fallback by itself.
