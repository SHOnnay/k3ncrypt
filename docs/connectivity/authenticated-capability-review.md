# A1 authenticated capability and downgrade review

Status: REVIEW CANDIDATE — NOT APPROVED. **NOT READY FOR COMPLETE INDEPENDENT SECURITY REVIEW.**
Date: 2026-10-05. Exact base: e7a4385f167cc168947755325d0de5ed22c3f0b9.
Branch: connectivity/authenticated-capability-review. Documentation and unsigned test projections only.

## Read independently

This package designs authenticated support claims for an already-known expected device and existing conversation. It creates no trust. Relay is the only production/default message path. Current base contains live M1/legacy dedupe before decrypt, atomic Web inbound and Room inbound, atomic sender session/outbox/history boundaries and exact persisted ciphertext retries. senderOrigin is local durable-commit metadata without a trusted timestamp. No numeric T, expiry enforcement, LAN/direct runtime or physical LAN validation exists.

Read [A1 reconciliation](authenticated-capability-reconciliation.md), [C1 requirements](peer-admission-v1.md), [C1 source/freshness review](peer-admission-freshness-review.md), [M6 owner package](adr/0005-offline-freshness.md), and [expiry policy](dedupe-expiry-policy.md). Historical source rows carry immutable commit/blob identifiers. Chronology and headings are not approval. C1 unsigned vectors are frozen provenance, not reinterpreted by A1.

## Threat model and current implementation

Assume intact endpoints/vaults and pinned keys. A malicious relay/LAN intermediary can strip, substitute, reorder, replay, delay or suppress control traffic, spoof discovery, open parallel connections and observe metadata. An authenticated malicious peer can underclaim/overclaim capabilities; signatures prove its declaration, never implementation correctness or newest revocation state. Compromised devices and full backup rollback remain outside capability assurance. Assets include explicit contact verification, identity/lifecycle authority, session state, delivery durability and address/presence privacy.

Current SocketIoRelayTransport/backend supports only join-introduction-v1 as transient protocolFeatures. The list is outside the signed device proof. Backend rejects unknown/duplicate/malformed IDs; clients clear hints on disconnect/conversation change. No general negotiated version or capability authentication exists. Android base lacks this parity, independent verified state and generic native verifier. Envelope version validators are format checks, not negotiation. OptionalPathReadiness on both platforms is a pure checklist; capabilitiesAuthenticated is not an implementation of authentication. Existing call capability does not establish messaging DataChannel support.

Security goals: both signatures authenticate the same complete offers and selected contract, pinned expected identities, existing conversation, fresh roles/challenges and reviewed live carrier binding. No incomplete offer or cached result enables a path. Policy/trust/freshness/session checks remain independently authoritative. Rejected capability exchange creates no contact/session/trust/history record and never changes relay authorization, crypto, retries or receipt semantics.

## Capability categories and narrow review registry

| Category | Complete offer field / draft IDs | Meaning and boundary |
|---|---|---|
| Control/protocol | admissionVersions, negotiationVersions, controlVersions | Exact supported format sets; no ranges, implicit minor compatibility or integer security ranking |
| Transport | review/lan-envelope | Carrier of existing encrypted envelopes; D13 must select actual carrier/association/stream contract before registering production ID |
| Security semantics | review/expiry, review/peer-persistence-receipt, review/dedupe, review/freshness | Exact independently reviewed semantic contracts; their presence never supplies current evidence or selects F2/F3 |
| Application features | Excluded from initial required set | File/video/node roles require separate interop/security review; voice support is not messaging capability |

The five exact review IDs above are synthetic, unregistered fixture labels. No production identifier is assigned here. The narrow first optional path requires all five plus admission/negotiation/control formats. Shared horizon, expiry/restore/time, authenticated receipt and outbox completion remain OPEN; declaring review/expiry version 1 does not close E1. Future direct paths require separate profiles. Local policy may disable a supported feature; it must not silently rewrite a retained complete offer to simulate weaker implementation support. A reviewed offer policy must decide whether privacy restricts advertising support; no network exposure is required just to declare support.

## Exact complete offer and canonical encoding candidate

The test schema is a closed object:

```
{offerVersion:1, admissionVersions:[...], negotiationVersions:[...],
 controlVersions:[...], capabilities:[{id,versions:[...]}], requiredIds:[...]}
```

Complete means the frozen entire locally eligible implementation declaration for this negotiation/profile, not an intermediary's intersection or filtered subset. Both offer blobs are signed unchanged; each owner compares its retained offer byte-for-byte before accepting/signing the final transcript. Offers are frozen through completion; a local update cancels and restarts with new nonces. Production profiles must authorize exact identifiers, dependency semantics, eligibility to advertise, and compatible tuples; the test profile is deliberately synthetic.

All version arrays are nonempty sets of exact positive U32 values; sort ascending for canonical serialization, reject duplicates before sorting. IDs are nonempty lowercase ASCII [a-z0-9/-]+; compare raw ASCII bytes. Capability entries and requiredIds sort by ID, duplicate IDs reject. requiredIds must be advertised, and production profile's mandatory set cannot be removed or weakened by the peer. Unknown optional capability IDs are bounded and retained literally in authenticated offers but never selected. Unknown required IDs fail negotiation. Unknown schema versions/fields, unsupported critical fields, empty version sets, out-of-range values, malformed strings, noncanonical wire order and trailing bytes reject. No Unicode normalization, case folding, ranges or lossy numeric conversion. Input-object permutation is allowed before encoding; wire form must already be canonical. JSON is a fixture transport, not wire encoding.

U32 is four unsigned big-endian bytes. LP(b)=U32(byte length)||b. Text uses strict UTF-8, rejects isolated UTF-16 surrogates. Canonical offer bytes in fixed order:

1. U32 offerVersion.
2. admissionVersions, negotiationVersions, controlVersions: U32 count then U32 values each.
3. U32 capability count then each LP ASCII id followed by count/versions.
4. U32 requiredIds count then each LP ASCII id.

Counts/lengths are bounded before allocation; no production limits are assigned here. Required version dependencies are an exact profile table, never combinations inferred from numerical similarity. Arrays denote supported formats, not preference. Literal complete offers also authenticate unknown optional data; no omitted extension bag exists.

A1's unsigned full-context projection has a DISTINCT domain, k3ncrypt/peer-admission/a1-review, with U32 draft format 1. It is not a new approved wire version or reinterpretation of C1 v1. Fixed order: LP domain, U32 draft format, LP signerRole, LP preferenceProfileId, LP conversationId, LP initiatorDeviceId, LP initiatorIdentityReference, LP responderDeviceId, LP responderIdentityReference, LP initiator role literal, LP responder role literal, LP initiatorNonce raw, LP responderNonce raw, LP canonical initiator offer, LP canonical responder offer, U32 selected control version, U32 selected-capability count then sorted LP id/U32 version entries, LP transportBinding raw bytes. Test nonce pair is 16 bytes each; minimum follows C1 draft, entropy/generation/retention need review. Binding bytes are the opaque ASCII test marker UNAPPROVED-SYNTHETIC-BINDING, deliberately not a purported live fingerprint/association/stream contract. C1 fingerprint-pair projections remain separate provenance; neither is sufficient live DataChannel evidence. Key-reference/device lifecycle mapping and lifecycle/admission context remain blockers before full signed vectors.

Both signer payloads differ only in signerRole while covering identical semantic context. Each verifier reconstructs bytes locally from retained state and validated remote fields, using the expected pinned key, never a message-supplied identity as authority. Identity references commit the existing Curve25519/Ed25519 tuple; the missing cross-account device/account mapping remains C1-K. No signature output is generated. Existing bounded Ed25519 Account.sign is the only primitive proposed; no new crypto/library.

## Deterministic selection and downgrade

No repository authority establishes safely monotonic integer versions. ADR 0008's highest-common statement is qualified here: maximum is permissible only after version owners/security reviewers authorize a monotonic compatibility/security order and all dependency tuples. Alternative A: explicit profile preference table. Alternative B: reviewed monotonic ranking. Alternative C: only one reviewed exact version, reject all other combinations. Owner/security must select one and prohibit deprecated contracts. A1 recommends A for review; production table is OPEN.

Unsigned test profile review/preference-1-before-2 intentionally ranks control version 1 ahead of 2, demonstrating that largest integer is not automatically preferred. Admission/negotiation sets must share version 1 for this fixed bootstrap schema. Each draft capability requires exact semantic version 1. Unknown versions are retained, but never selected unless the local reviewed registry names them. Algorithm:

1. Validate both complete offers and exact profile ID; never negotiate the preference policy from arrival order or peer unilateral choice.
2. Require the profile bootstrap admission/negotiation version in both offers. Production must specify how a different bootstrap version is safely recognized without recursion.
3. Reject unknown required IDs. Union both required sets with the profile mandatory set; verify each dependency's allowed exact version occurs in both offers.
4. Walk the fixed control preference table and choose the first common version with a compatible complete dependency tuple. No common allowed tuple fails optional negotiation.
5. Select only registry-known required capabilities under that profile (all five in fixtures); optional unknowns remain authenticated but disabled. Different profile IDs fail, no implicit fallback.
6. Both independently recompute and compare the exact result. Recheck local supported implementation/profile and policy before publication; incompatible updates cancel.

Selection is symmetric under swapping the two offers, independent of packet arrival order. Its determinism proves agreement under an agreed profile, not safety of that profile. Fixtures use one uniform dependency tuple; future production tables must encode per-control-version tuples explicitly.

No downgradeOutcome/selectionReason field: result is derived from authenticated offers and fixed profile. Local classifications: ONLY_COMMON, ASYMMETRIC_SUPPORT, PREFERRED_COMMON, NO_COMMON, RESULT_MISMATCH. These are diagnostics, never extra signed authority. C1's explicit highest-common/reject-lower-selection strings remain frozen old projections and are superseded only for this new A1 candidate, with no production adoption.

Both only X vs both X/Y vs asymmetric offers are distinguishable from signed complete sets. Changed/lower selection fails recomputation (including a numerically higher but less-preferred version). Removing any advertised value changes signed bytes even if selection happens to remain the same. F1 modifications are caught when initiator compares its original complete offer in F2; F2 modification breaks responder signature; F3 modification breaks initiator signature or responder's retained transcript comparison. A peer deliberately signing an underclaim is not detectable as intermediary stripping. Suppression can prevent optional negotiation; relay-only availability is retained. Stale offers cannot be authenticated into a new pair of pending fresh challenges by replay alone. Unsigned byte differences demonstrate binding sensitivity, not executed authentication.

## Flight candidates, mutual authentication and completion

| Structure | Authentication / completion | Review conclusion |
|---|---|---|
| Two flights: I nonce/offer; R nonce/offer/result/signature over full T | I authenticates R and sees its own offer retained. R has no I signature over R's nonce/offer/selection; an F1 signature would still not prove final acceptance. | Insufficient for mutual final-transcript acceptance |
| Three flights: F1 I nonce/complete offer; F2 R nonce/complete offer/result/Sign_R(T,R); F3 Sign_I(T,I) | I validates F2 against retained F1 and local binding, recomputes selection, verifies pinned R; R validates F3 against exact retained T and pinned I. | Recommended review candidate for mutual authenticated agreement; no atomic shared liveness claim |
| Four flights: same plus R completion acknowledgment | Can report that R processed F3, but final acknowledgment can also be lost. Needs reviewed authenticated framing and retry semantics. | Potential activation barrier; production delivery behavior remains OPEN |

F1 is untrusted and cannot trigger expensive/unbounded work or capability-compatible state. R signs only after all its identity, policy, current context and available freshness prerequisites pass; no app envelopes flow while pending. I must verify expected R key, own frozen offer, both contexts/nonces/roles, selected dependencies and locally observed binding before signing F3. R independently verifies expected I key and identical final transcript before treating capability agreement as authenticated. I's F3 proves key possession/acceptance to R; R's F2 proves that to I. Neither proves explicit user verification or newest lifecycle state.

Three flights are sufficient for each side to authenticate the same result once it has the required peer signature; they are NOT sufficient for both sides to know the other received the final flight. I retains AUTHENTICATED_RESPONDER / CONFIRMATION_SENT, R only becomes CONFIRMED after valid F3. If F3 is lost, R times out and I must not claim bilateral admitted readiness. No arbitrary finite acknowledgment chain creates atomic completion under loss. Production publication/first-envelope barrier needs independent review: either an authenticated completion acknowledgment under the same T (with I gated until receipt), or a reviewed owner protocol that handles pending peer state. This branch does not select a production activation construction. Local admitted states must never reference different T; matching transcript authentication is distinct from synchronized connection liveness. No application envelope is allowed by this candidate alone.

Simultaneous open: each initiator attempt has a distinct nonce/generation and carrier handle. Do not splice roles or offers across attempts. A deterministic expected-device-ID lexical tiebreak is a possible candidate but not approved until C1-K mapping and carrier allocation are settled; until then simultaneous open must fail closed/cancel rather than implement an ambiguous winner. Reflection fails role domain and expected key/device direction, self-peer must reject. Duplicate exact F2/F3 may be idempotent only for the same live pending attempt and generation, without republishing admission or extending lifetime; conflicting duplicate cancels. Replayed F2 is rejected unless pending initiator nonce/offer/connection match; never reuse old challenges on reconnect. Completed/expired attempts cannot be reopened. Timeouts/cancellation close and erase pending authority; late callbacks require generation fencing. Fresh responder nonce protects against replayed F1 authenticating without a new F3. A replayed F1 may consume only bounded pre-auth work. Restart discards all pending state; replay cache is an adjunct, not a substitute for fresh unpredictable local challenge and current carrier binding. Actual anti-replay, signatures, callback and timeout behavior is not implemented/tested here.

## Incorporation comparison

| Option | Ambiguity / complexity / parity / future change / replay | Candidate |
|---|---|---|
| A: literal complete offers/result inside same signed admission T | One canonical encoding, direct byte fixtures, easiest retained-offer comparison; larger bounded payload. Strict versioned evolution. Nonces/roles/conversation/binding signed with offers prevent splicing. | Select A for review |
| B: separate canonical data digest inside admission | Requires canonical preimage, digest domain/algorithm/version/length rules and availability of complete data for verification; extra hash implementation/parity and review. Can prevent splicing only with same fresh context and both signatures. | No need demonstrated; not selected |
| C: existing approved construction | Existing Olm signaling authenticates messages but no approved final optional capability/admission protocol was found. Relay proof/HMAC/hints are not peer capability authority. | No applicable approved construction |

No independent capability signature/cache may be transplanted between conversations, peers, roles, connections or restarts. Literal offers avoid proposing a new digest construction; they do not solve C1 key mapping, M6 or D13 channel binding.

## Relay, framing, old clients and rollout

Relay may carry bounded opaque messages only through a later reviewed channel authorized by existing access rules. It may not assert peer support or approve identities. Reorder canonical input sets before signature has no semantic effect; raw wire reordering must reject unless reparsed to the same strict canonical representation by an approved protocol. Stripping/change breaks the exact reconstruction/signature chain; replay fails pending context; suppression is availability loss and optional stays disabled. No negotiation sends new protocolFeatures IDs today. Relay authorization proofs are not optional carrier credentials.

| Pair | Exact behavior |
|---|---|
| NEW ↔ NEW | Future reviewed negotiation only after privacy/trust/adoption/carrier/freshness prerequisites; optional remains disabled until all delivery gates pass |
| NEW ↔ OLD | Relay-only, no probe sent into legacy chat/signaling parser, no optional eligibility inferred |
| OLD ↔ NEW | Same, new peer does not wait on mandatory new negotiation for legacy messages |
| OLD ↔ OLD | Existing relay/message/call behavior unchanged |

NEW means a future implementation of an approved A1 contract, not this branch. Current Web unknown printable controls can render as chat; Android framing differs. Safe discriminator/channel and delivery to only capable receivers is an OPEN wire rollout blocker. Do not test support by injecting unknown plaintext controls. Server-first deployment may introduce a separately reviewed opaque channel/capability without modifying the existing join allowlist, but server metadata cannot prove peer support. How a new peer safely learns another can parse the bootstrap exchange remains OPEN: needs approved existing authenticated channel/discriminator and old-client tests, not a circular self-asserted negotiation. If old relay rejects any new feature ID, never retry by weakening identity/proofs; continue the current accepted join payload and relay messages without optional negotiation.

Additional relay deployment matrix (a future migration must execute these rows; source inspection and regression tests here do not validate an unimplemented migration):

| Local client / peer | Old relay | Updated relay |
|---|---|---|
| OLD / OLD | Unchanged current join/messages/calls | Must preserve omitted/legacy fields and current behavior |
| NEW / OLD | Current accepted join only; relay-only; no probe | Same; updated relay cannot authorize a new control to OLD |
| OLD / NEW | NEW peer preserves legacy interaction, no injected controls | Same; unknown hint never enables OLD |
| NEW / NEW | Relay-only unless separately approved backward-compatible bootstrap exists; adding unknown join ID is prohibited | Future approved opaque channel may transport exchange; both peer signatures/all gates still required |
| NEW disabled / any peer | Relay-only without optional exposure | Same, no server-driven activation |

Staging: approve bootstrap framing and matrix, deploy backend compatibility if needed, then clients with optional disabled, validate mixed clients/servers, then explicitly authorize selected optional profile only after all gates. Rollback: older binary loses capability state and uses existing relay; optional transcript state is never durable authority. Legacy pending outbox entries keep exact original ciphertext and legacy semantics; do not rewrite, expire or re-encrypt them on upgrade. New-contract messages require separate E1 migration/rollback policy and must not be exposed to an old parser. Peer upgrades while offline and peer downgrades require a new authenticated offer on a fresh attempt; stale relay metadata/cache never substitutes. Relay suppression may prevent optional networking indefinitely; no downgrade of crypto or verification follows.

## Lifetime, policy order and dependencies

Evidence is ephemeral admission-and-exact-connection scoped, additionally bound to conversation/device/identity/profile/generation. No durable capability cache, contact profile, account trust record or reusable signed admission. Any display hint must be explicitly nonauthoritative and contain no private transcript data. Reconnect/restart/restore always renegotiate with fresh local nonces after prerequisite validation. Identity/verification change, revocation/lifecycle epoch change, freshness invalidation, session unhealthy/renewal/delete, privacy change, local feature disable, protocol/profile upgrade, binding replacement or incompatible renegotiation invalidates pending and confirmed state. Admission expiry/clock continuity has OPEN value/rules; uncertainty closes optional state. Generation fencing prevents stale async verification callbacks restoring eligibility. Recheck all gates at signature, publication, outbound dispatch and inbound owner handoff.

Ordering: (1) local global/per-contact feature and privacy permission BEFORE discovery, advertising, candidate gathering or provisional carrier; (2) explicit verified unchanged expected identity and healthy existing session plus local lifecycle eligibility, early freshness check if obtainable; (3) bounded permitted provisional carrier, no application traffic; (4) fresh context and complete-offer exchange; (5) both signatures and independent selection verification; (6) authoritative M6 freshness and all current policy revalidated; (7) reviewed completion barrier and admission publication; (8) delivery only after full M1/horizon/expiry/receipt/outbox checklist. If privacy forbids network exposure, relay-only without candidate gathering is a complete valid state. Capability exchange cannot trigger gathering merely to learn support.

M6 stays distinct: valid signed support can still be ineligible under freshness. Local epoch equality is not proof of newest remote revocation. F1 authority/continuity needs a reviewed source; F2 cached-offline relaxation is NOT approved; F3 block new optional admission without required fresh authority is recommended, NOT owner-approved. No time/T/TTL is derived from nonces or senderOrigin. D13 must choose carrier and prove locally observed exact association/stream binding; both DTLS fingerprints alone are insufficient under reuse/multiplexing. Raw TCP is unsupported without separate authenticated carrier review. D14 must choose discovery/advertising permission/privacy behavior before exposure. Neither A1 nor call/ICE success closes these gates.

Android adoption: verification/readiness at 11b45172c5ba59a1e7e5c831944bcfdbf2f8207b and trust-state parent ed02b497f116a7c6cdfaaa8460afd619adeab422 contain prerequisite explicit verification/native Ed25519 verification/introduction parity. They are not ancestors of this base and are not merged here. Base's route/fingerprint presence is insufficient. Separate current-line adoption must review sole explicit trust writer, legacy missing-record fail-closed behavior, actual expected-key/device mapping, session health, native/browser supported platforms and bounded verification. No parallel trust system is invented. Test-only encoders are not Android adoption.

## Resource bounds and failure privacy

| Bound | Required enforcement | Approved value |
|---|---|---|
| Offer bytes, IDs/ID bytes, version counts | Limit before parse/allocation, reject duplicate/conflicting entries | REVIEW PARAMETER — VALUE OPEN |
| Control frame bytes | Include wrapper/signatures; never exceed existing signer payload ceiling | REVIEW PARAMETER — VALUE OPEN; existing signing ceiling 16 KiB is a ceiling, not new frame approval |
| Negotiation timeout and admission lifetime | Monotonic local deadlines, cancellation, sleep/continuity uncertainty closes attempt | REVIEW PARAMETER — VALUE OPEN |
| Pending per conversation/device and global; unauthenticated concurrency | Reserve bounded slot before work; reject saturation without allocation cascade | REVIEW PARAMETER — VALUE OPEN |
| Replay cache entries/retention | Bounded memory; no stale attempt resurrection on eviction | REVIEW PARAMETER — VALUE OPEN |
| Verification work/rate/queue | Cheap syntax/context checks before crypto, bounded CPU budget, canceled generation ignored | REVIEW PARAMETER — VALUE OPEN |

Existing relay mailbox TTL/frame limits are not capability or admission policy. Do not copy five-second retry throttle as handshake timeout. U32 framing range is representational, not permission to allocate 4 GiB. No test constant below is a production budget.

Unknown optional IDs: ignore/drop option would erase signed provenance and complicate parity; retained authenticated-but-disabled option supports strict closed schema evolution; fatal-all option is conservative but causes optional incompatibility on any addition. Recommend retained unknown optional IDs, fatal unknown required/schema/critical fields, pending independent review. Both parties use exact bytes and cannot select unknown IDs/versions. Production policy registry must define whether an extension is required; no unknown JSON fields sneak into transcript.

Externally timeout/close or one bounded generic OPTIONAL_UNAVAILABLE indication after reviewed framing; do not expose verified/revoked status, detailed supported versions, registry state or policy reasons. Complete offers necessarily disclose support. The proposed unsigned F1 does not authenticate its sender: sending F2 on a merely provisional carrier can reveal responder versions to an attacker even when later F3 fails. An existing authenticated encrypted carrier/control channel could prevent that exposure; alternatively a reviewed initial authentication step may be required. The exact bootstrap and pre-auth disclosure rule is an A1-W/D14 blocker, not a secrecy claim. If sent clear on carrier, metadata leakage remains a carrier/privacy review decision. Do not claim offer secrecy from signatures. Local bounded reason codes CAP_NO_COMMON_VERSION, CAP_TRANSCRIPT_MISMATCH, CAP_RESULT_MISMATCH, CAP_UNAUTHENTICATED, CAP_POLICY_BLOCKED, CAP_STALE_CONTEXT, CAP_RESOURCE_LIMIT may classify failures without logging transcripts/signatures/fingerprints/keys/identity IDs/endpoints/ICE/invitations. No new diagnostics/UI/assets/dependencies.

## Unsigned fixture scope and implementation stop conditions

New protocol-fixtures/v1/authenticated-capability-review.json freezes synthetic complete-offer and both-role transcript bytes with signatureOutputs:null and productionEligible:false. Independent test-only TypeScript/Kotlin encoders cover identical/asymmetric/no-common/preference selection; set reordering; duplicate rejection; stripped high version; changed selection/offer/nonce/role/conversation/device/identity/binding; stale context; unknown optional retained/required rejected. Canonical conformance and local selection/context checks only. No production parser, signature check, carrier or handshake test is claimed. C1 vectors remain unchanged. Signed vectors NOT READY: final fields/key mapping/flights/activation/incorporation and bounds must settle and pass security review first; then only READY TO PREPARE AFTER SECURITY REVIEW, never automatically approved.

| Blocker / decision | Required owner/evidence |
|---|---|
| A1-P preference/registry/dependency tuple | Version owners + independent security approval; monotonic vs explicit preference vs single version, prohibited versions, exact production IDs |
| A1-W bootstrap/discriminator/old-client-safe channel | Protocol/backend owners + Web/Android mixed-version parser tests, no circular probe |
| A1-F completion barrier and simultaneous open | Independent mutual-authentication/state-machine review including loss/duplicates/timeouts/reflection |
| C1-K expected device/account/key/lifecycle mapping | Identity/lifecycle security owner, exact cross-contact authority mapping |
| C1-C/D13 exact carrier binding and platform evidence | Carrier security/platform review; cert reuse/channel replacement/association/stream |
| M6 F1/F2/F3 and continuity/restore | Explicit owner + security closure; F3 recommendation alone is insufficient |
| D14 privacy/advertising/discovery and offer disclosure | Owner/privacy/platform review before gathering/advertising |
| ANDROID-ADOPTION and Web verifier adapter | Separate trust-writer/native/browser verifier/current-line validation |
| C1-R bounds/nonce/deadline/cache | Security/resource/platform review with approved numeric budgets |
| E1/D-R delivery semantics | Expiry/clock/restore/common horizon + receipt/outbox completion review |

A1 structural choices are candidates for focused review, but the COMPLETE protocol is NOT READY FOR INDEPENDENT SECURITY REVIEW: bootstrap framing, production preference/dependencies, final lifecycle/key mapping, binding fields and completion barrier remain structurally unresolved. Stop implementation if any is missing; valid fixtures do not waive blockers. All optional paths remain disabled. Relay fallback under existing authorization continues. No LAN adapter is started.

Recommend D13/D14 next to settle carrier binding and permitted discovery/privacy before final transcript fields. M6 owner closure, E1 time/restore/horizon and Android adoption remain mandatory alongside A1 final independent approval and receipt/completion gates before first production LAN adapter. Physical Wi-Fi/offline/mixed-platform validation belongs to a later approved plan; no emulator/test-only projection is that evidence.


## Executed validation — 2026-10-05

- Full root Jest: 108 passed suites, 3 skipped; 564 passed tests, 7 skipped. Command: npm test -- --runInBand --coverage=false --forceExit.
- Full service Jest: 76 suites / 450 tests passed, no skips. Command: npm run test --workspace=service -- --runInBand --coverage=false --forceExit.
- New TypeScript fixture contributes 22 checks, covering 18 vectors and both signer payloads. Existing C1's 15 checks remain passing and its frozen vectors are unchanged.
- Kotlin focused :messaging:testDebugUnitTest and :messaging:testReleaseUnitTest, restricted to AuthenticatedCapabilityFixtureTest and PeerAdmissionTranscriptFixtureTest: 3 new A1 + 2 existing C1 tests per variant, 10 total; zero failures/errors/skips. BUILD SUCCESSFUL. No instrumentation ran.
- npm run lint PASS; git diff --check PASS. Dependency install used existing lockfile with npm ci --ignore-scripts --offline; no dependency/lockfile changes.

Jest --forceExit printed its existing open-handle advisory; no handle-cleanup claim. Kotlin Gradle compiled existing native dependencies as part of focused unit task prerequisites; these runs do not execute production JNI verification instrumentation. Tests establish unsigned encoding, symmetric synthetic selection and retained local context checks only. They do not validate live mutual authentication, actual freshness/nonce entropy/replay defenses, old/new deployment migration, live carrier binding, physical LAN or protocol approval. No production source, UI, flags, assets, schemas or dependencies changed. Nine changed files: four documentation overlays, this package and source reconciliation, the new shared JSON fixture and two test-only encoders.
