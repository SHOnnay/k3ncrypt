# K3ncrypt

K3ncrypt is an experimental two-person private messenger. It currently offers disposable invite-based conversations, authenticated encrypted message/signaling envelopes, and WebRTC audio calls.

> K3ncrypt is under active security architecture work. The current legacy invite session uses HKDF-SHA-256 and AES-256-GCM, but it does **not** yet provide cryptographic identities, forward secrecy, post-compromise recovery, encrypted history, or account recovery. Read [the architecture](docs/ARCHITECTURE.md) and [initial audit](docs/SECURITY_AUDIT_INITIAL.md) before relying on it.

## What works

- Two-person invitation flow; the 256-bit secret is generated in the browser and carried in the URL fragment.
- Separate message and signaling keys derived with HKDF-SHA-256.
- AES-256-GCM authenticated envelopes with no plaintext fallback.
- Authentication and replay validation before delivery acknowledgement.
- Bounded out-of-order delivery handling.
- Opaque Socket.IO relay with payload bounds and rate limiting.
- Explicit WebRTC ICE/TURN configuration; no public STUN server by default.
- No analytics, remote fonts, or third-party media uploads.

## Run locally

Requirements: Node.js 22.12+ (required by the current Vite toolchain) and npm.

```sh
cp .env.sample .env
npm install
npm run build-service-sdk
npm run dev
```

The client runs at `http://localhost:5173`; the relay/API defaults to `http://localhost:3001`.

For TURN or relay-only calling, configure the values documented in [network privacy](docs/NETWORK_PRIVACY.md).

## Verify

```sh
npm test -- --runInBand
npm run build-service-sdk
npm run client:build
npx playwright test
npm audit
```

## Architecture and roadmap

- [Current boundaries](docs/ARCHITECTURE.md)
- [Phase 1 completion](docs/PHASE1_COMPLETION.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Network privacy](docs/NETWORK_PRIVACY.md)
- [Dependency security](docs/DEPENDENCY_SECURITY.md)
- [Vodozemac integration plan](docs/VODOZEMAC_INTEGRATION.md)

Persistent identity, secure storage, recovery, attachments, offline mailboxes, native clients, and reviewed ratcheted messaging are future phases. Tor, Bluetooth, Wi-Fi Direct, LAN transport, MLS groups, and biometrics are not implemented.

## Provenance and license

K3ncrypt preserves the history and required notices of its historical base, [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee). The project is licensed under Apache-2.0; see [LICENSE](LICENSE).
