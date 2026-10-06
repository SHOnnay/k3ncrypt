# Personal-use beta release gates

Canonical source is `integration/main-product`; hardening is not publication authorization. The supported product is Web + native Android, encrypted 1:1 messaging, explicit verification, audio/video and V2 files/photos/documents. Local Session is a separate experiment. No signed upcoming Android artifact or physical Web↔Android media/file pass is implied.

## Build and configure

Use [local build instructions](LOCAL_DEVELOPMENT.md), [compiled production Docker deployment](../docker/README.md), [Android prerequisites](../android/README.md), and [external signing/versioning](ANDROID_BETA_RELEASE.md). Operate a single backend instance, external persistent Mongo and a trusted HTTPS proxy. Apply migrations before traffic and require `/api/ready`, not only `/api/health`. Protect proxy/backend access, database credentials and replay/lifecycle records. Do not append duplicate CSP/security headers at an upstream proxy; Express owns combined responses, nginx owns static-only responses.

## Contact and product expectations

Create/unlock the local account with a private passphrase (Web) or device credential/Keystore boundary (Android). Share invitations only with intended contacts. Compare fingerprints through an independent trusted channel before marking verified. Pinning and connectivity do not verify identity; calls and new file sends require unchanged verified authority.

Files: 8 MiB; 256 KiB; 32 chunks plus manifest; two active transfers per account; 12 MiB stored/incomplete reservations; 24-hour expiry. Photos share the encrypted path, thumbnails are deferred. Same-session exact-object retry only. Process death/cache loss requires a new sender transfer; receivers discard partial output and can download afresh from protected history. Web requires OPFS/Web Locks support; unknown-size Android providers are rejected. Explicit save follows complete authentication.

Calls: audio/video implemented; no bundled TURN/default Android ICE servers. Direct ICE may expose addresses and cannot guarantee NAT traversal. Foreground/process-death limitations apply. The backend sees operational metadata. No anonymity, IP-hiding, read/persistence receipt or 100% security claim is justified.

## Physical publication gate — pending

Use current matching builds on a Mac browser and physical Android phone, initially same Wi-Fi with VPN off. Record actual source commit, APK hash, permission states and safe state/failure categories; never log tokens, raw keys, candidates/addresses, SDP or media.

- Web→Android and Android→Web audio/video: ringing, acceptance, connection, actual local/remote media, hangup/cleanup and a second call.
- Reject/cancel, microphone mute, camera toggle/front-back switch, remote hangup, identity verification/revocation and background/process-death behavior.
- Files/photos/documents in both directions: verify saved byte equality, sizes/filenames, explicit save, retry/reconciliation, cancellation, expiry, full-storage/provider failure and restart behavior. Add same-platform pairings as applicable.
- Verify real browser OPFS support, Android providers and device backup/transfer exclusions. Record unresolved results honestly.

## Before publishing

Finish physical gates, supply external signing credentials, verify monotonic Android versionCode and upgrade/signatures, hash artifacts, validate health/readiness and backup restoration/rollback, and obtain separate authorization for a public release tag/distribution. No debug-signed substitute is acceptable. Software validation is necessary but does not establish physical interoperability.

Known limitations remain visible: limited resume, browser/provider coverage, direct ICE/NAT, foreground calls, deferred thumbnails, EmojiCompat/system font-provider privacy behavior and opt-in environment-dependent tests. Root TypeScript configuration errors, Jest delayed shutdown and bundle-size warnings are distinct from new regressions. Global admission/storage ceilings, Android advisory coverage, image scanning and operational restore/rollback evidence remain future hardening.
