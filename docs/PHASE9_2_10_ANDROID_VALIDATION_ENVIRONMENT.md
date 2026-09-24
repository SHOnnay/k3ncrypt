# Phase 9.2.10 Android Validation Environment

This setup separates the persistent interoperability device from destructive Android instrumentation runs.

## Profiles

- `k3ncrypt-persistent-beta` is the persistent Pixel 6 / Android 15 profile for the Browser ↔ Android conversation and offline replay scenario. Its application data remains intact across force-stop and in-place debug APK updates.
- `k3ncrypt-instrumentation-disposable` is reserved for `connectedDebugAndroidTest`. The Android Gradle Plugin's UTP installer currently sets `uninstall_after_test: true`, so the app sandbox and Keystore state on that profile are disposable.
- `k3ncrypt-phase925-validation` is the earlier test profile. Do not treat it as the persistent device.

Both new profiles use the installed `system-images;android-35;google_apis;arm64-v8a` image. The persistent profile was created separately under the user's AVD home; it contains no recovered app state. AVD profiles preserve `userdata` across emulator restarts. An in-place `adb install -r` preserves app data when the package and signing identity match. Uninstall, `pm clear`, `-wipe-data`, and connected instrumentation can remove that data.

## Persistent device workflow

Start the persistent AVD without wiping userdata:

```sh
emulator -avd k3ncrypt-persistent-beta -no-snapshot -no-boot-anim
```

Build and update the app in place, using the persistent emulator's serial:

```sh
gradle -p android :app:assembleDebug
adb -s <persistent-serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
```

To simulate an app stop/restart without removing its state:

```sh
adb -s <persistent-serial> shell am force-stop com.k3ncrypt.app
adb -s <persistent-serial> shell monkey -p com.k3ncrypt.app 1
```

Do not run `connectedDebugAndroidTest` while the persistent AVD is running or attached to ADB.

## Disposable instrumentation workflow

Start only the disposable profile before running connected tests:

```sh
emulator -avd k3ncrypt-instrumentation-disposable -no-snapshot -no-boot-anim
ANDROID_HOME="$ANDROID_HOME" android/scripts/run-disposable-instrumentation.sh
```

The guard script refuses to run unless exactly one Android device is attached, its AVD name is `k3ncrypt-instrumentation-disposable`, and the persistent AVD process is not running. This keeps UTP's uninstall behavior away from the persistent profile.

## Interoperability sequence

1. On the persistent AVD, create the Android identity through the normal bootstrap flow.
2. Join the existing Browser invitation through the normal UI and compare/confirm the peer fingerprint in the app.
3. Exchange a message and verify the normal trust, session, persistence, and acknowledgement path before testing restart.
4. Stop only the app with `am force-stop`; do not uninstall, clear data, or wipe the AVD.
5. Have the browser send while Android is offline. Confirm the encrypted mailbox item is retained in Mongo.
6. Relaunch the app and inspect only the debug stage labels: `identity-restored`, `conversation-restored`, `relay-connected`, `mailbox-received`, `session-restored`, `decrypted`, `room-commit`, `acknowledgement`.
7. Confirm Mongo mailbox deletion occurs after the positive client acknowledgement.

The debug inspection provider is present only in debug builds and reports non-secret state. A one-shot local helper may prefill only the invitation field so shell text encoding cannot alter it; the ordinary join action and explicit fingerprint comparison remain required. It does not return invitation material, keys, proofs, fingerprints, ciphertext, or message content. Temporary stage markers used for the final replay run were removed after verification.

The previously trusted emulator state was removed by a prior connected instrumentation run. No AVD snapshot was found, so this profile begins empty and does not restore that deleted state. A trusted conversation must be established normally on the persistent profile before offline replay can be attempted.

## Final persistent-profile validation (2026-09-24)

On `k3ncrypt-persistent-beta`, a new Android identity was bootstrapped through the app, a Browser invitation was created in headed Chromium, and the Browser fingerprint shown in its identity view was compared with the invitation before Android's normal Join action. The Browser's pending Android fingerprint was then compared with the Android identity view before marking the contact verified. A two-way online exchange succeeded.

For the offline replay, Android was force-stopped without clearing app data, a Browser message was confirmed retained in the Mongo `offline_messages` collection, and Android was relaunched. The observed stage order was: identity restored, conversation restored, relay connected, mailbox received, session restored, decrypted, Room commit, acknowledgement. The message appeared after restart and the Mongo mailbox item was absent after acceptance.

The run exposed a Compose crash when the replay callback raced the persisted-message snapshot and inserted the same delivery ID twice into the keyed message list. The UI now deduplicates message IDs for both callback and history hydration. Regression coverage exercises that ordering. The final replay itself passed after the fix. Temporary `identity-restored`, `conversation-restored`, `relay-connected`, and `session-restored` stage instrumentation was removed after capture; cryptographic, authorization, and mailbox behavior was not changed.

Post-fix validation:

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm run client:build` | Passed |
| `npm run build-service-sdk` | Passed |
| `npx jest --runInBand --detectOpenHandles` | 97 suites / 439 tests passed; 3 Mongo/environment-dependent suites and 7 tests skipped |
| Android Gradle `test :app:assembleDebug` | Passed |
| Disposable AVD `:app:connectedDebugAndroidTest` | Passed, 2 tests |
| `git diff --check` | Passed |
