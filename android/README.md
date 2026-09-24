# K3NCRYPT Android foundation

This module is the Phase 9.1 Android foundation. It deliberately contains no Kotlin cryptographic implementation. Vodozemac remains the Rust authority behind opaque native handles.

## Build prerequisites

- JDK 17
- Android SDK platform 35 and build tools
- Android NDK 27.2.12479018 for the Rust JNI target
- Rust targets `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`, and `i686-linux-android`

Set `ANDROID_HOME` to the SDK path, then run:

```sh
ANDROID_HOME=/path/to/android-sdk gradle testDebugUnitTest
ANDROID_HOME=/path/to/android-sdk gradle lintDebug
ANDROID_HOME=/path/to/android-sdk gradle assembleDebug
```

Instrumentation and Mongo-backed relay tests require an emulator/device and a reachable test backend. They are intentionally not replaced with mocks.

## Persistent and disposable Android validation

Use `k3ncrypt-persistent-beta` only for real Browser ↔ Android identity, trust, and relay validation. Its Keystore and Room data are persistent. Build and update it in place:

```sh
ANDROID_HOME="$ANDROID_HOME" gradle -p android :app:assembleDebug
K3NCRYPT_PERSISTENT_SERIAL=emulator-5554 ANDROID_HOME="$ANDROID_HOME" android/scripts/install-persistent-debug.sh
```

The installer verifies the AVD name and uses only `adb install -r`. It never uninstalls the package, clears app data, or wipes the AVD. Use `am force-stop` to simulate process death; do not use Gradle connected tests on this profile.

Use `k3ncrypt-instrumentation-disposable` for `:app:connectedDebugAndroidTest`. Connected tests may uninstall the app and clear its sandbox/Keystore. Both the Gradle task and `android/scripts/run-disposable-instrumentation.sh` verify that exactly one disposable AVD is attached and the persistent AVD is not running. Room/Keystore process-restart tests requiring preserved user state belong on the persistent profile and must use non-destructive manual or UI automation; clean-install, migration, and isolated instrumentation tests belong on the disposable profile.
