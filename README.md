# K3NCRYPT

**Private communication, with identity verification you control.**

K3NCRYPT is an open-source messenger in experimental beta. It provides device-held identities, encrypted one-to-one messaging, and explicit contact verification. Features and compatibility can change while the beta is being tested; do not rely on it as your only channel for critical communication.

**Project website:** [K3NCRYPT landing page](https://shonnay.github.io/k3ncrypt/)

**Try K3NCRYPT:** [Open the web app](https://k3ncrypt.onrender.com) · [Download the Android beta APK](https://github.com/SHOnnay/k3ncrypt/releases/download/v0.1.0-beta.2/K3NCRYPT-v0.1.0-beta.2.apk) · [View the source](https://github.com/SHOnnay/k3ncrypt)

## What is available

### Implemented

- Encrypted one-to-one messaging in the Web and Android beta clients, with relay-based delivery.
- Invitation-based contact setup. QR invitations are available in the clients; joining creates an unverified contact.
- Explicit identity fingerprint comparison and verification. An invitation or QR scan never verifies a contact.
- Local vault protection on supported clients.

### Experimental

- Voice calling is present in the beta for verified contacts. Network conditions and client compatibility affect availability. Video calling is not supported.
- The Android beta is distributed directly as an APK rather than through an app store. Its current release is [v0.1.0-beta.2](https://github.com/SHOnnay/k3ncrypt/releases/tag/v0.1.0-beta.2) (app version `0.1.0-beta`, version code `2`).

### Planned

- A dedicated desktop application is a future direction; no release date is set.

### Not yet available

- A short authentication string (SAS) verification ceremony.
- LAN/offline peer networking, direct or multipath transport, and site-to-site networking.
- Cryptographically authenticated receipts proving that a peer persisted or displayed a message. Relay or transport acknowledgements do not prove peer persistence.
- Video calls and dependable push notifications.

## Security model

Message encryption and identity keys are handled by client devices. The service relays encrypted message envelopes and supports delivery; it can still observe operational metadata such as routing information and connection timing. Keep devices and local passphrases protected.

Contact setup and trust are separate. Verify a contact by comparing identity fingerprints through a separate trusted channel and confirming the match in K3NCRYPT. Display names and invitation QR codes are not proof of identity. Verification helps detect identity substitution, but cannot protect a compromised device or every network and endpoint threat.

## Android beta

Download the APK attached to the official [`v0.1.0-beta.2` release](https://github.com/SHOnnay/k3ncrypt/releases/tag/v0.1.0-beta.2), or use the [direct APK download](https://github.com/SHOnnay/k3ncrypt/releases/download/v0.1.0-beta.2/K3NCRYPT-v0.1.0-beta.2.apk). Android may ask you to allow installation from your browser or file manager. Install only builds published by the official K3NCRYPT repository.

## For developers

- [Architecture overview](docs/ARCHITECTURE.md)
- [Engineering documentation](docs/K3NCRYPT_ENGINEERING_DOCUMENTATION.md)
- [Connectivity handoff and readiness gates](docs/connectivity/HANDOFF.md) — design and readiness notes; future connectivity paths are not implemented.
- [Local development](docs/LOCAL_DEVELOPMENT.md)
- [Security policy](SECURITY.md)

K3NCRYPT is based on [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee) and licensed under [Apache-2.0](LICENSE). See [FORK_NOTICE.md](FORK_NOTICE.md) for attribution.
