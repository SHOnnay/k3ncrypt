# Phase 9.1 Android Foundation — Final Report

## Result

The Android foundation now builds, passes its local unit tests and lint checks, and packages the Rust Vodozemac JNI library for all four configured Android ABIs. This validates a buildable foundation; it does not validate an end-to-end Android account, enrollment, or messaging flow. Phase 9.2 should begin with runtime composition and durable-state restoration before user-facing messaging work.

## Components reviewed

The project is split into app, core, crypto, network, storage, security, messaging, media, and calls Android modules. Kotlin uses Compose, coroutines/Flow, Hilt, Room, and OkHttp/Socket.IO. The current app is a placeholder Compose screen. Hilt is initialized, but the repository has no service binding/provider modules or injected application use cases.

The crypto module wraps the Rust vodozemac 0.11.0 dependency, matching the browser/WASM crate. JNI account and session registries expose numeric handles to Kotlin, and private identity keys have no Kotlin accessor. The bridge supports Vodozemac account, pre-key, signing, session, encrypt/decrypt, and close operations. Session serialization is returned as a byte array to Kotlin and then encrypted by the storage adapter; that serialization boundary is still broader than an opaque-handle-only interface and should be tightened or explicitly accepted before a release.

The storage module has a Room record table, an Android Keystore AES-GCM record wrapper, lifecycle metadata, replay markers, a transaction for account/session records, and an exported Room schema. Backup exclusion is declared both for legacy backup rules and Android 12+ cloud/device transfer rules. There is no Room database factory/provider or state-loading adapter wired into the application, so these are persistence primitives rather than a usable persistence runtime.

The network module builds bootstrap, enrollment, activation/revocation, and proof-request payloads using fixed field order and Vodozemac signing. The REST client only issues device proofs; bootstrap and lifecycle APIs are not connected. ProofGuard checks expiry and local operation/resource scope only. Server-side proof verification remains authoritative, but Android has no provider that obtains, parses, refreshes, and attaches a server proof to protected operations.

The messaging module strictly parses the versioned encrypted envelope and has an inbound processor. The processor depends on interfaces that are not composed with Room, the Vodozemac adapter, the relay, or UI stores. Its account/session commit and message insert are separate durable operations; a crash between them can leave an advanced crypto session without the corresponding displayed/deduplicated message. Session persistence is keyed using an in-process native handle value, and a stable conversation/session restore mapping is not implemented.

The fixture set now has Android tests for the shared identity fingerprint, compact signed proof-request bytes, Ed25519 verification and modified-payload rejection, proof scope/expiry fixture fields, encrypted-envelope parsing, and mailbox acknowledgement order. The Rust native test covers a pre-key message across account restart and rejects duplicate use. These tests do not yet establish cross-runtime Olm session interoperability using a shared encrypted-message vector.

## Verified fixes

- Aligned Java compilation with Kotlin's JVM 17 target across Android modules.
- Replaced the unavailable Material 3 XML theme and removed an invalid Android window theme attribute.
- Corrected Socket.IO callback invocation and strict JSON object field enumeration so the modules compile against the actual Android dependencies.
- Handled an empty OkHttp response body as a safe proof-request failure.
- Ensured a newly established inbound session is durably committed before it enters the active in-memory session map.
- Matched the browser/backend mailbox protocol: after the application accepts a replayed envelope, Android emits received before returning the positive Socket.IO acknowledgement. Rejected deliveries are not marked received.
- Added a Gradle task that builds Rust JNI libraries and packages them into the Android library/APK for arm64-v8a, armeabi-v7a, x86_64, and x86.
- Added backup extraction exclusions and configured Room schema export.

## Security boundaries

The Android code does not implement a Kotlin cryptographic identity or messaging algorithm. Vodozemac remains the source for identity signing and Olm sessions. Device lifecycle, trust epochs, server proof authenticity, expiry, nonce replay, and resource authorization still require the backend authority; a Kotlin scope check is not an authorization substitute. Local record AES-GCM protects stored records, and the Keystore key is non-exportable. No production trust model or browser/backend behavior was changed.

## Validation

| Check | Result |
|---|---|
| Gradle build | Passed; debug and release variants built |
| Android debug unit tests | Passed: 19 tests across Android modules |
| Android lint | Passed; remaining warnings are dependency update suggestions and missing app icon |
| Debug APK | Passed |
| Debug APK JNI contents | Verified: all four ABI libraries are present |
| Rust host tests | Passed: 1 test |
| Rust formatting | Passed |
| Rust Android release JNI builds | Passed for all four ABIs |
| JNI symbol check | Passed: 18 expected NativeCryptoBridge symbols per ABI |
| Backend shared protocol fixture Jest test | Passed: 3 tests |
| Git diff check | Passed |

The Android SDK Platform 35, Build Tools 34, and NDK 27.2.12479018 were installed for validation. The SDK has no attached/emulated device available to this run; Android instrumentation, actual Keystore behavior, and app launch were therefore not tested.

## Readiness and remaining limitations

Build, lint, local tests, native ABI compilation, and APK packaging are verified. The implementation is not yet a connected Android product. Before treating Phase 9.1 as a complete runtime baseline, close these foundation gaps:

- Add Hilt bindings and application composition for crypto, API, Room, proof acquisition, and relay services.
- Add a Room database provider plus encrypted account/session/message loading and process-restart restoration.
- Replace the transient numeric session-handle persistence key with a stable conversation/session mapping.
- Make the crypto-state update, message insertion, deduplication record, and mailbox acceptance recoverable as one durable protocol. The current separate writes do not provide crash-atomic delivery.
- Keep serialized Vodozemac session state inside an appropriately narrow protected boundary; currently session pickle bytes cross JNI into Kotlin before record encryption.
- Connect signed bootstrap/enrollment/activation/revocation APIs and fresh proof issuance to the backend contracts. Do not let local ProofGuard results stand in for backend verification.
- Run emulator/device tests for Keystore, Room transaction/recovery, JNI loading, real Socket.IO delivery, and mailbox replay.
- Add shared deterministic Rust/TypeScript/Kotlin Olm session vectors and attachment AAD tests that Android consumes.

The Phase 9.2 plan sequences these prerequisites ahead of full message UX.
