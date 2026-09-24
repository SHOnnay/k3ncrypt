# Phase 9.2 Android Device Validation Report

> Historical device-validation checkpoint: its then-current result was superseded by the successful persistent-profile end-to-end validation in [the Phase 9.2.10 environment report](PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md).

**Result: Partial validation passed; release checkpoint blocked.** The Android emulator, APK startup, JNI crypto, Room persistence, and Keystore-backed restore were exercised. The requested live Browser ↔ Android relay flows and application-process restart mailbox replay were not run, so this report does not qualify the Phase 9.2 interoperability checkpoint for commit, tag, or push.

## Environment

- Host: macOS on Apple Silicon (`arm64`)
- Java: OpenJDK 17.0.20.1
- Gradle: 9.7.1
- Android Debug Bridge: 1.0.41, version 37.0.1
- Emulator: Android 15, API 35, Google APIs ARM64 AVD (`k3ncrypt-api35`), connected as `emulator-5554`
- App: debug variant, package `com.k3ncrypt.app`
- Physical Android device: not connected
- Backend/Mongo relay environment: no backend was configured or reachable from the emulator for this validation run

## Tests performed

| Check | Result | Evidence |
|---|---|---|
| ADB connection | Passed | `adb devices -l` listed `emulator-5554` as `device`. |
| APK installation | Passed | `adb install -r .../app-debug.apk` returned `Success`. |
| Application startup | Passed | `MainActivity` started and the app process remained running (PID observed). No app crash or `AndroidRuntime` exception was reported. |
| JNI library loading and native operation | Passed | The connected Android instrumentation test instantiated `NativeCryptoBridge`, created two Vodozemac accounts, exchanged an Olm pre-key message, and decrypted it on the emulator. A passing native call requires the packaged JNI library to load. |
| Room and Android Keystore persistence | Passed, scoped | The instrumentation test committed inbound state through `CryptoStateStore`, closed Room and native handles, reopened the database, decrypted its records with the Android Keystore AES-GCM key, restored the Vodozemac account/session, and decrypted the next normal Olm message. The persisted record also did not contain the test marker in its ciphertext bytes. |
| Duplicate inbound commit handling | Passed, scoped | The instrumentation test observed `STORED` for the first commit and `DUPLICATE` for the same envelope digest. |
| App process restart and local identity restoration | Passed, limited | The app was force-stopped and relaunched; its previously saved device identity and bootstrap-pending lifecycle state were restored. Bootstrap could not complete without a reachable backend. |
| Browser → Android through the real relay | Not run | No Android conversation UI is present in `MainActivity`; it currently exposes identity/bootstrap and enrollment flows. No live backend/relay endpoint was configured for the emulator. |
| Android → Browser through the real relay | Not run | Same blockers as above. No cross-platform message, relay mailbox deletion, or server-side mailbox record was observed. |
| Offline mailbox replay after Android app restart | Not run | The on-device test proves local crypto and persistence reconstruction, but did not connect to a relay, fetch a mailbox item, or emit a server acceptance. |

The successful instrumentation result is recorded by Gradle as **1 test, 0 failures, 0 errors** on the Android 15/API 35 AVD. The test added for this validation is [AndroidCryptoPersistenceInteropTest.kt](../android/app/src/androidTest/kotlin/com/k3ncrypt/app/AndroidCryptoPersistenceInteropTest.kt).

## Failures and limitations

The first instrumentation attempt failed to install because an earlier manually installed APK had a different signing identity. Removing that emulator-only install resolved the mismatch; the connected instrumentation test then passed.

The live interoperability portion remains blocked by repository/runtime readiness rather than by a passing or failing cross-platform exchange:

- The Android app’s current `MainActivity` is an identity foundation screen and does not expose conversation creation, connect, send, or message display controls. Messaging code exists as `AndroidMessagingRepository`, but the user-facing message flow is not available to exercise from the installed application.
- The APK’s default backend configuration is `https://localhost`; that endpoint is not a backend running inside the emulator. No backend/Socket.IO relay endpoint and trusted test accounts were configured for this run.
- Consequently, no authenticated proof issuance, real relay join, mailbox fetch/acceptance, server-side deletion, Browser ↔ Android direction, or end-to-end post-restart replay was validated.
- The on-device persistence test closes and reopens Room and reconstructs native objects within the test process. It is not a substitute for killing and relaunching the full app while a real encrypted item remains in the server mailbox.

No production security or encryption behavior was changed during this validation. The only validation-oriented code addition is the emulator instrumentation test and its Android test dependencies. No real interoperability defect was confirmed, so no production fix was made.

## Security impact

The exercised path uses the existing Rust/Vodozemac native boundary for Olm session creation, encryption, decryption, and serialization. Kotlin did not implement cryptography. The receive-state persistence test used the existing Room transaction and Android Keystore AEAD adapter, and duplicate commit detection remained active. No proof checks, envelope checks, or acknowledgement ordering were bypassed. Because no relay exchange ran, this validation makes no claim about server authorization or mailbox acknowledgement behavior on Android.

## Release checkpoint decision

**Do not commit, tag, or push the Phase 9.2 interoperability checkpoint yet.** The required bidirectional relay exchanges and real offline mailbox replay have not passed. The next validation requires a reachable test backend/relay, an Android messaging UI or an approved end-to-end driver for the production repository flow, and test identities that complete bootstrap and proof issuance. Repeat both directions and the server-observed post-restart mailbox deletion test before creating `v0.2.1-android-messaging`.
