# K3NCRYPT

**Private communication, with identity verification you control.**

K3NCRYPT is experimental personal-use beta software for family and a small circle of trusted friends. The current canonical source is `integration/main-product`. It is not a substitute for an independently audited messenger or your only channel for critical communication.

## Current implementation

- Web and native Android clients; encrypted one-to-one messaging and device-held identities.
- Invitation/QR contact setup and explicit local fingerprint verification. Pinned does not mean verified; identity replacement requires review.
- Audio and video calls for verified, unchanged contacts.
- Secure files, photos and documents using authenticated, identity-bound V2 attachment encryption.
- Existing protected local vault/session persistence; no raw attachment key is saved in plaintext.

**Physical Web↔Android calls and file interoperability remain pending.** Software test results do not establish device/network compatibility. The upcoming Android build is `0.1.0-beta.3`, version code `3`; a signed public artifact has not been produced for this source. Existing hosted builds may predate canonical source. Obtain future artifacts only from the official repository's release page; do not assume an older APK contains these features.

## Calls and files

Calls have no bundled TURN or checked-in default ICE servers. Android currently supplies an empty ICE-server list. Direct ICE can expose network addresses to the peer and may fail across NAT/firewall boundaries. Web ICE configuration is operator-managed; this product makes no IP-hiding promise. Android calls end when backgrounded; process death/tab closure cannot preserve a call.

Files are limited to **8 MiB**, **256 KiB chunks**, **32 chunks plus one manifest**, **two active transfers per account**, **12 MiB stored and incomplete reservations**, and **24-hour expiry**. Quotas include conservative ciphertext/encoding overhead. Photos use the same path; thumbnails are deferred. Exact sealed-object retry is available only in the same session. Process death or loss of previously sealed cache requires a new transfer. A receiver can discard partial output and download again from the existing protected reference. Files are saved explicitly after authentication; they are not automatically opened. Web files require supported OPFS/Web Locks APIs; Chromium has software disk-workspace evidence, not physical interoperability proof.

## Security expectations

Compare identity fingerprints through a separate trusted channel before explicitly verifying a contact. Invitations, display names, connectivity and transport do not establish trust. Calls and new file sends require verified-and-unchanged local authority. Keep devices, passphrases, signing keys and recovery material private. Compromised endpoints can expose content while unlocked.

The backend handles opaque encrypted material but observes operational metadata, including connection addresses/timing, routing and sizes. K3NCRYPT is not anonymous or metadata-free. Local Session is a separate experiment and is not part of this beta. Group messaging, dependable background calling/push, anonymous routing and peer-persistence/read receipts are not release claims.

## Build and operate

- [Local development](docs/LOCAL_DEVELOPMENT.md): Node/npm, Mongo and normal Web/backend builds.
- [Production Docker deployment](docker/README.md): compiled Node runtime, external Mongo, migrations and trusted HTTPS proxy.
- [Android build prerequisites](android/README.md).
- [Personal beta release gates](docs/RELEASE_GUIDE.md) and [Android signing/versioning](docs/ANDROID_BETA_RELEASE.md).
- [Call deployment/privacy](docs/CALL_DEPLOYMENT_GUIDE.md), [file implementation/limits](docs/MAIN_FILE_TRANSFER_IMPLEMENTATION_REPORT.md), [network privacy](docs/NETWORK_PRIVACY.md), [security policy](SECURITY.md).

[Project website](https://shonnay.github.io/k3ncrypt/) · [Official source and releases](https://github.com/SHOnnay/k3ncrypt)

Based on [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee), under [Apache-2.0](LICENSE). See [FORK_NOTICE.md](FORK_NOTICE.md).
