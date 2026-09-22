# K3NCRYPT Phase 6 Final Security Verification

**Verification date:** 2026-09-22

**Repository revision:** `236946c61d9d5b3a728a9b2aa033765f05bc2fd9` plus the uncommitted Phase 6 closure working tree present at verification time

**Final verdict:** **PHASE 6 SECURITY NOT READY**

## Verification basis

This assessment reviewed the actual working tree rather than the Phase 6 reports. It traced production composition from the React client and server entry points into the device, sync, recovery, group, persistence, and privacy implementations. Interfaces and unit-test adapters were not counted as deployed enforcement.

The closure work materially improved the code. The real encrypted vault now supports atomic compare-and-swap, device lifecycle state and high-water data commit together, missing lifecycle state fails closed, machine-safe identity record IDs are used, duplicate public device identities are rejected, device-control framing round-trips, sync has a dedicated relay and strict codec, exported Olm sessions persist ratchet mutations through the runtime, and browser capture is released on errors, page hiding, and component teardown.

Those improvements do not close the implementation gaps below.

**Finding count:** 0 Critical, 7 High, 2 Medium, 1 Low.

## Findings

### FSV-01 — High — The product has no executable target-device enrollment ceremony

**Location:** `service/src/crypto/modernConversation.ts:257-292`, `service/src/crypto/modernConversation.ts:559-589`, `service/src/devices/join.ts:20-37`, `client/src/context/ChatContext.tsx:150-171`

The normal frontend can request and approve an enrollment, but it never handles an incoming `enrollment-approval`, never invokes target-side confirmation, and never installs the approved account binding on the target device. `handleDeviceControl()` handles only `trust-state` and `enrollment-request` messages. The exported `confirmDeviceEnrollmentAsAccountMember()` method is not called anywhere and constructs its target context from the current `ModernConversation`, while the target device initially owns a different locally generated account scope. Its required `targetStorage` and `targetPersistence` are also not supplied by any product composition.

Device-control traffic uses the existing two-party contact conversation. It is routed to the chat contact, not to a separately addressed device owned by the same account. The UI therefore cannot complete authenticated Android/laptop/PC joining with independent device keys.

**Attack consequence:** the claimed account/device trust graph cannot be established through the application. Operators may be tempted to copy a vault or identity to add a device, which defeats independent device identity and makes per-device revocation misleading.

### FSV-02 — High — Revocation freshness is optional, unconfigured, and has no state convergence path

**Location:** `service/src/crypto/modernConversation.ts:251-255`, `service/src/crypto/modernConversation.ts:301-317`, `service/src/crypto/modernConversation.ts:559-604`, `service/src/devices/trust.ts`, `service/src/devices/freshness.ts`

`configureDeviceTrustFreshness()` is the only method that enables all-member freshness checks, and no production caller invokes it. Normal protected operations consequently validate the local persisted list but require no fresh evidence from the other active devices. A future-epoch trust event now persists a suspension, which is a sound fail-closed improvement, but an offline revoked device that never receives that event has no authoritative state fetch before it resumes. There is no device-state synchronization or recovery path that installs a newer verified list after suspension.

Revocation and trust-state messages are sent through the current contact session. As noted in FSV-01, this is not a transport to the user's other devices. Incoming `revocation` messages are ignored by the runtime handler.

**Attack consequence:** a revoked device returning with an old local snapshot remains trusted until it happens to receive newer authenticated evidence. Revocation is not enforced across the user's devices, and stale trust can authorize messaging, calls, attachments, or sync creation on that device.

### FSV-03 — High — Sync is not wired into the product and imported records never reach application stores

**Location:** `service/src/crypto/modernConversation.ts:409-456`, `service/src/sync/runtime.ts:68-113`, `service/src/sync/persistence.ts:7-90`, `service/src/sync/stateRecords.ts:14-17`, `client/src/context/ChatContext.tsx`

The service contains a dedicated authenticated sync relay, a strict package decoder, a single-use authenticated-frame capability, durable replay claims, encrypted CAS persistence, and atomic storage of received `SyncRecord` objects. However, the frontend never calls `authorizeSync()`, `createSyncController()`, or `createAuthenticatedSyncTransport()`. There is no product orchestration for authorization, prepare/ready, transfer, completion, retry, or reconciliation.

Received records are appended to the private `sync-runtime` record. No implementation applies conversation records to `ConversationModeStore`, contact records to `ContactIdentityRegistry`, device records to the authoritative lifecycle store, or settings records to preferences. The public `SyncRecordStore` interface is not implemented or used by this path.

**Attack consequence:** multi-device synchronization is not an operational feature. Even a cryptographically valid transfer cannot update the user's real account state. The absence of a real import boundary also means unauthorized-import resistance has only been shown for an isolated encrypted staging record, not for the application state it claims to synchronize.

### FSV-04 — Medium — A sync transfer can be declared complete after one arbitrary package

**Location:** `service/src/sync/transfer.ts:24-38`, `service/src/sync/runtime.ts:95-96`

Strict transport and replay validation are present, but completion requires only `received.size > 0`. There is no authenticated manifest declaring the expected record set, chunk count, final sequence, or content root. Package purpose is parsed but does not control completion semantics. Prepared and ready member evidence is also recorded through local method calls rather than authenticated peer acknowledgements.

**Attack consequence:** once product wiring exists, an interrupted or malicious authenticated source can cause an incomplete transfer to be marked `completed`. Durable state can therefore report success without proving that all authorized records arrived.

### FSV-05 — High — RecoveryRuntime is an exported framework, not a production recovery path

**Location:** `service/src/recovery/runtime.ts`, `service/src/recovery/contracts.ts`, `service/src/recovery/replacement.ts`, `service/src/sdk.ts:643-644`, `client/src`

`RecoveryRuntime` now composes concrete AES-GCM/PBKDF2 archive cryptography with authority, ceremony, and replacement interfaces. No production code instantiates it. There is no recovery persistence implementation, authenticated recovery authority, trust-replacement implementation, UI, file flow, or connection to the current identity/device lifecycle. Repository search finds the runtime only in its source, exports, documentation, and tests.

The tests supply in-memory replay sets and trust callbacks that simply return a new scope and invalidated-device list. They do not demonstrate actual replacement of the local identity, durable invalidation of old devices, or contact-trust reset in the application.

**Attack consequence:** fake recovery, replay, and unauthorized replacement are rejected inside the isolated class only to the extent that an injected adapter does so. Phase 6 has no deployable recovery mechanism whose authorization and invalidation behavior can be verified.

### FSV-06 — High — Recovery replay consumption and identity replacement are not atomic

**Location:** `service/src/recovery/ceremony.ts:10-19`, `service/src/recovery/runtime.ts:36-41`, `service/src/recovery/replacement.ts:5-11`

The ceremony claims an archive ID before verifying the archive secret or staging the request. The persistence contract has no abort/release operation, so a wrong secret, corrupt archive, crash, or staging failure can permanently consume recovery material. On confirmation, identity replacement and contact-trust reset happen before `persistence.complete()`. These operations have no shared transaction or recovery marker.

**Attack consequence:** an authorized but invalid recovery attempt can deny later legitimate recovery. A crash or persistence failure after identity replacement can leave the new identity active while the ceremony remains incomplete and replayable state disagrees with trust state.

### FSV-07 — High — GroupSecurityRuntime is not wired and has no production state or key implementation

**Location:** `service/src/groups/runtime.ts`, `service/src/groups/state.ts`, `service/src/groups/contracts.ts`, `service/src/sdk.ts:643-644`, `client/src`

The group runtime is exported and unit-tested with an in-memory snapshot and no-op key adapter. No application or backend code instantiates it. There is no production `GroupRuntimePersistence`, group key-management adapter, group message encryption, group call media key implementation, or UI path.

The `endpointEncrypted` property on the group call boundary is a type-level constant; it is not media encryption. Removed-member future-message exclusion depends entirely on the missing key adapter.

**Attack consequence:** group membership authorization, removed-member exclusion, epoch fencing, replay resistance, and key rotation are not deployed security properties. They cannot support a Phase 6 readiness claim.

### FSV-08 — Medium — Group transcript and key/state atomicity are not established

**Location:** `service/src/groups/protocol.ts:25-36`, `service/src/groups/state.ts:17-32`, `service/src/groups/runtime.test.ts`

Membership updates increment the epoch but retain the old `transcriptCommitment`; no code derives a new commitment from the authorized event or resulting membership. The event digest is an unkeyed SHA-256 consistency value, with authorship supplied by the surrounding issued context. Replay tracking is process-local. The persistence API promises `compareAndSwapWithKeyUpdate`, but no production implementation exists. The test adapter executes key rotation first and then performs CAS, so it does not demonstrate atomicity and can rotate keys even if a later state commit fails.

**Attack consequence:** stale epochs are rejected by the isolated runtime, but the advertised transcript commitment does not commit to transcript evolution, and crash-safe coupling of membership state to key rotation is unverified.

### FSV-09 — High — A room capability can replace another participant's prekey identity and claim its routing ID

**Location:** `backend/api/chatHash/prekeys.ts:74-83`, `backend/socket.io/listeners.ts:75-110`

Prekey renewal authenticates only the room-wide control capability. It does not require proof from the address's existing identity and allows replacement with an unrelated identity bundle. Socket join accepts any caller-supplied routing `userID` authorized by the same room capability. Both legitimate participants know that capability.

**Attack scenario:** a malicious participant renews the other participant's published address with attacker keys, disconnects or races that participant, then joins using the victim routing ID. A new peer fetching the address establishes its first Olm session to attacker-controlled key material and routes ciphertext to the attacker.

**Impact:** first-contact identity substitution can give a malicious room participant plaintext access despite the no-server-plaintext/no-unauthorized-device goals. Pinned identity-change detection protects already observed identities but does not authenticate the first bundle or prove ownership during renewal.

### FSV-10 — Low — The vault tamper test is probabilistic

**Location:** `service/src/storage/secureVault.test.ts:81-92`

The test changes the final base64url character to `A`. If that character is already `A`, or if only unused trailing base64 bits change, the decoded ciphertext is unchanged. During the initial sandboxed full run this assertion resolved successfully instead of rejecting; the isolated run and the unrestricted full run passed with different randomized ciphertext.

**Impact:** the production AES-GCM path did reject actual byte modifications in passing runs, but this test can produce a false failure or fail to exercise tampering. It should not be treated as deterministic evidence by a release gate.

## Privacy verification

No verified privacy finding was identified in the current application capture paths.

- Voice recording begins only from the microphone button handler.
- `BrowserCaptureController` rejects hidden-page requests, serializes pending capture, stops late streams, and releases on visibility loss.
- The chat footer releases capture on recorder errors, Escape, page hiding, and component teardown.
- Call media and WebRTC paths use the same capture boundary; relay-only ICE policy is forwarded to `RTCPeerConnection`.
- Camera capture was found only behind explicit call-media request methods.
- Analytics and background capture defaults are false, and no analytics or beacon sender was found in the client/service source.
- File access uses an explicit hidden file input triggered by the attachment button; no broad filesystem collection path was found.

These findings concern the repository application. A malicious replacement web bundle could still invoke browser APIs after browser permission; client-side policy code cannot defend against a hostile application publisher.

## Test results

- `npm test -- --runInBand`: **80 suites passed, 387 tests passed, one MongoDB integration suite/test skipped**. Local-server access was required because the sandbox blocks Supertest listening sockets.
- `npm run client:build`: **passed**; TypeScript and Vite production build completed.
- `npx playwright test`: **18 Chromium/WebKit tests passed**. Firefox did not reach application execution: six cases timed out during browser launch after macOS reported `sandbox_extension_issue_file_to_process ... Operation not permitted`; two were interrupted and one did not run when the stalled run was terminated. Firefox coverage is therefore incomplete, with no Firefox application assertion failure observed.
- Targeted `service/src/storage/secureVault.test.ts`: **11 tests passed** in isolation. The earlier full sandboxed run exposed the probabilistic tamper-test behavior described in FSV-10 before aborting on blocked server binding.
- Rust/WASM tests were not run because `cargo` is not installed in this environment.

The passing unit suite verifies several strong isolated boundaries. It does not compensate for missing production composition, adapters, or end-to-end multi-device/recovery/group behavior.

## Final decision

Phase 6 cannot be considered complete while authenticated device joining and distributed revocation are non-operational, sync records do not reach application state, recovery and group runtimes have no production composition, and room-capability holders can substitute first-contact identity material.

**PHASE 6 SECURITY NOT READY**
