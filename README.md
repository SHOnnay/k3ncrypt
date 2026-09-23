# K3NCRYPT

Private communication you control.

## Overview

K3NCRYPT is an open-source privacy-first communication application for people and teams who want encrypted conversations, user-controlled device identity, and self-hostable infrastructure. Clients hold encryption private keys; servers provide transport, persistence, and authorization services.

K3NCRYPT is in beta development. Security features are actively reviewed; no security software can promise perfect protection.

## Fork attribution

K3NCRYPT is a fork of [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee), licensed under [Apache License 2.0](LICENSE). The original license and attribution notices remain in this repository.

K3NCRYPT extends the historical base with durable device trust and lifecycle management, resource-bound authorization proofs, private-network membership authority, encrypted media and storage boundaries, and privacy-focused communication controls. See [FORK_NOTICE.md](FORK_NOTICE.md).

## Features

- End-to-end encrypted messaging with opaque relay delivery.
- Encrypted attachments and voice/video communication boundaries.
- Local device identity and encrypted storage controls.
- No analytics by default and no third-party media upload requirement.
- Configurable relay, STUN/TURN, and user-owned private-network foundations.
- Durable device lifecycle, proof authorization, and membership checks.

## Security model

Clients create and hold device and encryption private keys. The backend can route ciphertext, store encrypted records, enforce signed lifecycle state, consume replay nonces, and verify short-lived authorization proofs. It is not intended to decrypt message, attachment, or call content.

The server still sees operational metadata needed to provide service, such as connection timing, routing identifiers, account/device references, and membership state. A compromised client, deployment, database, browser, or operating system remains outside client-side encryption protection. Read the security reports in `docs/` before relying on a deployment.

## Architecture overview

```text
Client UI and SDK
        ↓
Encrypted messaging, media, call, and trust boundaries
        ↓
Backend API, Socket.IO relays, lifecycle and membership authorities
        ↓
MongoDB durable metadata and replay state
```

The client owns identity and encryption operations. The service SDK coordinates conversations, proofs, synchronization, and private-network sessions. The backend validates authorization and transports opaque data. MongoDB stores lifecycle, membership, replay, and operational records.

## Development setup

Requirements: Node.js 22.12 or newer, npm, and MongoDB for persistence-dependent tests. Docker is optional.

```sh
cp .env.sample .env
npm install
npm run build-service-sdk
npm run dev
```

The client normally runs at `http://localhost:5173`; the API and relay use `http://localhost:3001`.

```sh
npm test -- --runInBand
npm run lint
npm run build-service-sdk
npm run client:build
npm audit
```

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for Mongo and environment details.

## Current status

K3NCRYPT is in private beta development. Device bootstrap, durable lifecycle authority, resource-bound proof authorization, private-network membership authority, browser voice/video calling, and offline encrypted-message replay validation are present. The current supported client is the browser application.

Native Android packaging, production TURN deployment, multi-relay operational testing, backup/restore exercises, and broader deployment validation remain before a wider release. See [docs/PHASE8_FINAL_RELEASE_READINESS.md](docs/PHASE8_FINAL_RELEASE_READINESS.md) for the Phase 8 freeze assessment.

## License

K3NCRYPT remains under Apache-2.0. See [LICENSE](LICENSE), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
