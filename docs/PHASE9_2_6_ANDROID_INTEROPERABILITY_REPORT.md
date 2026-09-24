# Phase 9.2.6 Android Interoperability Report

> Historical checkpoint: its incomplete result was superseded by the successful persistent-profile end-to-end validation in [the Phase 9.2.10 environment report](PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md).

## Status

**Incomplete — no commit, tag, or push was created.**

The debug-only inspection mechanism works, Android joined a real browser-owned conversation through the normal invitation and fingerprint-confirmation UI, and that selected conversation now restores after an Android process restart. The required completed message matrix was not reached: accepted Browser → Android delivery, Android → Browser delivery, and Android offline mailbox replay still require one controlled run.

## Environment

- Disposable Android 15 / API 35 arm64 emulator (`emulator-5556`). The existing emulator profile was not changed.
- Debug Android APK with a local validation backend configured as `http://10.0.2.2:3001`.
- Headless Chromium through Playwright, using a persisted local test profile.
- Local K3NCRYPT backend and MongoDB at `127.0.0.1:27017`.
- JDK 17 and locally installed Android SDK.

Invitation capabilities, proofs, private keys, ciphertext, and message content are intentionally omitted from this report.

## Debug-only verification boundary

The debug source set contains a provider at `content://com.k3ncrypt.app.debug.inspection/inspection`.

It exposes only:

- `conversationId`
- `peerFingerprint`
- `connectionState`
- `messageDeliveryState`

The provider is absent from the release manifest. It does not invoke crypto, alter trust decisions, validate messages, or acknowledge relay deliveries. A debug-only test seed path fills the normal Android join form to avoid ADB shell escaping corrupting an invitation; it does not join a conversation or bypass parsing and fingerprint confirmation.

## Verified results

| Check | Result |
|---|---|
| Debug APK build | Passed |
| Debug lint | Passed earlier in this Phase 9.2.5/9.2.6 validation run |
| Instrumentation suite on disposable emulator | Passed: 1 test |
| First Android device bootstrap against local Mongo backend | Passed |
| Browser-owned invitation accepted by Android | Passed through the regular invitation parser and matching fingerprint confirmation |
| Authenticated Android relay join | Passed; debug state reported the browser conversation ID and pinned peer fingerprint |
| Android restart / identity restore / selected conversation restore | Passed after the active-conversation persistence correction |
| Browser → Android encrypted message accepted, persisted, acknowledged, and deleted from Mongo mailbox | Not completed |
| Android → Browser encrypted message delivery | Not completed |
| Android restart while an offline mailbox item is pending | Not completed |

## Confirmed fixes during validation

1. **Debug-only state inspection**: added a release-absent provider with an allowlisted four-field cursor. This provides automated fingerprint comparison without exposing invitation capability material.

2. **Active conversation persistence**: `AndroidMessagingRepository` previously restored the first encrypted `conversation` record, which was nondeterministic once a device had joined more than one conversation. It now writes an encrypted active-conversation pointer whenever a conversation is created, selected, or first-contact pinned. Existing installations retain a fallback to the first stored record until a user selects a conversation again.

3. **Incoming delivery status observation**: the Compose callback now records accepted incoming delivery only after the existing repository callback returns. No message-processing or acknowledgement ordering changed.

4. **Safe API error category**: HTTP failures preserve only a numeric status category internally. Backend response bodies are not surfaced to the UI.

## Security impact

- No Vodozemac operation, cryptographic algorithm, proof validation, identity pinning, mailbox retention rule, or persistence-before-acknowledgement sequence changed.
- Debug inspection is build-variant scoped and unavailable in release artifacts.
- First-contact verification remains mandatory. The test seed pre-populates the same UI fields that a user would enter; the existing parser and equality check still reject mismatches.
- The active-conversation pointer is stored through the existing encrypted state store and does not introduce plaintext message or key persistence.

## Remaining limitations and next validation steps

1. Keep the browser and Android processes alive in one controlled run.
2. Send Browser → Android and verify `messageDeliveryState` is accepted, Room contains one message, and the matching Mongo mailbox count becomes zero only after acceptance.
3. Send Android → Browser and verify browser decryption and UI delivery.
4. Force-stop Android before a browser message, restart it, then verify identity restore, encrypted mailbox replay, persistence, acknowledgement, and server deletion.
5. Repeat invalid-envelope, wrong-identity, and duplicate-delivery regression checks during that same environment run.

Because those message-level flows are not yet verified end to end, `v0.2.1-android-messaging` must not be created yet.
