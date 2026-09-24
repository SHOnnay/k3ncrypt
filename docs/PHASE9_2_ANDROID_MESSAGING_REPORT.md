# Phase 9.2 Android Messaging Report

> Historical implementation checkpoint: its listed interoperability limitations were resolved by the persistent-profile validation in [the Phase 9.2.10 environment report](PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md).

## Result

The Android identity and encrypted-messaging runtime foundation is implemented and compiles. Local module validation passed. Phase 9.2 is **not verified end to end**: browser-to-Android, Android-to-browser, and Android restart/offline-replay scenarios were not run on a device or emulator. The current Compose screen covers identity setup and enrollment; it does not yet expose a user-facing conversation or message interface.

## Architecture implemented

- `CryptoPort` remains the Kotlin-facing boundary to the Rust/Vodozemac JNI implementation. Kotlin stores opaque account and session handles only while the process is alive. Account pickle, session pickle, Olm session creation, signatures, encryption, and decryption remain inside Rust/Vodozemac.
- Android Keystore AES-GCM seals Room records with namespace-and-record AAD. A random Vodozemac pickle key is itself stored only as a sealed record. The account pickle is protected by Vodozemac and then by the Android storage boundary.
- `AndroidIdentityLifecycleRepository` creates independent device identities, restores the saved account, signs the existing bootstrap/enrollment/activation/revocation contracts through the native signer, and obtains fresh device-control proofs for issuer actions. The Android onboarding screen keeps first-device bootstrap separate from target-device enrollment and requires explicit fingerprint entry/confirmation.
- `AndroidMessagingRepository` publishes and pins public pre-key bundles, validates the confirmed peer fingerprint, obtains fresh conversation-bound relay proofs, creates outbound Olm sessions in Rust, and stores encrypted envelopes in a durable outbox before relay submission.
- Incoming mailbox items pass strict envelope and sender checks, Vodozemac decryption, and strict browser-compatible message-frame parsing. Account state, session state, message content (sealed at rest), and replay/delivery markers are committed in one Room transaction before an acceptance acknowledgement is emitted. Duplicate envelopes are acknowledged only when the durable digest already exists; rejected items are left unaccepted for relay retention.

## Security boundaries

- No Kotlin encryption or signature algorithm was added. All signing and messaging crypto calls cross the JNI boundary to Rust/Vodozemac.
- Proof requests are freshly signed per operation. The client checks the issued proof's account, device, operation, epoch, nonce, resource, and lifetime; the backend remains the authority for proof authenticity and current lifecycle state.
- The relay transports the existing opaque encrypted envelope. Positive mailbox acceptance follows durable local commit; negative acceptance does not emit `received`.
- Local record contents are sealed by Android Keystore AEAD. Private identity material is not exported to Kotlin or sent to the backend.

## Validation performed

| Validation | Result |
|---|---|
| Android Gradle `testDebugUnitTest` | Passed: 26 tests across 15 suites, no failures or skips |
| Android Gradle `lintDebug` | Passed |
| Android Gradle `assembleDebug` | Passed; debug APK produced at `android/app/build/outputs/apk/debug/app-debug.apk` |
| Rust `cargo fmt --check && cargo test --locked` | Passed: 2 tests |
| Backend `npx jest backend --runInBand --detectOpenHandles --coverage=false` | Passed: 21 suites, 68 tests; 3 Mongo/environment-dependent suites and 7 tests skipped |
| Mongo-backed backend integration suites | Passed: 3 focused suites, 7 tests (Jest reported an open Mongo TCP handle after the tests completed) |
| `git diff --check` | Passed |

The backend suite was run with permission to bind local test sockets. The three Mongo-backed lifecycle, membership, and persistence suites were also run in isolation with MongoDB connection variables; all seven tests passed, but Jest reported an open Mongo TCP handle after completion and had to be interrupted. A second *full* backend run with Mongo variables set was not clean: unrelated API/control-capability/offline-mailbox suites failed in that combined database configuration, and Jest reported the same open-handle issue. Those failures need separate test-environment investigation; they are not represented as passing validation.

## Compatibility coverage

- Shared protocol fixtures now include synthetic bootstrap, enrollment, and activation signatures. Android verifies the canonical bytes and rejects modified bytes; backend verification tests consume the same fixtures.
- Android tests cover canonical event bytes, device-proof response binding, proof scope/expiry rejection, pre-key key-ID derivation, message framing, envelope parsing, mailbox acceptance ordering, and commit-before-session-publication behavior.
- Rust tests cover Vodozemac account/session restore and an Olm pre-key/envelope/text-frame round trip using the browser wire format.

These are cross-platform contract and crypto-boundary tests; they are not substitutes for a live browser-to-Android transport test.

## Remaining limitations

1. **Required live compatibility scenarios remain unverified.** There is no `adb` executable or Android emulator available in this environment. No test here proves Browser → Android, Android → Browser, or Android restart followed by real backend mailbox replay.
2. **No Android conversation UI yet.** The messaging repository is wired as a runtime API, but the Compose screen does not create/open conversations, compose messages, display delivery states, or expose retries.
3. **Invitation provisioning is external.** `ConversationInvitation` must be supplied with the conversation ID, control capability, local/peer routing IDs, routing proof, and pinned peer fingerprint. Android does not yet implement the full user-facing invitation creation/share/join flow.
4. **First-bootstrap ambiguous response recovery is limited.** The client preserves and retries the exact signed bootstrap request, but the current backend rejects a replay after a bootstrap was committed if the first response was lost. Such a device can become locally pending while already registered remotely and needs a backend-supported idempotent status/recovery contract.
5. **Pre-key publication ambiguity fails closed.** An uncertain publication marker blocks automatic republishing to avoid replacing keys that may already be advertised. A recovery/status endpoint is needed to safely reconcile that state.
6. **Enrollment handoff is manual.** The target account reference and pending epoch are exchanged manually, and public identity/fingerprint confirmation is not yet a polished QR or authenticated device-control flow.
7. **The full backend suite with Mongo enabled is not clean.** Focused Mongo lifecycle, membership, and persistence suites passed, but a combined full run also failed unrelated backend suites and left an open Mongo connection handle.
8. **No device-level Keystore/Room/JNI runtime test ran.** The Android build and APK packaging pass, but platform storage, Keystore key invalidation behavior, and native calls have not been exercised on an emulator or physical Android device.

## Release checkpoint

Because the required live cross-platform and restart/offline scenarios remain unverified, this report does not claim full Phase 9.2 completion. The requested commit, tag, and push were withheld pending those tests. The unrelated untracked `security-test-result.txt` was left untouched.
