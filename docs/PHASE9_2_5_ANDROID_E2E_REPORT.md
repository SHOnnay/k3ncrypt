# Phase 9.2.5 Android Messaging E2E Report

> Historical checkpoint: its incomplete result was superseded by the successful persistent-profile end-to-end validation in [the Phase 9.2.10 environment report](PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md).

## Outcome

The Android messaging screen and configurable backend endpoint are implemented, and the Android debug build plus static/unit validation pass. Browser Chromium successfully joined an Android-created conversation after the local development backend was started with development CORS settings. The complete interoperability objective is **not verified**: first-contact identity confirmation, accepted delivery, server mailbox deletion, both-direction message display, and Android offline restart replay were not completed. No commit, tag, or push was made.

## Environment

- Android emulator: `emulator-5554`, Android 15 / API 35.
- Browser: headless Chromium through Playwright.
- Backend: local K3NCRYPT backend connected to MongoDB on `127.0.0.1:27017`.
- Client: local Vite development server.
- Android build toolchain: JDK 17 and the installed Android SDK, configured for the Gradle process only.

No invitation fragment, capability, public fingerprint, message content, or proof material is included in this report.

## Implemented in this work

- Minimal Compose conversation flow for creating/joining a conversation, viewing the peer identity fingerprint, sending and displaying messages, and viewing delivery state.
- Runtime endpoint configuration for Android emulator HTTP (`10.0.2.2`) and HTTPS deployments. Release configuration rejects non-HTTPS endpoints; debug cleartext allowance is restricted to the emulator host.
- Android UI connection to the existing messaging repository and Vodozemac/JNI path, retaining encrypted-envelope validation, durable persistence before relay acknowledgement, and mailbox deletion after acceptance.
- First-contact handling that holds an unknown peer's envelope pending explicit fingerprint confirmation rather than acknowledging it.
- Bounded clock-skew tolerance when validating an issued device proof. Proof signature, identity, scope, epoch, nonce, and expiry checks remain enforced.

## Tests and validation

| Check | Result |
|---|---|
| Android debug APK assembly | Passed with JDK 17 and installed SDK |
| Android app lint | Passed |
| Android app unit tests | No unit tests are defined for this module (`NO-SOURCE`) |
| Android network unit tests | Passed |
| Native crypto build task | Gradle reported it up to date; this run did not independently rerun Rust tests |
| Browser invitation join | Passed after restarting the development backend with local development CORS defaults |
| Browser-to-Android message display and acceptance | Not verified; Android requires explicit first-contact fingerprint confirmation first |
| Android-to-browser message display and acceptance | Not run |
| Android offline restart replay and mailbox deletion | Not run |
| Android instrumentation test | Not run; installation was stopped before test execution by `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because the installed app and newly built APK have different signing certificates |

The first Gradle attempt used JDK 25 and failed Java/Kotlin target compatibility. Retrying with the installed JDK 17 resolved that environment issue. The debug APK assembly, lint, and network unit task then passed. The connected instrumentation task reached the emulator but could not install the APK because the installed package signature differs. Uninstalling would erase the emulator's current identity and conversation state, so it was not done.

## Blocking validation item

The Android owner conversation displayed the complete invitation, including its control capability, alongside the UI used for first-contact verification. The available accessibility dump would have emitted both the fingerprint and that capability to command output. Automatic review rejected that output to prevent disclosure of authorization material. No alternate extraction path was used. Consequently, the browser's public fingerprint could not be safely compared with Android's pending peer fingerprint, and the app's explicit confirmation step could not be completed in this run.

The browser joined after correcting the local development CORS setup and attempted to send a test message. Since the Android confirmation was not performed, this is not evidence of successful decryption, Room persistence, relay acceptance, mailbox deletion, or message display.

## Security impact and remaining limitations

- No cryptographic algorithm, Vodozemac boundary, trust validation, mailbox retention rule, or acknowledgement ordering was weakened.
- Unknown first-contact messages remain unacknowledged pending user identity confirmation.
- Production backend HTTPS origin validation was not changed; the permissive origins were used only by the local development backend.
- The Android-to-browser direction, accepted browser-to-Android delivery, and offline restart replay still need a controlled emulator run that can compare fingerprints without exposing invitation capabilities.
- Instrumentation still needs a compatible emulator installation/signing setup that preserves the existing test identity or uses a dedicated disposable test profile.

## Release checkpoint

Phase 9.2.5 interoperability validation is incomplete. The requested commit, `v0.2.1-android-messaging` tag, and push are intentionally deferred until both message directions and offline restart replay are verified, including persistence, acknowledgement, and server-side mailbox deletion.
