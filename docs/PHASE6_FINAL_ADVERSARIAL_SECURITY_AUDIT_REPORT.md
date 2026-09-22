# K3ncrypt Phase 6 Final Adversarial Security Audit

## Executive summary

This review tested the implementation present in the working tree, including the uncommitted Phase 6C files. Documentation was treated as an assertion to verify, not as evidence.

**Final verdict: PHASE 6 SECURITY NOT READY.**

The cryptographic primitives and the Phase 1-5 message, mailbox, attachment-encryption, and call-signaling boundaries were not changed by this audit. However, Phase 6 does not yet provide an end-to-end authenticated security boundary for distributed trust, synchronization admission, group membership, or group calls. Several public APIs accept caller-created identity evidence, admission acknowledgements, or membership snapshots. A caller that can reach these APIs can therefore satisfy a security decision without proving that the purported remote device produced it.

The audit also found a direct privacy regression: constructing a WebRTC peer starts microphone acquisition without an explicit user action. Recovery and native secure-storage boundaries contain crash/locking defects, and the documented device-joining and synchronized record-import flows are not fully connected to real runtime consumers.

No production source was changed during this audit.

## Scope and method

Reviewed areas included:

- device lifecycle, authenticated device contexts, enrollment, revocation, trust freshness, and runtime composition;
- authenticated sync frames, relay, admission, record validation, durable state, replay handling, and crash recovery;
- recovery archives and replacement ceremony;
- group membership, group-state persistence contracts, and group-call admission;
- platform secure-storage and permission boundaries;
- actual call/media capture paths;
- runtime references, tests, factories, unused paths, and documentation claims.

The review used static call-path tracing, adversarial input analysis, repository-wide reference searches, and the existing automated validation suites. Findings are ordered by severity.

## Findings

### F-01 — Critical — Distributed trust freshness is optional and accepts caller-created evidence

- **Component:** device trust and synchronization admission
- **Location:** `service/src/crypto/modernConversation.ts:251-255`, `service/src/devices/trust.ts:38-39,63-70`, `service/src/sync/contracts.ts:19-21`, `service/src/sync/runtime.ts:20-30`
- **Attack scenario:** a stale device constructs a `SyncAuthorization` with `freshnessRequired` omitted or false. If freshness is requested, it supplies field-valid `freshnessEvidence` for active members. `RuntimeSyncController.authorize()` records that evidence directly even though it did not arrive as an authenticated peer frame.
- **Why current protection fails:** `configureDeviceTrustFreshness()` has no production caller. `DeviceTrustEnforcer` checks all-member freshness only when configuration was manually supplied. The authorization schema makes freshness and membership optional, and evidence authenticity is represented only by ordinary object fields.
- **Impact:** an offline device with a stale local lifecycle snapshot can continue messaging, calling, attachment access, or synchronization without proving that it has observed the current distributed trust state. Revocation may not take effect at every device boundary.
- **Recommended fix:** make freshness mandatory and automatically configured for every multi-device account; accept peer evidence only as an opaque capability emitted by authenticated-session receive code; remove caller control over whether freshness is required; fail closed whenever active-member evidence is incomplete.

### F-02 — Critical — Sync PREPARED/READY admission can be forged locally

- **Component:** synchronization admission and fencing
- **Location:** `service/src/sync/runtime.ts:60-66`
- **Attack scenario:** a caller enumerates the member IDs from an authorization and invokes public `recordPrepared(deviceId)` and `recordReady(deviceId)` methods for every member. It then calls `begin()` without any authenticated peer acknowledgement.
- **Why current protection fails:** the admission methods accept strings and do not consume authenticated frames, proof capabilities, attempt IDs, or persisted peer acknowledgements.
- **Impact:** unanimous admission/fencing can be bypassed. A stale or malicious device can start a transfer while peers have not agreed to the checkpoint or conflict state.
- **Recommended fix:** replace the public string setters with authenticated admission-frame consumption bound to the CryptoSession, sender device, transfer/attempt ID, epoch, commitment, and replay claim. Persist the claims atomically with admission state.

### F-03 — Critical — Group membership digest is not sender authentication

- **Component:** group membership protocol
- **Location:** `service/src/groups/protocol.ts:17-31`, `service/src/groups/state.ts:6-20`
- **Attack scenario:** a malicious participant creates an add, activate, or remove event, sets `actorDeviceId` to an active administrator, and recomputes the public SHA-256 digest.
- **Why current protection fails:** the digest proves only that fields were not changed after hashing. `GroupMembershipProtocol.validate()` does not derive the actor from a CryptoSession or other authenticated receive context. `GroupStateService` likewise accepts caller-provided authorization and snapshots.
- **Impact:** if exposed through a runtime transport, the attacker can add or activate unauthorized devices or remove members while impersonating an administrator.
- **Recommended fix:** bind each group-control event to the authenticated sender identity and current group/account scope. Treat the digest only as a canonical content identifier, not authorization. Make unauthenticated event construction unreachable from the mutation API.

### F-04 — Critical — Group-call admission trusts caller-supplied membership snapshots

- **Component:** group calls
- **Location:** `service/src/groups/callBoundary.ts:3-13`
- **Attack scenario:** an attacker passes a fabricated snapshot that lists its device as active, or restarts the process and presents an old snapshot after removal.
- **Why current protection fails:** `authorizeParticipant()` accepts the snapshot from its caller and checks no authenticated session identity, persisted group commitment, or durable freshness proof. Its epoch and participant state are process-local.
- **Impact:** an unauthorized or removed participant can be admitted to a group media-key boundary and may regain access after restart.
- **Recommended fix:** load authenticated, persisted group state internally; bind the participant to the signaling CryptoSession; require current transcript commitment and durable epoch/freshness; never accept a security snapshot from an untrusted caller.

### F-05 — High — Authenticated device context capabilities can be self-issued

- **Component:** lifecycle authorization boundary
- **Location:** `service/src/devices/authenticatedContext.ts:5-28`, `service/src/crypto/modernConversation.ts:552-556`
- **Attack scenario:** application code with a ready encrypted CryptoSession constructs `DeviceContextAuthority` with arbitrary `verified: true` identity fields matching another active device, then obtains a WeakMap-recognized local context.
- **Why current protection fails:** the authority constructor is public and trusts identity inputs from its caller. The WeakMap proves only that some authority instance issued the context, not that the authoritative runtime composition derived the identity from the remote session.
- **Impact:** code executing in the application process can forge lifecycle authorship and attempt enrollment or revocation as another active device.
- **Recommended fix:** make authority creation private to a single composition root; derive local and remote identities from a verified session/contact registry; issue separate opaque local/remote capabilities; prevent arbitrary callers from asserting `verified` identities.

### F-06 — High — End-to-end device joining is not connected to incoming runtime control

- **Component:** account/device enrollment
- **Location:** `service/src/crypto/modernConversation.ts:268-293,559-589`
- **Attack scenario:** the approver sends an `enrollment-approval`, confirmation, rejection, or revocation, but the receiving runtime handles only `trust-state` and `enrollment-request`. The account-member confirmation method operates on the current conversation context and accepts target storage/persistence directly from its caller.
- **Why current protection fails:** there is no incoming target-side ceremony for approval, confirmation, rejection, or revocation. The code comment explicitly leaves this fail-closed. Tests construct lifecycle services and contexts directly instead of exercising two independent runtimes.
- **Impact:** the documented secure join lifecycle cannot complete end to end. This is currently fail-closed rather than an enrollment bypass, but the Phase 6 closure claim is false and future glue code is likely to become an unsafe authority shortcut.
- **Recommended fix:** process every control type through `DeviceContextAuthority.receive()` on the target device; use independent target storage and keys owned by that runtime; add a two-device encrypted transport test covering request, approval, target confirmation, list update, restart, and rejection.

### F-07 — High — Sync completion acknowledges staging, not application-state import

- **Component:** synchronized record import
- **Location:** `service/src/sync/runtime.ts:74-97,118-124`, `service/src/sync/persistence.ts:73-88`
- **Attack scenario:** a peer sends valid records. The receiver atomically appends them to a `sync-runtime` aggregate and can complete/acknowledge the transfer, but no runtime adapter applies them to conversation, contact, settings, or lifecycle stores.
- **Why current protection fails:** `importRecords()` validates and stores generic records only. Repository reference tracing found no transactional product-store importer. Device records are therefore staged but not applied through lifecycle authority.
- **Impact:** the sender can believe import succeeded while application state did not change. Security-sensitive device state can diverge from the staged sync aggregate, producing inconsistent enforcement after restart.
- **Recommended fix:** introduce product-specific import adapters with object permission checks and atomic feature-store commits; route device records through lifecycle authorization; emit an acknowledgement only after the actual destination stores and replay/checkpoint state commit together.

### F-08 — High — Valid encrypted sync state can be rolled back as a unit

- **Component:** sync persistence and replay protection
- **Location:** `service/src/sync/persistence.ts:22-38,46-89`
- **Attack scenario:** an attacker or faulty storage layer restores an older, internally valid encrypted `sync-runtime` record. The older record contains an old checkpoint and omits newer replay claims and imported records.
- **Why current protection fails:** checkpoint, replay claims, revision, progress, and records live in one CAS object. CAS prevents concurrent stale writers but cannot detect replacement of the entire object with a previously valid version. Internal consistency validation accepts the rollback.
- **Impact:** previously consumed packages can be accepted after restart and completed imports can disappear from the sync ledger.
- **Recommended fix:** anchor a monotonic high-water commitment in rollback-resistant platform storage or a transparency/fencing service; verify the aggregate against that anchor on every load; document the storage trust requirement and test restoration of an old but valid ciphertext record.

### F-09 — High — Native storage lock targets a different adapter instance

- **Component:** platform secure storage
- **Location:** `service/src/platform/nativeBoundary.ts:10-22`
- **Attack scenario:** the application opens a secure store, then locks on suspend. `lock()` calls `provider.open()` again and locks the newly returned adapter, while the store continues using the original adapter.
- **Why current protection fails:** `NativeSecureStorageBoundary.open()` discards the adapter reference and returns only `IsolatedSecureStore`; the composed lock function opens another adapter.
- **Impact:** existing application references may continue reading protected records after the UI reports the store locked.
- **Recommended fix:** retain and lock the exact adapter used by `IsolatedSecureStore`; add a test proving reads and writes fail through all previously issued handles after lock.

### F-10 — High — WebRTC peer construction starts microphone acquisition

- **Component:** privacy controls / call media
- **Location:** `service/src/webrtc/peer.ts:79-80,87-105,148`
- **Attack scenario:** application code constructs a `Peer` while rendering or preparing a call, before the user presses accept/start. The constructor immediately invokes `addLocalAudioTracks()`, which reaches `getUserMedia`.
- **Why current protection fails:** `BrowserCaptureController` enforces foreground/cancellation but receives no explicit user-action capability. The separate permission policy is not used at this constructor boundary.
- **Impact:** an unexpected permission prompt or microphone activation can occur without explicit user action, contradicting the privacy model.
- **Recommended fix:** remove media acquisition from the constructor; require a one-shot explicit-user-action capability from the permission controller and pass an already-authorized stream into negotiation; test that constructing and receiving signaling never invokes `getUserMedia`.

### F-11 — High — Group key update and membership persistence are not proven atomic

- **Component:** group state/key lifecycle
- **Location:** `service/src/groups/state.ts:17-32`, `service/src/groups/contracts.ts:11`
- **Attack scenario:** key rotation succeeds inside the callback but the later compare-and-swap fails or the process crashes. Conversely, an adapter may persist membership without durably committing the key transition.
- **Why current protection fails:** atomicity is represented by an interface that accepts a side-effecting asynchronous callback. No production transaction/outbox implementation was found. Membership changes also copy the old `transcriptCommitment` instead of deriving a new one from the new epoch and members.
- **Impact:** membership state and media/message keys can diverge; a removed member may retain a future key or active members may lose access. Old transcript commitments weaken replay/fork detection.
- **Recommended fix:** define a recoverable two-phase or transactional key-transition record; derive and persist a new canonical transcript commitment for every mutation; add crash/concurrency tests against a durable adapter.

### F-12 — Medium — Recovery replay claim is committed before archive verification

- **Component:** recovery ceremony
- **Location:** `service/src/recovery/ceremony.ts:10-16`
- **Attack scenario:** an attacker submits corrupted material using a known archive ID. `claim()` succeeds, verification fails, and a later legitimate recovery is rejected as replay. A crash between claim and stage has the same effect.
- **Why current protection fails:** claim, verification outcome, and staged replacement are not one recoverable transaction and there is no provisional-claim rollback/idempotency state.
- **Impact:** permanent denial of recovery for a valid archive.
- **Recommended fix:** use an atomic recovery transaction with provisional/verified/committed states and idempotent retries; release or safely expire an unverified claim.

### F-13 — Medium — Failed recovery rotation leaves secret buffers uncleared

- **Component:** recovery archive rotation
- **Location:** `service/src/recovery/archive.ts:61-64`
- **Attack scenario:** archive decryption throws before entering the `try/finally` block.
- **Why current protection fails:** `cryptoProfile.open()` executes before the `try`, so `oldSecret` and `newSecret` are not zeroed on that failure path.
- **Impact:** recovery material remains in JavaScript heap memory longer than intended.
- **Recommended fix:** wrap decryption and encryption in a single outer `try/finally`; keep plaintext optional and zero it conditionally.

### F-14 — Medium — Attachment production authorization remains a factory, not a mounted runtime path

- **Component:** attachment API composition
- **Location:** repository references to `createAttachmentRouter` are limited to its definition and tests; the service application bootstrap does not mount it with a real session authenticator.
- **Attack scenario:** deployment assumes the documented attachment gateway exists and is device-trust aware, while production has no verified authenticator/composition path.
- **Why current protection fails:** route-level security is not connected to application bootstrap. Existing tests supply controlled contexts directly.
- **Impact:** currently this fails closed through route absence, but Phase 6 attachment/trust integration is not deployment-ready and unsafe ad-hoc mounting is a foreseeable risk.
- **Recommended fix:** compose the router only with the real authenticated-session verifier and `DeviceTrustEnforcer`; add a bootstrap test proving no route can be mounted with a raw context provider.

### F-15 — Medium — Security tests overuse self-issued contexts and permissive adapters

- **Component:** validation quality
- **Location:** `service/src/groups/securityBoundary.test.ts`, device join/lifecycle tests, sync tests, and platform tests
- **Attack scenario:** tests pass while the production receive path is absent or caller-controlled because the test itself constructs both sides' authorities, snapshots, acknowledgements, or no-op key adapters.
- **Why current protection fails:** several tests validate isolated class behavior rather than proving that data originated at the encrypted receive boundary. There is no negative browser test for microphone access on peer construction and no native-store lock test against an existing handle.
- **Impact:** green suites overstate runtime security and fail to detect the critical composition defects above.
- **Recommended fix:** add two-device tests with independent vaults and authenticated sessions; make attack tests cross process/restart boundaries; use durable fault-injection adapters; assert forbidden calls such as `getUserMedia` and raw membership mutation are unreachable.

## Attack-area conclusions

| Area | Result | Evidence summary |
|---|---|---|
| Device identity and trust | Failed | Local lifecycle validation is substantial, but distributed freshness is optional/caller-created and context authority is self-issuable. |
| Cryptographic boundaries | Failed | Core CryptoSession use remains intact; group and some device/sync decisions are not exclusively derived from its authenticated receive path. |
| Multi-device synchronization | Failed | Encrypted frames and CAS persistence exist, but admission can be forged, rollback is not externally anchored, and application imports are incomplete. |
| Persistence and recovery | Failed | CAS protects concurrency, not whole-record rollback; recovery claims can be stranded before validation. |
| Recovery system | Failed | No server escrow was found, but denial-of-recovery and secret-zeroization defects remain. |
| Group security | Failed | Membership digest is forgeable as authority and transcript/key-state atomicity is not proven. |
| Group calls | Failed | Caller-provided snapshots can authorize participants and state is not durable/authenticated. |
| Privacy controls | Failed | WebRTC peer construction can request microphone access without explicit user action. |
| Code reality | Failed | Device join and product record import are incomplete runtime paths; tests frequently bypass the real composition boundary. |

## Positive controls verified

- Device-list commitments are recomputed on lifecycle reads, and same-epoch commitment conflicts are rejected in the reviewed lifecycle persistence path.
- The sync relay carries encrypted envelopes and preserves the existing message/mailbox payload limits rather than broadening them.
- Sync persistence uses compare-and-swap for concurrent writers and couples received-sequence claims with its aggregate update.
- Revoked/local-identity checks exist at messaging and authenticated call composition entry points.
- Recovery archives are encrypted client-side and no server-held recovery key or hidden administrator recovery path was found.
- Analytics defaults remain disabled, and the dedicated permission policy rejects background capture when callers actually use it.

These controls are useful but do not compensate for unauthenticated authority inputs or missing runtime composition.

## Validation results

Validation was run against the audited working tree without changing production code.

| Check | Result |
|---|---|
| Jest full suite | **Passed:** 78 suites and 381 tests; one Mongo-backed suite/test skipped because its external database configuration was unavailable. The first sandboxed run was blocked from opening an ephemeral local socket (`EPERM`); the same suite passed when rerun with local test-server permission. |
| ESLint | **Passed.** |
| Client TypeScript and production build | **Passed:** 193 modules transformed. |
| Service SDK build | **Failed during declaration generation.** WebCrypto `BufferSource` incompatibilities occur in `devices/canonicalEncoding.ts`, `devices/lifecycle.ts`, `groups/protocol.ts`, `recovery/archive.ts`, and `sync/codec.ts`. The JavaScript bundle was emitted before declaration generation failed. |
| `npm audit` | **Passed:** zero reported vulnerabilities. |
| `git diff --check` | **Passed.** |

The passing unit suite does not exercise the production composition gaps described above. In particular, `sync/runtimeSession.ts` and `platform/nativeBoundary.ts` showed no execution coverage, while group-state tests rely on caller-created snapshots and permissive adapters.

## Required closure order

1. Close F-01 through F-05 before any Phase 6 security-ready claim; they are authority and admission bypasses.
2. Connect real two-device enrollment and real transactional record import (F-06/F-07).
3. Add rollback anchoring and correct storage locking/media permission behavior (F-08 through F-10).
4. Complete authenticated group state/call composition and crash-safe key transitions (F-03/F-04/F-11).
5. Repair recovery transaction/zeroization issues and replace permissive tests with end-to-end adversarial coverage.

## Final readiness statement

The Phase 6 architecture contains several strong local primitives, but its complete security lifecycle is not yet enforced by the actual runtime. Because distributed trust, synchronization admission, group authorization, and group calls can rely on caller-constructed security inputs, and because microphone capture can begin without explicit user action, the only defensible verdict is:

**PHASE 6 SECURITY NOT READY**
