# Phase 9.2.7 Final Android Messaging Interoperability Report

> Historical checkpoint: its then-current result was superseded by the successful persistent-profile end-to-end validation in [the Phase 9.2.10 environment report](PHASE9_2_10_ANDROID_VALIDATION_ENVIRONMENT.md).

Date: 2026-09-24

## Verdict

**Interoperability validation is incomplete. Do not create the requested commit or tag.** The Android client bootstrapped, joined the test conversation, and its outbound message reached the relay acceptance state. The browser did not display/accept that message, and the mailbox item remained. Browser-to-Android delivery and the complete Android offline-replay acceptance sequence were not verified in this run.

## Environment

- Disposable Android emulators `emulator-5554` and `emulator-5556` were visible to ADB; testing used `emulator-5556`.
- A local Chromium browser and isolated backend on port 3002 were used earlier in the run.
- The backend and MongoDB later stopped responding. At final verification, nothing was listening on ports 3002 or 27017, `brew services list` showed no Mongo service, and no `mongod` or `mongosh` executable was available.
- A final Gradle attempt failed before project configuration because Gradle could not load its native macOS ARM library (`libnative-platform.dylib`).

## Flow results

| Flow | Result | Evidence and boundary |
| --- | --- | --- |
| Browser → Android | **Not verified** | No completed run established Android decryption, Room commit, relay acceptance ACK, and subsequent Mongo mailbox deletion as one end-to-end sequence. |
| Android → Browser | **Failed / incomplete** | Android joined using the fresh test identity and the sender-side debug state reached `test:accepted`. The browser did not display or accept the incoming message. The previously observed mailbox count remained at one for the recipient route, so deletion after recipient acceptance was not demonstrated. The exact browser-side rejection/timeout cause remains undetermined. |
| Android offline replay after restart | **Not verified** | Android identity restoration and relay rejoin were observed, but a retained incoming message was not shown to decrypt, persist in Room, receive acceptance, and be removed from Mongo after restart. |

No proof, invitation capability, key material, ciphertext, or message text is included in this report.

## Confirmed correction during validation

The Android outbound-session adapter passed URL-safe base64 public-key strings directly to the native Vodozemac boundary, while the browser adapter normalizes those public values to the standard base64 alphabet. A small adapter conversion was added in `VodozemacBundleCodec` and used for the recipient identity and one-time pre-key inputs. A unit test covers URL-safe alphabet conversion. This does not change Vodozemac, identity verification, proof validation, fingerprint confirmation, or acknowledgement behavior.

The Android debug APK build and network unit tests had succeeded earlier after this correction. The later final Gradle rerun could not start because the installed Gradle native library failed to load. The correction alone did not establish browser receipt; the remaining failure must be reproduced with the backend and Mongo available before claiming interoperability.

## Remaining work

1. Restore a real local MongoDB service and isolated backend, then repeat Browser → Android while checking decryption, Room persistence, ACK, and mailbox deletion.
2. Reproduce Android → Browser and identify why the browser does not accept/display the incoming envelope; verify ACK and Mongo deletion after acceptance.
3. Run Android shutdown/restart offline replay and verify identity restore, reconnect, decrypt, Room persistence, ACK, and deletion in order.
4. Repair or use a compatible Gradle installation, rerun Android tests/build, and run `git diff --check` after final edits.

No release checkpoint was created. The requested commit, tag, and push were intentionally withheld because all three end-to-end flows did not pass.
