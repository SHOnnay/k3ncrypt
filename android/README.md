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
