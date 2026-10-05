# Local Session transport experiment

This is an opt-in, debug-only Android application for the bounded transport
experiment. It has a distinct application ID (`com.k3ncrypt.experiment.localsession`)
and must install alongside the normal K3NCRYPT application.

## Build

From `android/`:

```sh
./gradlew -PlocalSessionExperiment=true :local-session-experiment:testDebugUnitTest
./gradlew -PlocalSessionExperiment=true :local-session-experiment:assembleDebug
./gradlew -PlocalSessionExperiment=true :local-session-experiment:lintDebug
```

The Gradle project is included only with `-PlocalSessionExperiment=true`; normal
Android project builds do not include it. It has no project dependency and no
new production dependency. JUnit is test-only.

## Isolation evidence

- Application ID is distinct from `com.k3ncrypt.app`; Android gives each package
  its own application sandbox/UID. No `sharedUserId`, provider, service, receiver,
  deep link, or IPC bridge is declared.
- Source/build dependency inspection found no production package imports,
  Hilt, Room, JNI, Vodozemac, messaging, relay, call, lifecycle or identity module.
- It does not call SharedPreferences, open files, create a database, or request
  Keystore access. Session, endpoint hints, sockets, messages and diagnostics are
  held in memory and cleared at teardown.
- It declares only INTERNET (TCP sockets) and ACCESS_NETWORK_STATE (selected
  Wi-Fi/capability inspection). Both are normal install-time permissions for
  target 35; no runtime prompt is required. No production manifest is changed.
- The app does not request a runtime local-network permission for target 35.
  Android 16's local-network restriction is an opt-in test mode; Android 17
  requires `ACCESS_LOCAL_NETWORK` for apps targeting SDK 37 or higher. Recheck
  the platform behavior before raising this experiment's target SDK. See the
  [Android local-network permission guidance](https://developer.android.com/privacy-and-security/local-network-permission).

Static package isolation reduces accidental authority coupling. It is not a claim
that arbitrary operating-system compromise is contained. The running APK has no
mechanism to access the main app's private data.
