# K3NCRYPT Phase 6 adversarial security audit

**Verdict: PHASE 6 SECURITY NOT READY**

Audit date: 2026-09-21. Source revision: `e9e36adba5f55a5920c1842541123813e30a533b`.

This review found reproducible authorization, persistence, transport, and privacy defects, plus missing production implementations. Passing unit tests do not establish Phase 6 readiness. The modern application currently fails before normal operation with the real vault. Fixing that availability defect will expose the other defects; it does not make their boundaries safe.

No production code was changed. Temporary adversarial tests were used against the actual exported implementations. Where a test supplied in-memory persistence or a fake crypto session, it tested the surrounding authorization/serialization boundary, **not** the strength of Olm or an ability to forge Olm ciphertext. Findings distinguish reachable application defects, integration defects, and latent weaknesses in currently unwired APIs. No remote code execution or arbitrary access to another browser's JavaScript is assumed.

## Scope and evidence

Reviewed the device identity/list/lifecycle/trust code; modern conversation composition; authenticated sync, admission, fences, checkpoints and persistence contracts; recovery; group membership and call boundaries; browser and platform storage; call/media capture; frontend entry points; prekey and socket routing authorization; and their tests. Documentation was used only to identify claims to verify, not as evidence of enforcement.

The repository contains real AES-GCM vault encryption, Argon2id derivation, domain-separated HKDF subkeys, and a Vodozemac/Olm integration. Those primitives do not authenticate a caller-supplied lifecycle object, implement distributed revocation, or provide missing transactions. No explicit administrator decryption key or server recovery escrow implementation was found in the reviewed code. That is not a guarantee against a malicious web application host: the host supplies executable client code and initial public-key material.

Severity uses impact plus prerequisite access. **High** findings block privacy-sensitive deployment or the claimed security feature. **Medium** findings are bounded denial of service, missing platform enforcement, or defense weaknesses. Not every High finding is an unauthenticated network exploit.

## Findings

### F01 — Real identity fingerprints are invalid vault record identifiers

- **Severity:** High — reproducible application availability/integration failure.
- **Component:** Identity, lifecycle persistence, modern frontend.
- **File/location:** `service/src/identity/vodozemacIdentity.ts:53-60`; `service/src/storage/secureVault.ts` (`validLabel`, `validateRecordAddress`); `service/src/crypto/modernConversation.ts:187-194`; `client/src/context/ChatContext.tsx:80-96`.
- **Attack scenario:** No attacker is needed. Create a modern private contact using the real browser vault. Its fingerprint starts with `K3 ` and contains spaces; lifecycle initialization uses it directly as the record ID.
- **Why existing protection fails:** Vault labels allow only `[A-Za-z0-9._:-]`. The lifecycle read throws before the session/transport setup completes. Modern conversation unit tests replace storage with a permissive map and hide this incompatibility.
- **Impact:** Modern private contacts and all dependent Phase 6 runtime controls are unavailable. Browser tests fail at creation rather than demonstrating secure restart behavior.
- **Recommended fix:** Separate canonical machine identity IDs from display fingerprints. Use a stable canonical encoding for record addresses and migrate existing records explicitly. Test the complete conversation with `BrowserSecureStorage` and IndexedDB.
- **Evidence:** The temporary probe computes a real fingerprint, initializes a real encrypted vault, and observes `Invalid secure-record type or identifier` on lifecycle read. Chromium and WebKit modern-conversation tests also fail while waiting for the invitation link; their page snapshots show the generic contact-creation failure.

### F02 — Device-control messages cannot round-trip

- **Severity:** High — reproducible runtime protocol failure.
- **Component:** Authenticated device-control transport.
- **File/location:** `service/src/devices/runtime.ts:19-28,112-120`.
- **Attack scenario:** Send an enrollment or revocation through `AuthenticatedDeviceControlChannel`, then deliver its decrypted payload to the receiver.
- **Why existing protection fails:** `bytes()` JSON-stringifies its input. `send()` passes an already framed string, so plaintext begins with a JSON quote, while `parse()` requires the literal `k3ncrypt-device-control-v1:` prefix at byte zero.
- **Impact:** Correctly encrypted control messages decode to `undefined`. Enrollment and trust/revocation propagation cannot work.
- **Recommended fix:** Use one canonical framing codec on both directions. Add a test that receives the exact envelope produced by `send()`.
- **Evidence:** A send/receive round-trip returned `undefined`. The existing `devices/runtime.test.ts` sends one envelope but calls receive on a different, unrelated envelope.

### F03 — Enrollment has no working target-side runtime ceremony or shared account scope

- **Severity:** High — incomplete implementation.
- **Component:** Multi-device enrollment and identity model.
- **File/location:** `service/src/crypto/modernConversation.ts:187-219,243-270,486-512`; `service/src/devices/lifecycle.ts:215-272`; `backend/socket.io/listeners.ts` (`chat-join`).
- **Attack scenario:** Enroll an independently keyed Android device from a laptop, then ask the Android device to confirm and become active.
- **Why existing protection fails:** Each runtime uses its own device fingerprint as `userScope`, creates its own epoch-zero active list, and uses a conversation routing address as device ID. Incoming approvals/revocations are not applied by `handleDeviceControl`. Confirmation requires current local trust before the target can become active. Lifecycle composition occurs before establishing a fresh outbound session and is not initialized when the inbound session is first established. The relay itself admits only two room participants.
- **Impact:** There is no demonstrated account-wide Android/laptop/PC device graph, enrollment handshake, or independent-key confirmation path. Sharing a vault/account to get around this would clone identity rather than implement independent devices. A new conversation routing address can also disagree with the existing identity-scoped list.
- **Recommended fix:** Define a stable account scope distinct from per-device keys and per-conversation addresses. Implement authenticated target possession challenges, a narrowly scoped pending-device transport, all receive-side transitions, and multi-device routing. Compose lifecycle services when sessions become ready.

### F04 — Future revocation is rejected without suspending stale trust; retries bypass trust checks

- **Severity:** High — reproducible stale-trust behavior plus runtime bypass.
- **Component:** Revocation, synchronization, message delivery and calls.
- **File/location:** `service/src/devices/trust.ts:67-88`; `service/src/crypto/modernConversation.ts:318-331,492-532`; `service/src/calls/composition.ts` (inbound signal callback).
- **Attack scenario:** Revoke an offline PC from another device. The PC returns with its older active list and receives a newer trust-state event; alternatively revoke locally while an outbox retry is pending.
- **Why existing protection fails:** The coordinator rejects future events; the handler catches and drops the error without marking trust unavailable. Subsequent checks consult the same stale local list. No distributed state refresh or freshness lease exists. `retryPending()` sends previously queued ciphertext without checking device trust. Incoming call processing likewise lacks a device-trust assertion at the composition boundary. The checks generally concern the local device, not a freshly authorized sender device.
- **Impact:** Revocation is not enforced everywhere. Old instances can continue trusting themselves, and queued sends continue after a local trust change. This does not imply recovery of already deleted encryption keys; it means the claimed authorization boundary is absent.
- **Recommended fix:** Treat authenticated evidence of a newer epoch as suspension until the full verified state arrives. Enforce current local and remote device authorization at all sends, retries, receives and call admission. Persist revocation tombstones, refresh offline devices before resuming, and rekey/invalidate affected sessions. Document unavoidable offline freshness limits.
- **Evidence:** A future revocation event throws `unavailable`, followed by `DeviceTrustEnforcer.decision()` returning `trusted` on the same instance. The documentation's claim that such rejection leaves operations unavailable is false for this implementation.

### F05 — Applying lifecycle authorizations does not establish issuer authority

- **Severity:** High — latent authorization-boundary vulnerability; not demonstrated as a currently reachable remote enrollment exploit.
- **Component:** Enrollment/revocation authority.
- **File/location:** `service/src/devices/lifecycle.ts:123-126,236-253,295-317`; `service/src/crypto/modernConversation.ts:201-206,486-489`.
- **Attack scenario:** An adapter passes a claimed verified sender matching an authorization naming an outsider or revoked issuer. The attacker computes the public SHA-256 authorization digest.
- **Why existing protection fails:** `applyEnrollment` and `applyRevocation` do not look up the author and require its current active state. The production verifier compares caller-provided identity fields; it does not verify a signature or bind the exact authorization to authenticated decrypted bytes. A hash detects changes only relative to a trusted hash; anyone can recompute it. Revocation also omits validation of the confirmation's time window. Context booleans are not cryptographic evidence.
- **Impact:** Future receive-side adapters can turn an untrusted input into an authoritative lifecycle change. Current local approval helpers perform stronger issuer checks, but those do not make the apply boundary safe.
- **Recommended fix:** Verify a signature or opaque transport-issued authentication proof over the exact canonical operation; recheck issuer membership, key, scope and active state at commit. Validate version, nonce, sequence and both authorization/confirmation expiration windows. Make authority checks mandatory in the mutation boundary.
- **Evidence:** A probe using the production verifier's exact comparisons accepted an enrollment from an issuer absent from the list. The test supplied context directly; no claim is made that the current UI lets a network caller supply that context.

### F06 — Enrollment confirmation is not bound to the stored approved identity or authorization

- **Severity:** High — reproducible latent confirmation-boundary vulnerability.
- **Component:** Target device proof of possession.
- **File/location:** `service/src/devices/lifecycle.ts:256-272`.
- **Attack scenario:** For a pending target device ID, construct a fresh authorization and confirmation naming an attacker-controlled key, using the public previous commitment and correct epoch.
- **Why existing protection fails:** `confirmEnrollment` does not call the authorization verifier, compare authorization scope to context scope, retrieve the exact committed approval, or compare the stored target's public key to the confirming identity. It checks attacker-computable digests and then activates the stored target entry.
- **Impact:** The approved device can become active without proof from its approved private key. This bypasses the confirmation ceremony; it does not replace the stored key with the attacker's key.
- **Recommended fix:** Persist the exact pending approval digest and target key. Confirm only with authenticated proof from that stored key, bound to account, epoch, nonce, expiration and approval. Consume the confirmation atomically.
- **Evidence:** A probe used a different authorization scope, invented issuer and attacker key; the stored target with a different key became `active`. A verifier configured to throw was never called.

### F07 — Authenticated adapters bypass durable Olm ratchet updates

- **Severity:** High — cryptographic state rollback risk, reproducible persistence bypass.
- **Component:** Calls, sync, device-control crypto composition.
- **File/location:** `service/src/crypto/vodozemacRuntime.ts:59-62` versus its `encrypt`/`decrypt` wrappers; `service/src/devices/runtime.ts:114,118`; `service/src/calls/authenticatedTransport.ts`; `service/src/sync/authenticatedTransport.ts`; modern conversation composition methods.
- **Attack scenario:** Exchange signaling through one of these adapters, crash before a normal runtime operation persists the session, then restore the previously saved ratchet.
- **Why existing protection fails:** `getAuthenticatedSession()` returns the raw `VodozemacCryptoSession`. Its methods mutate protocol state without the runtime mutex, persistence step, or quarantine-on-write-failure. The adapters invoke that raw session directly.
- **Impact:** Restart can reuse prior sender state and lose receive replay/ratchet progress. This undermines replay and cryptographic state safety; exact exploitability of repeated Olm state was not established by a cryptanalytic attack in this audit.
- **Recommended fix:** Return a restricted facade whose encrypt/decrypt go through the durable runtime operations and whose readiness reflects runtime state. Do not expose mutation-capable session handles. Test send/crash/restart and receive/crash/replay using real WASM.
- **Evidence:** The exported session encrypted without a session save; the runtime wrapper saved exactly once for the same operation.

### F08 — Deleting lifecycle state defeats retained rollback evidence

- **Severity:** High — reproducible storage rollback vulnerability.
- **Component:** Lifecycle persistence and bootstrap.
- **File/location:** `service/src/devices/runtime.ts:59-61,79-89`; `service/src/crypto/modernConversation.ts:187-194`.
- **Attack scenario:** A local storage attacker deletes the encrypted lifecycle record while retaining the high-water record and identity. Restart invokes bootstrap. Alternatively restore an entire old vault snapshot.
- **Why existing protection fails:** Missing primary state returns `undefined` before consulting the high-water mark. `initialize()` then overwrites both records with the supplied initial list. A full snapshot rollback also restores both locally stored counters consistently; their hashes are not external freshness anchors.
- **Impact:** Revoked devices can regain local active status and authorization/replay history disappears. This attack requires storage deletion/rollback capability, not knowledge of the vault encryption key.
- **Recommended fix:** Distinguish first initialization from missing/corrupt established state. Never lower or overwrite surviving high-water evidence. Anchor freshness outside the rollbackable record set, using a reviewed authenticated account-state protocol or appropriate platform mechanism.
- **Evidence:** After a committed revocation, deleting only `device-lifecycle:user` and reinitializing changed the revoked device's trust decision to `trusted` despite the previously retained higher high-water record.

### F09 — Security writes are not a durable cross-instance transaction

- **Severity:** High — reproduced partial commit; concurrency/crash consequences established by code review.
- **Component:** Lifecycle and browser storage.
- **File/location:** `service/src/devices/runtime.ts:40-49,79-102`; `service/src/storage/persistence.ts:56-59,84-87,116-119`.
- **Attack scenario:** Crash/fail between lifecycle and high-water writes, or run two JS realms against the same vault and commit different successors of the same epoch. Abort an IndexedDB transaction after a request succeeds.
- **Why existing protection fails:** A static JS mutex only serializes one realm. Reads, state writes, high-water writes and verification are separate operations; initialization is not locked. IndexedDB methods resolve on request success, not transaction completion, and do not reject subsequent transaction aborts.
- **Impact:** A failed operation can leave committed state, stale writers can overwrite successors, and callers can publish security operations believing durability has been achieved when it has not. A two-record mismatch sometimes fails closed, but that is not atomic commit or crash recovery.
- **Recommended fix:** Implement storage transactions with authoritative compare-and-swap and complete/abort handling, spanning state, replay claims, checkpoint and outbox. Use cross-realm serialization in addition to durable CAS; include account/identity initialization in its scope.
- **Evidence:** Injecting failure only on the high-water write caused `commitRevocation` to reject, while a subsequent read returned the new epoch. Existing failure tests reject every write and never exercise this partial-write point.

### F10 — “Authenticated” sync frames can be manufactured without decryption

- **Severity:** High — reproducible API trust-boundary bypass, currently unwired as a network path.
- **Component:** Sync authentication.
- **File/location:** `service/src/sync/authenticatedTransport.ts:12-28`; `service/src/sync/runtime.ts:56-65`.
- **Attack scenario:** An integration submits a plain object or uses the public `AuthenticatedSyncFrame.create()` factory with a fabricated session binding and package.
- **Why existing protection fails:** The factory performs no authentication. The controller only checks two nonempty strings; it never verifies the private brand, issuing transport, expected session, sender/receiver identities or envelope. TypeScript types do not enforce a runtime boundary.
- **Impact:** The controller acknowledges fabricated sync packages without any cryptographic operation. Arbitrary record import is not demonstrated because no production importer exists.
- **Recommended fix:** Keep frame issuance private to authenticated decryption and validate an unforgeable runtime capability tied to the active transport/session and complete identity tuple. Prefer a receive method that itself owns decryption and validation.
- **Evidence:** A plain cast object with no envelope, unrelated frame identity, wrong package identities, and sequence `-1` was accepted. Existing sync tests themselves call the public factory to manufacture authenticated frames.

### F11 — Sync skips strict parsing and does not establish complete transfer/admission evidence

- **Severity:** High — reproducible schema bypass plus incomplete protocol validation.
- **Component:** Sync codec, admission, transfer completion and recovery.
- **File/location:** `service/src/sync/authenticatedTransport.ts:31-38,50-54`; `service/src/sync/codec.ts:24-42`; `service/src/sync/authorization.ts`; `service/src/sync/runtime.ts:16-45,51-70`; `service/src/sync/transfer.ts:18-32`.
- **Attack scenario:** An authenticated compromised peer sends malformed package fields, claims other members are ready, omits the fixed membership set, or terminates a transfer after one arbitrary chunk.
- **Why existing protection fails:** The authenticated transport uses a separate JSON decoder that does not invoke the strict codec. Transfer validation ignores package version/purpose, identity references and positive sequence constraints. Prepared/ready evidence consists of unauthenticated device-ID method calls, and membership evidence is optional. `complete()` needs only one received entry, not a verified manifest, chunk count or final content root. Recovery validates only some durable fields; terminal transfer identity is not enforced on reauthorization. Member/progress sets are not cleared in `authorize()`.
- **Impact:** Invalid packages enter durable progress; readiness can be asserted without members; incomplete transfers can be called complete; old progress can contaminate a new authorization. Hashing received content does not prove it is the authorized content.
- **Recommended fix:** Use one bounded strict decoder for all paths. Bind signed/authenticated authorization and member acknowledgments to a unique transfer, immutable membership snapshot, identities, epoch and commitment. Verify every chunk against an authenticated manifest and persist terminal tombstones. Reset per-transfer state and validate recovery against the authoritative checkpoint.
- **Evidence:** The authenticated transport accepted an object with negative sequence and an unsupported purpose. The controller accepted the same malformed semantics. No large-payload claim is made beyond the actual upstream Olm/relay limits.

### F12 — Durable multi-device synchronization is an interface, not a deployed feature

- **Severity:** High — incomplete production implementation.
- **Component:** Sync persistence, delivery, import and conflict resolution.
- **File/location:** `service/src/sync/contracts.ts`, `stateRecords.ts`, `runtimeSession.ts`, `fencing.ts`; `service/src/crypto/modernConversation.ts:385-404` and signaling dispatch at `111-121`.
- **Attack scenario:** Three devices synchronize, one stays offline, conflicting membership changes occur, and a device crashes mid-import before reconnecting.
- **Why existing protection fails:** No production `SyncPersistence`, `SyncRecordStore`, durable event-delivery adapter, or application instantiation of `RuntimeSyncSession` was found. The normal signal dispatcher handles device controls/calls, not sync. The fence coordinator is not used by the transfer runtime. Sync receipts/progress are not atomic with actual record import, because import is absent.
- **Impact:** Crash-safe synchronization, unsafe-merge prevention and multi-device convergence cannot be claimed. Unit test adapters whose transactions simply invoke a callback do not prove transactional behavior.
- **Recommended fix:** Implement and wire durable adapters and record-level authorization, with atomic claim/import/checkpoint/outbox operations. Connect authenticated conflict/fence handling. Test three isolated processes with partitions, reordered delivery, competing writers and injected crash points.

### F13 — Shared room capability permits another device's routing identity and prekey replacement

- **Severity:** High — reachable backend identity/availability weakness.
- **Component:** Prekey service and socket authentication.
- **File/location:** `backend/api/chatHash/prekeys.ts` (`POST /:address/renew`); `backend/socket.io/listeners.ts` (`chat-join`, offline delivery); `service/src/crypto/modernConversation.ts` (initial prekey fetch and `observe`).
- **Attack scenario:** A compromised participant or leaked room-control capability renews another address with attacker keys, or joins using the other participant's routing ID while a slot is available.
- **Why existing protection fails:** Renewal authenticates only the room capability and does not prove ownership of the address's existing identity. Socket join accepts the supplied `userID` after the same room-wide authorization. The capability is not a per-device proof and is not coupled to lifecycle revocation.
- **Impact:** Key-directory substitution on first contact, offline ciphertext/mailbox theft or disruption, sender-routing impersonation and denial of service. Existing Olm sessions and pinned identity-change checks limit plaintext impersonation: this is not proof that an attacker can decrypt an established pinned session. A malicious server can also substitute first-contact bundles; unverified first-contact messaging therefore does not satisfy an unconditional no-server-plaintext-access threat model.
- **Recommended fix:** Require proof of possession for per-device publication, renewal and socket binding; reject identity-changing renewal except through an explicit authorized replacement protocol. Rotate room capabilities after compromise where applicable. Require independent fingerprint verification, or deploy reviewed key transparency/account authority, before promising protection against malicious directory substitution.
- **Evidence:** The existing test titled “renews ... without changing its identity” actually creates a newly randomized identity and asserts the replacement is returned. Thus this behavior is already exercised by the passing suite.

### F14 — Recovery completion is not connected to authenticated archive ownership or trust replacement

- **Severity:** High — incomplete recovery security boundary, not a demonstrated deployed backdoor.
- **Component:** Recovery archive, ceremony, identity replacement.
- **File/location:** `service/src/recovery/contracts.ts`, `ceremony.ts`, `archive.ts`, `replacement.ts`.
- **Attack scenario:** Stage an archive with an unrelated old fingerprint/new identity context, or call the replacement workflow independently with `userAction=true`.
- **Why existing protection fails:** No production archive cryptography, material verifier, recovery persistence or trust replacement adapter is implemented/wired. Ceremony verification receives archive/secret but not the replacement context; the ceremony itself does not bind that context to archive ownership. `confirmReplacement()` only calls persistence completion. The separate replacement workflow accepts a boolean and context without a completed-ceremony capability; identity replacement and contact-trust reset are separate calls.
- **Impact:** There is no demonstrated secure recovery path or atomic old-device invalidation. An unsafe adapter could turn these APIs into unauthorized identity replacement; stolen recovery material resistance cannot be evaluated without an actual cryptographic profile and policy.
- **Recommended fix:** Define and implement authenticated archive encryption/KDF, manifest binding, ownership policy and storage. Make replacement consume a verified, single-use ceremony result bound to the old account and new key. Atomically invalidate old trust and reset contact state before exposing the new identity.

### F15 — Invalid recovery attempts consume the archive before verification

- **Severity:** Medium — reproducible latent denial of recovery.
- **Component:** Recovery replay handling.
- **File/location:** `service/src/recovery/ceremony.ts:10-17`.
- **Attack scenario:** Submit a known archive ID with a wrong secret before the legitimate attempt.
- **Why existing protection fails:** `claim(archiveId)` precedes verification; failure has no release/abort path in the persistence contract. A permanent replay claim burns the archive. The ceremony also does not call the stricter archive validator itself.
- **Impact:** An adapter with durable one-shot claims can permanently deny valid recovery after a bad attempt or crash, including an innocent password typo.
- **Recommended fix:** Validate bounded syntax first, verify material, then transactionally reserve/stage/consume using recoverable states. Use rate limiting for invalid attempts rather than permanent consumption.
- **Evidence:** The same ceremony rejected the first attempt for an invalid secret and the second for replay, even though no staging succeeded.

### F16 — Group authorization trusts claimed IDs; future-message exclusion has no implementation

- **Severity:** High — reproducible authorization weakness and missing group cryptography.
- **Component:** Group membership, keys and group calls.
- **File/location:** `service/src/groups/membership.ts:3-9`; `state.ts`; `contracts.ts`; `callBoundary.ts:6-13`.
- **Attack scenario:** A removed member submits a change naming an active administrator or supplies an old snapshot showing itself active; then attempts group-call reentry/future messages.
- **Why existing protection fails:** Authorization receives an unproven actor ID and caller-supplied snapshot; it has no authenticated principal, signature, authoritative state read or transcript verification. A non-finite expiry passes the numeric comparison. The group-call boundary accepts any supplied active snapshot and holds no authoritative epoch. `endpointEncrypted=true` is a declaration. Key establishment/rotation, atomic key-state persistence and media encryption remain injected interfaces with no production implementation. Membership commits also carry forward the old transcript commitment.
- **Impact:** These classes do not prove administrator authority, prevent rollback admission, or ensure removed members lose future keys. No deployed group ciphertext attack is claimed because there is no deployed group protocol here.
- **Recommended fix:** Implement a reviewed group protocol and authenticated membership transcript. Derive actors from verified transport/protocol credentials, read authoritative state internally, validate finite timestamps, and atomically advance membership/key/transcript state. Bind media encryption and admission to the current epoch.
- **Evidence:** The membership service authorized a removal using only a claimed administrator ID and `NaN` expiry. Existing group tests use no-op key adapters and successful-CAS stubs.

### F17 — Privacy permission policy does not govern actual microphone capture or cleanup

- **Severity:** High — reachable capture lifecycle/privacy defect.
- **Component:** Voice recording and media permission controls.
- **File/location:** `client/src/components/ChatContainer/ChatFooter.tsx:52-85`; `service/src/privacy/permissions.ts`, `policy.ts`; `service/src/calls/media.ts:8-17`.
- **Attack scenario:** Grant microphone access, start recording, then navigate/unmount or hide the page; alternatively trigger a MediaRecorder construction/start error after `getUserMedia` succeeds. Rapid repeated clicks can start concurrent pending capture requests.
- **Why existing protection fails:** The real footer calls `getUserMedia` directly. The privacy boundary is unused. There is no unmount/visibility cleanup of its recorder/stream; the catch block only resets React state. If construction/start fails, the stream is not stopped. `isRecording` is set only after async capture resolves. The generic call controller also does not enforce foreground/user action or serialize pending capture requests.
- **Impact:** Microphone capture can outlive the intended UI action, continue in the background, or leave orphan tracks. No evidence was found of microphone/camera activation automatically on initial page load; OS permission still applies. Once permission is granted, the application itself does not enforce the claimed foreground-only policy.
- **Recommended fix:** Centralize capture behind the enforced permission boundary, track streams before recorder construction, serialize acquisition, and release tracks on errors, cancellation, unmount, lock, and relevant page lifecycle events. Add browser tests checking track state after each path.

### F18 — Relay-only WebRTC configuration is silently discarded

- **Severity:** High — reproducible privacy configuration failure in the call adapter.
- **Component:** Call media networking.
- **File/location:** `service/src/calls/media.ts:27-28,39-41`; `service/src/calls/webrtc.ts:3`.
- **Attack scenario:** A deployment explicitly requests `iceTransportPolicy:'relay'` to prevent a peer from learning its direct IP. Connect using `BrowserCallTransport`.
- **Why existing protection fails:** `connect()` forwards only `iceServers`; the constructed `RTCPeerConnection` configuration omits the policy.
- **Impact:** The adapter falls back to browser ICE defaults and may expose direct network addresses despite the requested privacy setting. This probe demonstrates the adapter bug, not that every existing legacy call path uses this adapter.
- **Recommended fix:** Forward and validate the complete privacy-critical RTC configuration. Fail closed if relay-only mode cannot obtain relay connectivity. Test the actual peer configuration and candidate types.
- **Evidence:** A peer-factory spy saw `iceTransportPolicy === undefined` when the caller supplied `'relay'`.

### F19 — Platform storage profiles neither implement key isolation nor bind encrypted records to their location

- **Severity:** Medium — incomplete native enforcement and conditional record-substitution risk.
- **Component:** Platform secure storage.
- **File/location:** `service/src/platform/secureStore.ts:3-12`; `service/src/platform/contracts.ts`; `native/create_native_app.sh`, `native/create_native_app_docker.sh`.
- **Attack scenario:** Deploy a native wrapper assuming profile flags establish OS key isolation/backup exclusion. With storage access, move ciphertext from one record to another sharing an encryption adapter/key.
- **Why existing protection fails:** Platform profiles are boolean requirements, not Android/iOS/desktop keystore implementations. `LocalEncryptionAdapter.encrypt/decrypt` accepts no namespace/key/AAD, so `IsolatedSecureStore` cannot require cryptographic binding to its record address. Namespacing storage keys alone does not stop substitution of valid ciphertext. An adapter might independently compensate; no production adapter establishes that here.
- **Impact:** Native backup, deletion, isolation and record-substitution resistance are unproven. The real browser vault does bind type/id with AES-GCM AAD; that protection must not be attributed to the separate platform abstraction.
- **Recommended fix:** Implement and test concrete OS providers. Require authenticated namespace/record/version context in the encryption interface or verify an encrypted self-identifying envelope. Test cross-record swaps, backups, suspend/resume and locked-state behavior.

### F20 — Duplicate public identities can masquerade as independent devices

- **Severity:** Medium — reproducible identity model weakness.
- **Component:** Device identity/list validation.
- **File/location:** `service/src/devices/deviceList.ts:21-27`; `service/src/devices/lifecycle.ts:223-245`.
- **Attack scenario:** Enroll a second device ID using an existing device's public identity, representing a cloned key as an independent endpoint.
- **Why existing protection fails:** The list rejects duplicate device IDs but not duplicate key/identity references; enrollment checks device ID uniqueness only. Algorithm values are arbitrary nonempty strings rather than a supported identity profile.
- **Impact:** UI/device-list independence claims can be false; revoking one device ID does not establish exclusion of another entry with the same private key. This does not alone grant an outside attacker enrollment authority.
- **Recommended fix:** Enforce canonical unique per-device public keys under a supported algorithm profile and a possession challenge. Treat explicit key migration/cloning as a separate security event, not ordinary independent-device enrollment.
- **Evidence:** A list with two different IDs and the same public identity was accepted.

## Three-device adversarial assessment

| Scenario | Actual result / missing enforcement |
| --- | --- |
| Android, laptop and PC have independent keys | No shared account scope or completed target enrollment path (F03); duplicate keys accepted (F20). |
| PC compromised | Shared room capability permits directory/routing abuse (F13); revocation does not revoke that capability or establish distributed key exclusion (F04). An active device can also approve/revoke other devices under the implemented authority model; no independent account-owner factor or quorum is enforced. |
| PC offline when revoked | No fresh authenticated state fetch before resumption; future event is dropped while old local state remains trusted (F04). |
| Concurrent laptop/Android changes | Local mutex is not cross-instance CAS (F09); sync fences are not connected to import/admission (F12). |
| PC returns with old backup | Local lifecycle/high-water can both be rolled back; deleting just the lifecycle record triggers bootstrap (F08). |
| Crash during sync/recovery | Durable adapters, atomic import and recovery replacement are absent (F12/F14); partial lifecycle write is reproducible (F09). |
| Removed group member returns | Only the supplied snapshot is checked; no implemented group key lifecycle demonstrates exclusion (F16). |

## Tests, limitations and test-quality findings

- `npm test -- --runInBand`: **72 suites passed, 352 tests passed; one suite/test skipped**. Initial sandbox run aborted because Supertest could not bind a local port; rerunning with approved local-server access completed. The skipped test requires `MONGO_URI`, so production MongoDB transaction/restart behavior was not validated.
- `npm run client:build`: **passed**, including TypeScript compilation and Vite build. Compilation did not detect the incompatible runtime vault IDs.
- Temporary audit test command: `npx jest service/src/phase6.audit.test.ts --runInBand --coverage=false`. **14/14 probes passed, each confirming unwanted behavior**; reproducible source is retained in Appendix A. Passing audit assertions mean the unwanted behavior occurred, not that the application is safe.
- `npx playwright test`: launched all configured browser projects. **14 passed, 7 failed, 2 interrupted, 1 did not run** (exit 130 after stopping the stalled run). Two failures were the Chromium/WebKit modern-contact creation defect; five were Firefox launch timeouts, with Firefox reporting sandbox-extension/graphics initialization errors. The interrupted and unrun cases were Firefox. Firefox application behavior is therefore unvalidated, not counted as a product vulnerability. The modern flow was tested with real browser/WASM/vault integration; failures occurred before offline/restart assertions could run.
- `cargo test --manifest-path crypto-wasm/Cargo.toml --offline`: **not run successfully**; `cargo` is not installed (`command not found`). No Rust unit-test success or independent cryptographic primitive audit is claimed.
- No live production service, real Android/PC devices, real OS keystores, physical microphone capture, or multi-node MongoDB deployment was available for this audit. No dependency CVE scan or external network penetration test was performed. Scope is repository implementation and local executable tests, not a complete cryptographic proof or infrastructure audit.

Material weaknesses in existing tests:

1. Device-control tests do not round-trip their sent message (F02).
2. Modern conversation tests use storage that accepts IDs rejected by the actual vault (F01).
3. Sync tests manufacture authenticated frames and use callback-only “transactions”; they do not demonstrate authentication, crash rollback or database durability (F10/F12).
4. Recovery/group production-boundary tests use no-op crypto, trust and key adapters; callback invocation is not encryption, revocation or future-message exclusion (F14/F16).
5. Lifecycle write-failure tests fail the first write rather than failing between state and high-water writes (F09).
6. The prekey renewal test title promises unchanged identity while its assertion explicitly accepts newly generated replacement keys (F13).

These tests are useful unit checks, but several names and milestone claims imply substantially more than they exercise. Documentation acknowledges some missing adapters; those features remain incomplete regardless of labels such as “production boundary.”

## Privacy and cryptographic conclusions

The reviewed frontend requests files through a user-operated file picker; no bulk file collection or analytics sender was found in the reviewed runtime paths. The unused `PrivacyPolicy.assertAnalyticsAllowed()` does not itself enforce a network-wide prohibition. The relay necessarily observes room/routing identifiers, public bundles, timestamps, sizes and connection IPs; ciphertext protection is not metadata anonymity. Recovery currently has no demonstrated hidden administrator access, but also lacks a complete usable secure implementation.

The highest-risk cryptographic integration issue is the raw session persistence bypass (F07), not an identified break of Vodozemac's primitives. Unkeyed commitments/digests are useful consistency checks, but authority must come from authenticated keys and trusted durable state. Device revocation cannot erase plaintext already learned by a compromised endpoint; the unmet requirement here is preventing future authorization/key access and safe resumption.

## Required closure before release

1. Repair real-vault integration and codec round-trip failures; make the modern browser suite reach full offline/restart behavior.
2. Enforce cryptographic lifecycle authority, exact target confirmation and unique independent device identities.
3. Route all protocol mutations through durable ratchet persistence; implement actual transactional lifecycle/sync state and rollback resistance.
4. Implement authenticated distributed revocation/freshness, three-device enrollment and sync, including all runtime receive/retry paths.
5. Supply reviewed recovery, native keystore and group protocol implementations before enabling or advertising those features.
6. Enforce capture cleanup and relay privacy settings in the real UI/adapters.
7. Repeat the audit with real cryptography, durable storage, separate devices/processes, network partitions, malicious authenticated peers and systematic crash injection.

**Final verdict: PHASE 6 SECURITY NOT READY.**

## Appendix A — Reproducible adversarial probes

The temporary test was removed from the working tree after execution. To reproduce, save the following block as `service/src/phase6.audit.test.ts` and run `npx jest service/src/phase6.audit.test.ts --runInBand --coverage=false`. These assertions intentionally encode the observed vulnerable behavior. Convert them to rejection/safety assertions when implementing fixes. In-memory adapters isolate application logic; they do not simulate durable database guarantees or real cryptographic authentication.

```typescript
// Temporary adversarial audit probes. Passing assertions demonstrate unwanted behavior.
import { webcrypto } from 'crypto';
import { AuthenticatedDeviceControlChannel, SecureStorageDeviceLifecyclePersistence } from './devices/runtime';
import { createDeviceList } from './devices/deviceList';
import { deviceListCommitment } from './devices/canonicalEncoding';
import { DeviceLifecycleService, authorizationDigest, createEnrollmentConfirmation } from './devices/lifecycle';
import { DeviceTrustEnforcer } from './devices/trust';
import { RuntimeSyncController } from './sync/runtime';
import { AuthenticatedSyncTransport } from './sync/authenticatedTransport';
import { GroupMembershipService } from './groups/membership';
import { BrowserCallTransport } from './calls/media';
import { RecoveryCeremony } from './recovery/ceremony';
Object.assign(globalThis, { window: { btoa: (v:string) => Buffer.from(v, 'binary').toString('base64'), atob: (v:string) => Buffer.from(v, 'base64').toString('binary') } });
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const entry = (id: string, state = 'active') => ({ deviceId:id, publicIdentityReference:`identity-${id}`, algorithm:'v', state, createdAt:1, ...(state === 'revoked' ? { revokedAt:2 } : {}) });
const makeList = () => createDeviceList({version:1, identityReference:'user',epoch:0,previousCommitment:null,devices:[entry('a'),entry('b')] } as any);
const memory = () => { const records = new Map<string,ArrayBuffer>(); return { records, read:async(t:string,id:string)=>records.get(`${t}:${id}`),write:async(t:string,id:string,v:ArrayBuffer)=>{records.set(`${t}:${id}`,v);},delete:async(t:string,id:string)=>{records.delete(`${t}:${id}`);} }; };
const session = { encrypted:true,ready:true,encrypt:async (_:unknown,p:ArrayBuffer)=>({version:1,strategy:'test',data:p}),decrypt:async(_:unknown,e:any)=>e.data };
it('control send cannot be decoded by its own receiver', async()=>{let wire:any; const channel=new AuthenticatedDeviceControlChannel(session as any,{sendEnvelope:async(_:unknown,e:unknown)=>{wire=e;}} as any); await channel.send({type:'revocation',payload:{}}); expect(await channel.receive(wire)).toBeUndefined();});
it('deleting lifecycle record resets trust despite a retained newer highwater',async()=>{const s=memory(); const p=new SecureStorageDeviceLifecyclePersistence(s as any); const initial=await p.initialize('user',makeList()); const next=createDeviceList({...initial.list,epoch:1,previousCommitment:initial.commitment,devices:[entry('a'),entry('b','revoked')]} as any); await p.commitRevocation({scope:'user',expectedEpoch:0,previousCommitment:initial.commitment,nextList:next,nextCommitment:await deviceListCommitment(next),authorization:{operation:'revoke',transactionNonce:'nonce',authorDeviceId:'a',sequence:1,digest:'x',expiresAt:99999}}); await s.delete('device-lifecycle','user'); await p.initialize('user',makeList()); expect(await new DeviceTrustEnforcer(p,'user','b','identity-b').decision()).toBe('trusted');});
it('runtime-style verifier accepts an issuer absent from the trusted device list',async()=>{const s=memory();const p=new SecureStorageDeviceLifecyclePersistence(s as any);const initial=await p.initialize('user',makeList());const verifier={verify:async(c:any,a:any)=>{const x=c.authenticatedSender;if(!x.verified||x.userScope!==c.userScope||x.deviceId!==a.authorDeviceId||x.identityReference!==a.authorIdentityReference)throw Error();}};const svc=new DeviceLifecycleService(p,verifier,()=>10);const unsigned={version:1,operation:'enroll',userScope:'user',authorDeviceId:'outsider',authorIdentityReference:'outside-key',targetDeviceId:'evil',targetPublicIdentityReference:'evil-key',targetAlgorithm:'v',previousEpoch:0,previousCommitment:initial.commitment,transactionNonce:'n'.repeat(16),sequence:1,createdAt:1,expiresAt:100};const auth={...unsigned,authorizationDigest:await authorizationDigest(unsigned as any)};const context={cryptoSession:session,conversationId:'room',userScope:'user',authenticatedSender:{verified:true,userScope:'user',deviceId:'outsider',identityReference:'outside-key'}};expect((await svc.applyEnrollment(auth as any,context as any)).list.devices.find(d=>d.deviceId==='evil')).toBeDefined();});
it('confirmation accepts an invented replacement identity instead of the approved target key',async()=>{const s=memory();const p=new SecureStorageDeviceLifecyclePersistence(s as any);const initial=await p.initialize('user',makeList());const pending=createDeviceList({...initial.list,epoch:1,previousCommitment:initial.commitment,devices:[...initial.list.devices,entry('c','approved_pending_confirmation')]} as any);await p.commitEnrollment({scope:'user',expectedEpoch:0,previousCommitment:initial.commitment,nextList:pending,nextCommitment:await deviceListCommitment(pending),authorization:{operation:'enroll',transactionNonce:'original',authorDeviceId:'a',sequence:1,digest:'original',expiresAt:100}});const svc=new DeviceLifecycleService(p,{verify:async()=>{throw Error('must not run');}},()=>10);const unsigned={version:1,operation:'enroll',userScope:'different-scope',authorDeviceId:'invented',authorIdentityReference:'invented',targetDeviceId:'c',targetPublicIdentityReference:'attacker-key',targetAlgorithm:'v',previousEpoch:0,previousCommitment:initial.commitment,transactionNonce:'forged',sequence:1,createdAt:1,expiresAt:100};const auth={...unsigned,authorizationDigest:await authorizationDigest(unsigned as any)};const confirmation=await createEnrollmentConfirmation({version:1,authorizationDigest:auth.authorizationDigest,targetDeviceId:'c',targetIdentityReference:'attacker-key',confirmationNonce:'fake-confirmation',confirmedAt:10,expiresAt:100});const context={cryptoSession:session,conversationId:'room',userScope:'user',authenticatedSender:{verified:true,userScope:'user',deviceId:'c',identityReference:'attacker-key'}};expect((await svc.confirmEnrollment(auth as any,context as any,confirmation)).list.devices.find(d=>d.deviceId==='c')?.state).toBe('active');});
it('sync controller accepts a plain fabricated authenticated frame and malformed package',async()=>{const list=makeList();const checkpoint={epoch:0,commitment:await deviceListCommitment(list)};const trust={snapshot:async()=>({list,commitment:checkpoint.commitment}),assertTrustedAt:async()=>{}};const tx={claim:async()=>true,writeState:async()=>{},write:async()=>{}};const p={read:async()=>undefined,transaction:async(_:unknown,__:unknown,fn:any)=>fn(tx)};const c=new RuntimeSyncController('user','b',trust,p as any,()=>10);const auth={version:1,scope:'user',sourceDeviceId:'a',targetDeviceId:'b',sourceIdentityReference:'identity-a',targetIdentityReference:'identity-b',checkpoint,transferId:'t',expiresAt:100};await c.authorize(auth as any);await c.prepared();await c.ready();await c.begin();expect(await c.receiveAuthenticated({sessionBinding:'invented',senderIdentityReference:'unrelated',syncPackage:{scope:'user',sender:'a',receiver:'b',transferId:'t',checkpoint,sequence:-1,purpose:'execute',senderIdentity:'wrong',receiverIdentity:'wrong',payload:'arbitrary'}} as any)).toMatchObject({sequence:-1});});
it('authenticated transport skips strict sync package schema',async()=>{const pkg={scope:'user',sender:'a',receiver:'b',senderIdentity:'identity-a',receiverIdentity:'identity-b',sequence:-1,purpose:'execute'};const transport=new AuthenticatedSyncTransport({session:session as any,sessionBinding:'s',localIdentityReference:'identity-b',peerIdentityReference:'identity-a',peerDeviceId:'a'},{} as any,'user','b');expect((await transport.receive({version:1,strategy:'test',data:new TextEncoder().encode(JSON.stringify(pkg)).buffer} as any,'a')).syncPackage.sequence).toBe(-1);});
it('group authorization needs only a claimed admin id, accepts NaN expiry',async()=>{await expect(new GroupMembershipService().authorize({groupId:'g',actorDeviceId:'admin',epoch:1,expiresAt:NaN,action:'remove'},{group:{groupId:'g',epoch:1},members:[{deviceId:'admin',state:'active',role:'administrator'}]} as any)).resolves.toBeUndefined();});
it('relay-only configuration is discarded before RTCPeerConnection',async()=>{let config:any;const transport=new BrowserCallTransport(((c:any)=>{config=c;return {};}) as any);await transport.connect({} as any,{iceServers:[],iceTransportPolicy:'relay'});expect(config.iceTransportPolicy).toBeUndefined();});
it('invalid recovery consumes replay claim before verification',async()=>{const claims=new Set();const persistence={claim:async(id:string)=>{if(claims.has(id))return false;claims.add(id);return true;},stage:async()=>{}};const ceremony=new RecoveryCeremony({verify:async()=>{throw Error('invalid secret');}},persistence as any,()=>10);const archive={manifest:{version:1,archiveId:'archive'}};const ctx={oldFingerprint:'old',newFingerprint:'new',replacementId:'r'};await expect(ceremony.stage(archive as any,new Uint8Array(),ctx)).rejects.toThrow('invalid secret');await expect(ceremony.stage(archive as any,new Uint8Array(),ctx)).rejects.toThrow('replayed');});
import { BrowserSecureStorage } from './storage/secureVault';
import { MemoryVaultPersistence } from './storage/persistence';
import { fingerprintVodozemacIdentity } from './identity/vodozemacIdentity';
it('real fingerprint cannot be used as lifecycle vault record id',async()=>{const vault=new BrowserSecureStorage(new MemoryVaultPersistence());await vault.initializeWithPassphrase('audit-only-passphrase');const fingerprint=await fingerprintVodozemacIdentity({curve25519:'a'.repeat(43),ed25519:'b'.repeat(43)});expect(fingerprint).toContain(' ');await expect(new SecureStorageDeviceLifecyclePersistence(vault).read(fingerprint)).rejects.toThrow('Invalid secure-record');});
import { VodozemacRuntime } from './crypto/vodozemacRuntime';
it('exported authenticated session encrypts without persisting the mutated ratchet',async()=>{const s=memory();const storage={...s,withVodozemacPickleKey:async(fn:any)=>fn(new Uint8Array(32))};const account={identityKeys:()=>JSON.stringify({curve25519:'a'.repeat(43),ed25519:'b'.repeat(43)}),generateOneTimeKeys:()=>{},generateFallbackKey:()=>{},saveAccount:()=> 'pickle'};let saves=0;const handle={sessionId:()=> 'session',encrypt:()=> 'ciphertext',saveSession:()=>{saves++;return new Uint8Array([1]);}};const runtime=new VodozemacRuntime(storage as any,async()=>({protocolVersion:1,accountFactory:{createAccount:()=>account,loadAccount:()=>account},sessionFactory:{loadSession:()=>handle}} as any));await runtime.initialize();await runtime.restoreOrCreateIdentity();await runtime.establishSession('room',handle as any,'session');const baseline=saves;await runtime.getAuthenticatedSession().encrypt('signaling',new ArrayBuffer(0));expect(saves).toBe(baseline);await runtime.encrypt('signaling',new ArrayBuffer(0));expect(saves).toBe(baseline+1);});
import { TrustStateEventCoordinator } from './devices/trust';
it('future revocation notification is rejected but the stale local device stays trusted',async()=>{const s=memory();const p=new SecureStorageDeviceLifecyclePersistence(s as any);await p.initialize('user',makeList());const trust=new DeviceTrustEnforcer(p,'user','b','identity-b');const events=new TrustStateEventCoordinator(trust,'user');await expect(events.accept({version:1,eventId:'new-revocation',scope:'user',epoch:1,commitment:'a'.repeat(64),deviceId:'b',identityReference:'identity-b',state:'revoked',createdAt:10})).rejects.toThrow('unavailable');expect(await trust.decision()).toBe('trusted');});
it('one public key can be registered as multiple independent devices',()=>{expect(createDeviceList({...makeList(),devices:[entry('a'),{...entry('b'),publicIdentityReference:'identity-a'}]} as any).devices).toHaveLength(2);});
it('highwater write failure reports failure after lifecycle state is already changed',async()=>{const s=memory();let fail=false;const p=new SecureStorageDeviceLifecyclePersistence({...s,write:async(t:string,id:string,v:ArrayBuffer)=>{if(fail&&t==='device-lifecycle-highwater')throw Error('crash');await s.write(t,id,v);}} as any);const initial=await p.initialize('user',makeList());const next=createDeviceList({...initial.list,epoch:1,previousCommitment:initial.commitment,devices:[entry('a'),entry('b','revoked')]} as any);fail=true;await expect(p.commitRevocation({scope:'user',expectedEpoch:0,previousCommitment:initial.commitment,nextList:next,nextCommitment:await deviceListCommitment(next),authorization:{operation:'revoke',transactionNonce:'nonce',authorDeviceId:'a',sequence:1,digest:'x',expiresAt:100}})).rejects.toThrow('crash');expect((await p.read('user'))?.list.epoch).toBe(1);});
```
