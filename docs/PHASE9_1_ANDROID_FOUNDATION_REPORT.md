# Phase 9.1 Android Foundation Report

## Status

Phase 9.1 establishes the Android project, protocol-bound client interfaces, a Rust/JNI Vodozemac bridge, encrypted persistence boundaries, protocol fixtures, and protected relay/message foundations. It is not Android beta-ready yet. No claim of production readiness or complete Android interoperability is made in this report.

## Implemented components

### Android project and modules

`android/` is a Kotlin Android project using Compose, Coroutines/Flow, Hilt, Room, Android Keystore, and WorkManager dependencies. It contains the planned modules:

- `app`: Compose application entry point and Android permissions.
- `core`: safe error categories and cross-platform byte utilities.
- `crypto`: opaque Kotlin handle API and JNI-facing Vodozemac adapter.
- `network`: canonical JSON, lifecycle/proof request builders, REST proof client, and Socket.IO relay adapter.
- `storage`: Android Keystore AES-GCM record encryption, Room persistence, replay state, lifecycle metadata, and atomic account/session commit boundary.
- `security`: resource-bound device proof checks.
- `messaging`: strict modern envelope handling and persistence-before-acceptance inbound processor.
- `media`: encrypted-chunk and attachment-proof boundary.
- `calls`: encrypted signaling/proof boundary reserved for Phase 9.5 WebRTC work.

### Rust/Vodozemac bridge

`android/native-crypto` is a Rust `cdylib` using the same pinned `vodozemac` version as the browser/WASM boundary. It provides JNI functions for account creation and loading, encrypted account persistence, identity export, one-time/fallback key lifecycle, control-event signing, inbound/outbound sessions, encryption/decryption, session persistence, and handle disposal.

Accounts and sessions are held in native Rust registries addressed by opaque handles. Kotlin has no cryptographic implementation and no identity private-key accessor. Pickle keys are validated at exactly 32 bytes and zeroized in Rust after account pickle operations.

### Secure persistence and replay safety

Android Keystore creates a non-exportable AES-GCM storage key. Room records are encrypted with record-specific associated data. `CryptoStateStore.commitAccountAndSession` performs the equivalent of the browser `prepared`, `account-written`, and `committed` sequence in one Room transaction. The inbound processor decrypts or establishes a session, commits account and session state, validates the frame, and only then allows acceptance.

Invalid envelopes, trust failures, identity mismatch, runtime failures, and persistence failures return a rejection path. They do not acknowledge a mailbox item.

### Protocol fixtures

`protocol-fixtures/v1/` now contains synthetic fixtures for encoding, identity fingerprints, Ed25519 control-event signatures, proof request states, encrypted-envelope schema, and attachment AAD. The backend fixture test validates the encoding, accepted signature, modified-signature rejection, and strict envelope structure.

The fixtures intentionally contain no real user material, private keys, account pickles, encrypted messages, capabilities, or production secrets.

## Security properties retained

- No Kotlin crypto implementation or second identity model was added.
- Private Vodozemac identity keys remain behind Rust account handles.
- Control events are signed over fixed-order compact JSON.
- Device proof carriers retain exact operation and resource scope checks.
- Relay join, send, and signaling remain proof-bound.
- Modern envelopes require version 2 with strategy `vodozemac-olm-v1` and exact inner fields.
- Account/session persistence precedes mailbox acceptance.
- Attachment and call module boundaries require their existing proof scopes.
- No new plaintext logging was added.

## Automated validation performed

| Check | Result |
|---|---|
| `cargo fmt --manifest-path android/native-crypto/Cargo.toml` | Passed |
| `cargo test --manifest-path android/native-crypto/Cargo.toml` | Passed: 1 test, including account restart and duplicate pre-key rejection |
| `npx jest backend/security/protocolFixtures.test.ts --runInBand` | Passed: 3 fixture tests |
| `npm run lint` | Passed |
| `npm run client:build` | Passed |
| `npm run build-service-sdk` | Passed |
| `npx jest --runInBand --detectOpenHandles --coverage=false` | Passed: 97 suites / 432 tests; 3 suites and 7 tests skipped by existing environment-dependent conditions |
| Android `gradle tasks --no-daemon` | Passed after adding Kotlin's required Compose compiler plugin |
| `git diff --check` | Passed |

## Validation not completed

The following required validations did not complete in this environment and therefore are not represented as passing:

1. Android Gradle module compilation, lint, and unit tests. JDK and Gradle were installed, but the Android SDK package installation did not finish reliably in the execution environment and the Gradle configuration process could not be observed to completion.
2. Android instrumented tests for Keystore, Room recovery, permissions, and process restart.
3. Android ABI builds of the Rust JNI library. The Rust Android targets were requested but are not installed, so no `.so` files were produced or packaged.
4. Kotlin-to-Rust-to-TypeScript deterministic Olm vectors. Current fixtures freeze public encoding/signature/envelope/AAD contracts, but synthetic fixed account/session-pickle vectors still need to be added before cross-runtime Olm interoperability can be asserted.
5. Mongo-backed Android relay and offline replay integration. The Android client has the required boundaries, but no emulator/device test has run against real Mongo persistence.

## Remaining work before Phase 9.2

- Complete Android SDK and Rust Android target installation, then compile and lint all modules.
- Package ABI-specific JNI shared libraries and make the Android app fail closed when the native crypto library is absent.
- Run Keystore/Room instrumented failure-injection tests.
- Add deterministic Vodozemac account/session fixtures shared by Rust, TypeScript, backend, and Kotlin.
- Run the recipient-restart offline replay scenario through the Android Socket.IO client and real Mongo-backed mailbox.
- Implement the Phase 9.2 device bootstrap and enrollment UI only after the native build and fixtures pass.

## Files added

- `android/` project and module sources.
- `android/native-crypto/` Rust JNI bridge and native test.
- `protocol-fixtures/v1/` synthetic compatibility fixtures.
- `backend/security/protocolFixtures.test.ts` fixture verification test.

No existing production cryptographic algorithm, trust authority, lifecycle authority, or browser/backend protocol behavior was modified.
