# K3NCRYPT Android personal beta

Native Android supports encrypted 1:1 messaging, explicit fingerprint verification, audio/video and V2 files/photos/documents. Rust Vodozemac remains messaging identity/session authority. Reviewed attachment AEAD and Android Keystore storage are separate existing contracts. This source targets `0.1.0-beta.3` / version code `3`; physical Web↔Android media/file validation and signed distribution remain pending.

## Prerequisites and debug validation

JDK 17, Android SDK platform 35, NDK 27.2.12479018, Rust/cargo and targets `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`, `i686-linux-android` are required. Set `ANDROID_HOME` and `JAVA_HOME` externally. Use this checkout's Gradle wrapper:

```sh
cd android
./gradlew testDebugUnitTest :app:assembleDebug :app:lintDebug --no-daemon
```

Configure debug endpoints through `-Pk3ncryptBackendUrl` and `-Pk3ncryptSocketUrl`; HTTPS is the default. Only the explicit debug emulator bridge permits HTTP. No local CA or LAN configuration is included in release. Do not distribute debug APKs as production releases.

## Release preparation

```sh
./gradlew :app:processReleaseMainManifest :app:mergeReleaseResources :app:generateReleaseBuildConfig :app:lintRelease --no-daemon
```

These prepare/inspect unsigned configuration; they do not sign a distributable artifact. [Signing inputs and release commands](../docs/ANDROID_BETA_RELEASE.md) are external. Missing origins or signing credentials fail closed. Version codes must increase above all previously distributed artifacts.

## Limitations and safe device testing

Files: 8 MiB, 256 KiB chunks, 32 chunks plus manifest, two active transfers, 12 MiB conservative stored/incomplete reservations, 24-hour expiry. Same-session exact-object retry only; process death requires transfer restart. Unknown-size document providers are rejected. Save is explicit and scoped; no broad storage permission or automatic opening. Thumbnails are deferred.

No default Android ICE servers or bundled TURN. Direct ICE may expose addresses and restrictive NATs may prevent calls. Calls are foreground-only and cannot survive process death. Physical media/file interoperability is pending. Local Session remains a separate experiment.

Use a disposable device/profile for destructive connected instrumentation. Never run connected tests, uninstall, clear data or wipe the persistent identity profile. Existing scripts verify the disposable AVD and screen-lock requirements; see `scripts/run-disposable-instrumentation.sh` and the retained validation environment notes in `../docs/PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md`.
