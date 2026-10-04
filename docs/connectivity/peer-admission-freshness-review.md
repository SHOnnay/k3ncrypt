# PeerAdmission and freshness independent review package

Review date: 2026-10-05 (Asia/Dhaka).
Branch: connectivity/peer-admission-freshness-review.
Exact implementation baseline: 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1,
connectivity/sender-age-origin. No statement here claims adoption into main.

**Status: NOT READY FOR COMPLETE INDEPENDENT PROTOCOL SECURITY REVIEW.**
The requirements and M6 owner-decision package are available for independent
architecture review. Full protocol/implementation readiness is BLOCKED and the
protocol is NOT APPROVED.
The draft binary vectors make transcript requirements inspectable. They do not
complete the wire handshake, A1, M6, or live channel binding. Reviewers must not
infer authorization to implement from a passing fixture.

## Package contents and authority

- [Reconciliation/provenance table](specification-map.md): immutable historical
  sources, implementation evidence, current statements, conflicts and governing rules.
- [PeerAdmission candidate](peer-admission-v1.md): goal, transcript projection,
  exact candidate encoding, channel/replay/resource/failure/teardown requirements.
- [Freshness owner package / ADR 0005](adr/0005-offline-freshness.md): actual
  evidence trace, F1/F2/F3, offline and restore implications, decision form.
- protocol-fixtures/v1/peer-admission-transcript-review.json: unsigned,
  review-only byte vectors. Its transport and version names are not wire registrations.
- TypeScript and Kotlin fixture tests contain independent test-only encoders.
  No encoder, admission API, trust writer, signing helper or network adapter is
  added to production.
- [Existing dedupe/expiry policy](dedupe-expiry-policy.md) remains governing
  for M1 and sender origin; this review does not choose an expiry contract.

The user-requested security constitution governs this review. Historical documents
remain provenance unless an explicit reviewed decision adopts them. More detailed
later requirements can expose contradictions, but chronology is not approval.
Use IMPLEMENTED for this exact base, BRANCH-ONLY for another ref, VALIDATED for
bounded executed evidence, OPEN for missing decisions, PLANNED for roadmap, and
DECISION for an explicit review boundary. The old HANDOFF's main-specific facts and
failure results concern its named 2026-10-03 baseline.

## Threat model, assumptions and security goals

Assets are signing keys, pinned identity tuples, explicit verification, lifecycle
state/high-water records, existing Olm session, plaintext/history, exact ciphertext
outbox, inbound M1 state and network-presence privacy. Boundaries are the local
vault/crypto authority, conversation owner, untrusted discovery/rendezvous,
pre-auth carrier, admitted connection, lifecycle authority and relay.

Assume endpoint/vault integrity and uncompromised pinned device keys. A compromised
authorized endpoint can sign or disclose plaintext; admission cannot cure that.
An attacker may spoof discovery, own LAN endpoints, modify/replay relay capability
hints or rendezvous, open parallel connections, replay transcripts after restart,
strip versions, and observe failure/timing/network metadata. A stolen device may
retain signing capability after an unseen revocation. The relay may lie about
relay delivery but cannot establish user verification.

Successful admission must establish:

> This live transport connection is cryptographically bound to the already-known
> expected device for this already-existing conversation, under the current
> explicit trust, lifecycle and session policy.

Both parties must authenticate possession of their existing pinned Ed25519
device keys, the same conversation, roles, fresh challenges, complete offers and
selection, and locally observed live transport evidence. Local verification,
unchanged identity, lifecycle eligibility, approved M6 freshness, healthy existing
session and global/per-contact privacy permission must independently pass.

The output is an ephemeral, non-transferable local binding containing:
conversationId; expected remote and local device/key identities; authenticated
control/capability selection; actual connection/channel handle and evidence;
local freshness decision with source/scope/epoch and policy revision; a locally
measured admission expiry; admission state; and the security-state generation
against which it was issued. It is not persisted as contact trust or reusable
after restart. Field names and lifetime are review dependencies, not an API.

Non-goals: create or verify a contact, accept a fingerprint/invitation, establish
an Olm session from discovery, change verification/lifecycle state, replace E2EE,
prove peer persistence, solve unseen revocation, authorize relay access, or enable
any optional path. A connected socket or valid key signature alone is insufficient.

## Actual implementation and adoption gaps

| Area | Current base evidence | Consequence for PeerAdmission |
|---|---|---|
| Web device/key identity | PersistentVodozemacIdentity owns Curve25519/Ed25519 account; fingerprintVodozemacIdentity commits both normalized public keys. Machine deviceId/account scope is separately persisted by account binding. | Verify the Ed25519 key from the pinned complete identity tuple; never accept a newly supplied key/route as expected identity. |
| Web explicit contact trust | ContactIdentityRegistry records unknown/unverified/verified and changed-pending-review; first observe is unverified, changed key cannot inherit verified state, pending-change acceptance returns unverified. | Require verified plus unchanged, and revalidate pinned identity before signing, admission publication and every envelope dispatch. |
| Web signing | VodozemacRuntime.signControlEvent -> PersistentVodozemacIdentity.signControlEvent -> crypto-wasm Account.signControlEvent -> existing Ed25519 Account.sign(payload). Wrapper and Rust enforce nonempty payload <=16 KiB. | Arbitrary byte signing exists; domain-separated binary bytes can use the primitive only after transcript review. No key export or new library needed. |
| Web verification | ModernConversation.verifyJoinIntroductionSignature uses WebCrypto raw Ed25519 key import and signature verification; invalid/unavailable API fails false. It is private and introduction-specific. | Primitive demonstrated for introductions, but no public PeerAdmission verifier exists. Factor/review a bounded general adapter later; validate supported browsers and fixture parity, fail closed when unsupported. |
| Web lifecycle | DeviceTrustEnforcer/SecureStorageDeviceLifecyclePersistence check local active state, epoch, commitment and local high-water records; ModernConversation checks before protected operations. | This is locally known same-account lifecycle, not fresh third-party proof of a contact's current account/device mapping. Full backup rollback can roll back both list and high-water. |
| Web freshness | TrustFreshnessAdmission has an in-memory evidence Map, exact local epoch/commitment matching, and no timestamp, TTL or persisted evidence. | It is not a general offline contact revocation oracle. See ADR 0005. |
| Web session/invitation | Session health is healthy/unhealthy/renewal-pending; verified renewal is explicit. Invitation/pre-key/introduction pins an unverified descriptor and never marks verified. | Only a healthy existing session is optional-path eligible. No setup/renewal from discovery or admission. |
| Current capabilities | SocketIoRelayTransport/backend allow only join-introduction-v1, transiently relay-forwarded. List is outside the signed device proof. | Hint only; no A1, authenticated highest-common control version or transport-control-v1 exists. |
| Relay authorization | Signed request -> backend-issued short-lived proof -> active backend device/epoch, operation, nonce and resource checks. Android uses the same backend contracts. | Relay-only online authorization; server-held HMAC proof is not an independently peer-verifiable lifecycle attestation. Do not give it to an optional adapter. |
| Android identity/signing | CryptoPort/NativeCryptoBridge and Rust JNI expose existing Ed25519 signing over ByteArray; identity fingerprint commits Curve25519/Ed25519 pair. Local active lifecycle/epoch checkpoint survives restart. | Signing is present; current state cannot by itself prove current remote lifecycle or unseen revocation. |
| Android verification gap | SavedConversationIndex.isTrusted is peer route + fingerprint presence. There is no separate ContactVerification record in this base. | UNSUITABLE as explicit verification evidence for admission; missing/legacy record must fail closed after separately reviewed adoption. |
| Android verifier/introduction gap | CryptoPort has no verifyIdentitySignature; no production Android join-introduction parity/control capability gate here. | ADOPTION PREREQUISITE from verification/readiness, not silently imported. |
| Android session health | send/receive invalidate mutated volatile identity after an uncommitted failure; route/key equality checks exist. No matching Web health/renewal eligibility service is installed. | Need an authoritative Android healthy-session mapping/teardown signal before admission. Do not infer health from route or relay connection. |

Source anchors (all at the exact base):
service/src/identity/vodozemacIdentity.ts:69,155;
service/src/identity/contactIdentityRegistry.ts:62,107,124;
service/src/devices/deviceIdentity.ts:43;
service/src/devices/freshness.ts:17;
service/src/devices/trust.ts:31;
service/src/devices/runtime.ts:43,133,187;
service/src/crypto/modernConversation.ts:449,591,891,900,1390,1427,1558;
client/src/crypto/vodozemacModule.ts:26; crypto-wasm/src/lib.rs:132;
backend/security/controlCapability.ts:13;
backend/security/durableDeviceTrust.ts:50,104;
backend/socket.io/listeners.ts:23,175,264;
android/crypto/src/main/kotlin/com/k3ncrypt/crypto/CryptoPort.kt:10;
android/crypto/src/main/kotlin/com/k3ncrypt/crypto/NativeCryptoBridge.kt:38;
android/native-crypto/src/lib.rs:241;
android/app/src/main/kotlin/com/k3ncrypt/app/AndroidMessagingRepository.kt:46,69,296,411,460;
android/app/src/main/kotlin/com/k3ncrypt/app/AndroidIdentityLifecycleRepository.kt:100,202.

### Android adoption prerequisite

Source branch verification/readiness at
11b45172c5ba59a1e7e5c831944bcfdbf2f8207b is not an ancestor of this base.
Its prerequisite parent invitation-redesign/trust-state at
ed02b497f116a7c6cdfaaa8460afd619adeab422 adds explicit ContactVerification,
contact-verification-v1 storage, missing-record fail-closed behavior, independent
fingerprint confirmation and call gates. Readiness adds:

- CryptoPort.verifyIdentitySignature, NativeCryptoBridge normalization/length
  checks and Rust JNI verification with existing Vodozemac Ed25519 primitives;
- Android JoinIntroductionFrame and app acceptance parity, with descriptors
  remaining unverified, plus compatible feature-hint handling;
- protocol-fixtures/v1/verification-readiness.json and production bridge
  ProductionIdentitySignatureVerificationTest;
- Rust tests identity_signature_verifier_accepts_shared_vector_and_rejects_modified_bytes
  and vodozemac_production_signer_output_verifies_through_identity_api_primitive;
  Kotlin JoinIntroductionFrameTest, ContactVerificationPersistenceTest and Web
  verificationFoundation.test.ts fixtures.

These tests were inspected as source. This branch does not run the historical
JNI/verification instrumentation or claim it passes. Adoption needs its own
current source reconciliation, minSdk 26/build/provider validation, fixture runs,
guarded JNI/Room instrumentation and trust-writer review. No cherry-pick/merge.
Current service unit mocks that use Node Ed25519 are not browser/JNI validation.

## A1 dependency and placement decision

Authenticate both devices' complete bounded implementation offers, conversation,
roles, fresh nonce pair/context, intended peer, selected highest mutually
supported version, and downgrade outcome in the same accepted admission context.
Also bind capability dependencies and the exact carrier/control format eventually
chosen. A claim of support never overrides explicit verification, M6, privacy or
session health, and never authorizes relay access.

| Placement | Assessment | Decision needed in A1 |
|---|---|---|
| A: offers/selection inside PeerAdmission | Fits existing M5 requirements directly; both signatures must cover both complete offers and exact selection. | Exact frame order, limits, IDs, role/key mapping, negotiation completion and compatibility parser. Preferred candidate for review, not approved. |
| B: preceding exchange incorporated into admission | Safe only if exact canonical offer/selection bytes and fresh context are incorporated and authenticated by both final signatures; no unauthenticated result may enable a path. | A separate unbound result/cache is forbidden; review splicing, reconnect, omitted offers and circular dependencies. No new transcript hash proposed here. |
| C: another approved structure | No applicable approved authenticated optional-capability structure found in this base. Existing lifecycle JSON controls and relay hints are not such a structure. | Name an immutable independently reviewed protocol before adopting it. |

Selection is the highest compatible mutual version of the authenticated offers,
not necessarily the highest integer if future versions have different security
properties/dependencies. Any lower-policy selection needs an explicit reviewed
rule signed by both sides; unsupported or inconsistent outcome blocks admission.
Relay can cause availability loss by removing optional hints; it cannot thereby
authorize a weaker optional negotiation.

Old/unknown/malformed/unverified capabilities mean relay-only; ordinary legacy
messaging continues. Do not send a new probe as text/signaling into old parsers.
The old relay rejects unknown protocolFeatures IDs: A1 must design a compatible
server-first rollout or separate safe envelope and validate both rollout
directions. No new ID is advertised on this branch.

## Review readiness, blockers and stop conditions

| ID | Blocking question / deliverable | Who closes it |
|---|---|---|
| C1-K | How does a known contact's fingerprint/Ed25519 tuple map to expected deviceId and lifecycle account authority, especially across accounts? No route-to-device trust inference. | Independent identity/lifecycle review and explicit adoption package. |
| C1-W | Full mutual authentication flights, frame discriminator, signer-role separation, completion/confirmation and cancellation state machine are not approved. | Independent cryptographic/protocol reviewer. Candidate bytes below are a minimum projection. |
| A1 | Complete capability semantics/limits/IDs, highest-compatible selection, downgrade evidence, old parser and relay rollout. | A1 review. |
| M6 | Authenticated freshness authority/scope, F1/F2/F3, evidence lifetime/continuity/restore and user-visible policy. | Owner plus security reviewer. |
| C1-C / D13 | Actual WebRTC channel evidence on target platforms; association/stream binding, certificate reuse and replacement, renegotiation; or separately reviewed secure TCP carrier. | Carrier feasibility/security review. |
| C1-P | Android verifier, explicit trust-state and introduction adoption; healthy-session mapping and callback generation fencing. | Separate adoption/revalidation branch. |
| C1-R | Replay cache bounds, timeout, retention, sleep/reboot model and admission lifetime. | Protocol/security and platform/resource review. |
| D14 | Advertising/ICE permissions and global/per-contact privacy gates before network exposure. | Owner and privacy/platform review. |
| E1 / D-R | Expiry/time/restore/retention and future receipt/outbox completion still open. | Separate owner/protocol decisions before optional envelope delivery. |

Do not implement admission or a LAN adapter until required rows are closed and
the final transcript/state machine/fixtures are independently approved. Missing
key binding, stale/unknown lifecycle, unsupported carrier evidence, unavailable
verifier, ambiguous version/context, uncertain restore or failed privacy gate
must block optional paths. No path failure changes trust or disables otherwise
valid relay use. Carrier/admission success does not waive delivery eligibility
(M1 retention, durable acceptance, future receipt/completion and rollback gates).

## Test plan and evidence limits

This branch executes only review encoding conformance and existing regression
tests. Shared unsigned vectors cover both signer roles, swapped roles, changed
conversation/device/key-reference/nonces/offers/selection/binding and downgrade.
They prove candidate byte agreement, not Ed25519 safety, identity mapping,
freshness, live binding, anti-replay effectiveness or physical LAN.

Later approved-protocol tests must inject wrong known/unverified/revoked devices,
changed fingerprints, mismatched lifecycle scopes/epochs, missing/stale/conflicting
freshness, signature mutation/unavailable API, replay across roles/conversations/
devices/carriers and restart, substituted SDP/cert/association/stream, parallel
handshakes, duplicate flights, stripped complete offers, incompatible selection,
malformed/oversized frames, exhausted budgets, cancellation/timeout and teardown
races. Prove no trust/contact/session/history write on rejected admission, no
application envelope before admission, no stale callback reopens a closed path,
same exact ciphertext on future retry, M1 dedupe before decrypt, and relay unaffected.

### Executed validation on this review branch

| Check | Result / scope |
|---|---|
| Full root Jest: npm test -- --runInBand --coverage=false --forceExit | PASS: 107 suites, 542 tests; 3 suites / 7 tests skipped. Includes all 12 review vectors. |
| Service Jest: npm run test --workspace=service -- --runInBand --coverage=false --forceExit | PASS: 75 suites, 428 tests, no skips. Initial new fixture type error was fixed for the service's stricter TS configuration. |
| Final root fixture after that type refinement | PASS: 1 suite / 15 tests. Full root source behavior is unchanged by the type-only correction. |
| Kotlin fixture: :messaging:testDebugUnitTest :messaging:testReleaseUnitTest --tests com.k3ncrypt.messaging.PeerAdmissionTranscriptFixtureTest | PASS: 2 debug + 2 release executions; zero failures/errors/skips. Both independent encoders match every frozen role payload. |
| npm run lint | PASS on final test sources. |
| git diff --check / staged diff check | PASS. |
| Android instrumentation | NOT RUN: no production or instrumentation-relevant change; guard untouched. |

Jest used --forceExit and printed its open-handle advisory; tests all completed
and passed. No investigation or assertion of handle cleanup is claimed. The
Kotlin runs are focused unsigned fixture unit checks, not the full Android suite,
JNI verification, emulator validation or physical LAN. Dependency installation
used npm ci --ignore-scripts --offline with the existing lockfile; no dependency
or lockfile changed. No client/SDK build was required for this documentation and
test-only branch. Production source, transport flags and existing fixtures did
not change. Test logs are local execution artifacts, not signed security evidence.

No Android production/instrumentation-relevant code changes, so guarded
instrumentation is not rerun. Existing sender-origin reported 106 root suites / 527 tests, 74 service
suites / 413 tests, 68 debug + 65 release Android unit executions, one focused
sender Room test and five guarded instrumentation tests; those remain historical
base evidence, not this branch's runs. Its committed diff has seven changed files;
AndroidMessagingRepository.kt was inspected, not modified, despite an earlier
eight-file conversational inventory.

## Roadmap and next review boundary

Recommend A1 next on connectivity/authenticated-capability-review, using the C1
binding requirements and review blockers above. It should deliver negotiation
encoding, role/flight completion and rollout decisions; it must not implement a
LAN adapter. D13/D14 then need a carrier/discovery/privacy decision and platform
binding evidence. M6 owner approval and E1 expiry/clock/restore closure remain
required before optional delivery; E1 may proceed as owner work in parallel and
must not reuse admission monotonic TTL or senderOrigin as message-age evidence.

Future architecture still includes same-LAN messaging, remote direct peer
connectivity, secure file sharing, video calls, privacy-preserving notifications,
optional user-operated/self-hosted rendezvous/relay nodes and visibility UI.
User-operated nodes gain no peer trust by relaying. Discovery/address privacy
and node policy need their own review. VPN/TUN/site-to-site networking is a
separate architecture; service/src/privateNetwork is not a chat path adapter.


## A1 review overlay — 2026-10-05

See [authenticated capability review](authenticated-capability-review.md) and
[A1 immutable source reconciliation](authenticated-capability-reconciliation.md).
A1 uses a separate unsigned review domain and literal complete offers; it recommends
a fixed reviewed preference profile rather than assuming numeric ordering, derives
the outcome, and compares three-flight authentication with completion loss.
This supersedes C1 bare-list/explicit-outcome projections only as an A1 candidate;
C1 fixtures and historical claims are preserved. Complete protocol readiness remains
blocked by final key/lifecycle/binding, bootstrap framing, completion and policy decisions.
No production negotiation, admission, trust adoption or LAN/direct implementation.
