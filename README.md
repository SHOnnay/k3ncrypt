# K3NCRYPT

**Private one-to-one communication with identity verification you control.**

K3NCRYPT is an open-source Web and Android messaging project for a person and a small circle of trusted contacts. You create an account on your device, connect using an invitation, and decide which peer identities you have verified. The service relays encrypted traffic; it is not the authority that decides whom you trust.

> **Beta status:** `main` contains the approved Web Beta release candidate (`7638f36`). This is not an independent security certification or a guarantee that a hosted service is running this commit. The current product status, physical-test gaps and release gates are in [`docs/PRODUCT_STATUS.md`](docs/PRODUCT_STATUS.md). Use K3NCRYPT only with trusted testers and keep another way to contact people for important communications.

## What works today

These capabilities are implemented and have software-test coverage. Local Web acceptance has also exercised messaging, conversation restoration, calls and protected file transfer. That evidence does not replace testing on every browser, device and network.

| Capability | Status and boundary |
| --- | --- |
| One-to-one Web messaging | Encrypted conversations, saved history, multiple conversations, background delivery and offline replay are implemented. Legacy and modern conversations retain their protocol identity. |
| Identity and verification | Modern conversations support device identities, pinned identity continuity, explicit local verification and changed-identity review. A saved contact or pin alone is not verified. Compare fingerprints through a separate trusted channel. |
| Audio and video calls | Implemented for supported Web flows and verified contacts. Calls use WebRTC; no default STUN/TURN service is bundled, so calls can fail across some networks and direct ICE can reveal network addresses to the peer. |
| Encrypted files | Protected file transfer is implemented, including explicit Send, authenticated encrypted chunks and recipient checks. Web Beta transfers are limited to 8 MiB and expire; see the [file-transfer report](docs/MAIN_FILE_TRANSFER_IMPLEMENTATION_REPORT.md). |
| Local encrypted vault | The Web client encrypts protected records at rest and requires the user to unlock with their passphrase. There is no server-side passphrase recovery. |
| Android client | Android source and software tests are included. Signed personal-beta artifacts and physical Web↔Android call/file interoperability remain pending. |

### Experimental or not available

- Multiplexed background delivery (Mux) is implemented behind coordinated, fail-closed gates. It remains disabled by default; production activation requires a separate release decision and matching server and Web build settings.
- The Local Session work is a separate experimental branch, not part of the supported beta path in `main`.
- Group chat, bundled TURN infrastructure, dependable background calling/push, anonymous routing and guaranteed read receipts are not available. Future work is not a delivery commitment.

## How the security model works

### Encryption and identity

The modern conversation path uses device-held Vodozemac/Olm session state, signed first-contact material, and encrypted local persistence. Users must still verify a contact's displayed identity fingerprint independently. Identity changes invalidate verification and require review; transport, a successful handshake, display name, or server response does not grant trust.

K3NCRYPT also retains a legacy invite-secret protocol for compatibility. That protocol derives separate message and signaling keys from the invitation secret and uses AES-GCM. It does **not** provide forward secrecy or post-compromise recovery. Existing conversations remain bound to their stored protocol; do not assume every older invitation has the modern protocol's properties.

### What the service can see

The backend routes and temporarily stores opaque encrypted message or attachment data. It can observe operational metadata needed to provide the service, including connection and timing information, routing identifiers, event type, sizes, delivery state and network addresses. K3NCRYPT does not provide anonymity, traffic-analysis resistance or an IP-hiding guarantee. WebRTC ICE configuration affects the network information peers and configured ICE services can observe.

The local vault protects stored records while locked. It cannot protect an unlocked device from malicious same-origin code, a compromised browser, extensions, operating system or physical access. See the [security model](docs/K3NCRYPT_SECURITY_MODEL_V1.md), [secure-storage design](docs/SECURE_STORAGE.md), [network privacy notes](docs/NETWORK_PRIVACY.md) and [security policy](SECURITY.md).

## Architecture

- **Web:** React, TypeScript and Vite.
- **Application/service layer:** TypeScript SDK for conversations, crypto/session handling, transport, delivery and attachments.
- **Backend:** Node.js, Express and Socket.IO, with MongoDB for durable application records and offline delivery.
- **Cryptography and local persistence:** browser cryptographic APIs, an Olm/Vodozemac Rust/WebAssembly component, and an encrypted IndexedDB vault.
- **Calls:** WebRTC media with encrypted application signaling.
- **Android:** Kotlin and Gradle modules for the native client and its storage/crypto boundaries.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for component boundaries and [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for the supported developer setup.

## Run locally

### Requirements

- Node.js 22.12 or newer and npm.
- A disposable local MongoDB for durable backend and integration-test workflows.
- Docker Engine/Desktop if using the repository's container setup.

### Web and backend development

```sh
npm ci
cp .env.sample .env
```

In a separate terminal, a disposable MongoDB can be bound to loopback with the repository's Mongo 7 development version:

```sh
docker run --rm --name k3ncrypt-dev-mongo -p 127.0.0.1:27017:27017 mongo:7.0
```

Before starting the app, edit the untracked `.env`: set `MONGO_URI` to `mongodb://127.0.0.1:27017`, choose a development-only `MONGO_DB_NAME` such as `k3ncrypt_dev`, and review the other sample values. Stop the disposable database with Ctrl-C. Do not copy production credentials or connect local tests to production data.

```sh
npm run dev
```

This starts the Vite client and the development backend. For Mongo-backed tests, disposable fixtures, production builds, Docker and additional configuration details, follow [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).

## Configuration names

The repository provides `.env.sample` and `.env.production.sample` as **name/checklist references only**. They contain no usable production credentials. Never commit actual secrets.

| Purpose | Variables |
| --- | --- |
| Backend/runtime | `NODE_ENV`, `PORT`, `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, `K3NCRYPT_TRUST_PROXY`, `K3NCRYPT_INSTANCE_COUNT`, `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET`, `K3NCRYPT_MAINTENANCE_MODE` |
| Web build/runtime configuration | `CHATE2EE_API_URL`, `CHATE2EE_ICE_SERVERS`, `CHATE2EE_ICE_TRANSPORT_POLICY`, `CHATE2EE_ENABLE_DEBUG_LOGS` |
| Optional Mux gates | Server: `K3NCRYPT_MUX_MESSAGE_DELIVERY`, `K3NCRYPT_MUX_PRODUCTION_OPT_IN`; Web build: `VITE_K3NCRYPT_MUX_STAGE1`, `VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN` |

Mux is not enabled by default. Web `VITE_` values are compiled into the client bundle, so they must be coordinated with backend runtime settings. Never put credentials or long-lived secrets in Web build variables. For details, see the [private-beta release runbook](docs/PRIVATE_BETA_RELEASE_GATE_RUNBOOK.md).

## Test and build

From the repository root:

```sh
npm test -- --runInBand
npm run lint
npm run build:backend
npm run build-service-sdk
npm run client:build
```

Mongo-gated tests need an isolated disposable database and may be skipped when it is not configured. Set them up only as described in [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md). Android unit tests and debug builds are documented in [`android/README.md`](android/README.md).

## Deployment

The production backend is intended to run as a **single Node instance** with external persistent MongoDB and a trusted HTTPS proxy. Multi-instance Socket.IO delivery is not supported. A GitHub branch update alone does not establish which commit a hosted service runs.

Production rollout requires an owner-operated maintenance window, verified backup and restore path, compatible database migration, deployment identity checks, and message/reconnect acceptance. Read the [single-instance release checklist](docs/WEB_BETA_SINGLE_INSTANCE_RELEASE_CHECKLIST.md), [private-beta release runbook](docs/PRIVATE_BETA_RELEASE_GATE_RUNBOOK.md) and [Docker deployment guide](docker/README.md). Do not deploy or run migrations from an ordinary local development session.

## Limitations and next gates

- The beta is not independently security-certified; automated or local tests are not proof of absence of vulnerabilities.
- Modern identity authenticity still depends on users comparing fingerprints through another trusted channel.
- Legacy invite-based sessions do not provide forward secrecy or post-compromise recovery.
- Web↔Android physical messaging, call-media and file-transfer interoperability has not completed its release gate; current Android signing/publication gates are also pending.
- Calls may fail behind NAT/firewalls without a working operator-configured TURN service. Android calls are foreground-only and do not survive process death.
- Browser storage, installed extensions, same-origin compromise and endpoint compromise remain security boundaries users must account for.
- Group conversations, dependable push/background calling and anonymous routing are not currently implemented.

The current readiness matrix is maintained in [`docs/PRODUCT_STATUS.md`](docs/PRODUCT_STATUS.md); release acceptance steps are in [`docs/PRIVATE_BETA_RELEASE_GATE_RUNBOOK.md`](docs/PRIVATE_BETA_RELEASE_GATE_RUNBOOK.md).

## Security reports and contributions

Please report suspected vulnerabilities privately before filing a public issue. Follow [`SECURITY.md`](SECURITY.md); do not include message content, credentials, private data or live-user identifiers. Security-sensitive changes involving identity, cryptography, persistence, relays, files, calls or device trust need focused tests and security review.

For ordinary contributions, see [`CONTRIBUTING.md`](CONTRIBUTING.md). Keep changes focused, add tests for behavior changes, and report validation results and known limitations.

## License and attribution

This repository includes the [Apache License 2.0](LICENSE) and is based on [`muke1908/chat-e2ee`](https://github.com/muke1908/chat-e2ee). See [`FORK_NOTICE.md`](FORK_NOTICE.md) for attribution.

[Project website](https://shonnay.github.io/k3ncrypt/) · [Source repository and releases](https://github.com/SHOnnay/k3ncrypt)
