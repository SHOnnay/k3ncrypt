# K3NCRYPT

Private messages, calls and files between you and a few people you trust.

K3NCRYPT is a web app and an Android app for one-to-one conversations. You create a private space on your own device, invite someone with a one-time invitation, and check that it is really them by comparing a security number or scanning a code. The server only passes encrypted data along; it doesn't decide whom you trust.

**Status: private beta.** It is used by a small group of invited testers. It has not had an independent security audit. Keep another way to reach people for anything important.

## How it keeps things private

- **Encrypted on your device.** Messages, calls and files are encrypted before they leave your device and decrypted only on the other person's device. The server stores encrypted data it cannot read, and only until it is delivered or expires.
- **You decide who is verified.** A new contact starts as unchecked. You check them by comparing a 30-digit security number, in person or on a call, or by scanning their code. If their keys change, the app tells you and asks you to check again. Calls and files need a checked contact.
- **Your private space is locked with your passphrase.** Saved chats are encrypted on the device. The passphrase is never sent anywhere, and there is no way to recover it: if you forget it, the data on that device can't be opened.
- **What the server can see.** It can see that devices connect, when, from which network address, how much data they send and which encrypted conversation it belongs to. It can't see names, message text, files or call content. K3NCRYPT doesn't hide who talks to whom or when.
- **Calls.** Calls connect directly between the two devices when possible. No relay server for calls is set up by default, so some networks block calls, and the other person's device can see your network address.

### The web version's limitation

A web app runs the code the server sends each time you open it. If the server were taken over, it could send changed code that leaks your messages, and you would have no easy way to notice. The Android app doesn't have this problem, because its code is installed once and signed. For the strongest protection, use the Android app; use the web version when convenience matters more.

Other limits: an unlocked device, a malicious browser extension or a compromised operating system can read what you can read. Details are in [`SECURITY.md`](SECURITY.md) and [`docs/K3NCRYPT_SECURITY_MODEL_V1.md`](docs/K3NCRYPT_SECURITY_MODEL_V1.md).

## Run it locally

Requirements: Node.js 22.12 or newer, npm, and Docker (for a throwaway local database).

```sh
npm ci
cp .env.sample .env
docker run --rm --name k3ncrypt-dev-mongo -p 127.0.0.1:27017:27017 mongo:7.0
```

In `.env`, set `MONGO_URI=mongodb://127.0.0.1:27017` and a development database name such as `MONGO_DB_NAME=k3ncrypt_dev`. Then, in another terminal:

```sh
npm run dev
```

This starts the web app and the server. Open the address Vite prints. Never point a local setup at real user data. More options are in [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md); the Android build is in [`android/README.md`](android/README.md).

## Test

```sh
npm run lint
npm test
bash scripts/m0-e2e.sh
```

- `npm test` runs the unit tests. Tests that need a database are skipped unless a local test database is configured.
- `scripts/m0-e2e.sh` runs the browser tests (Playwright) against a throwaway local database in Docker. Pass spec files to run only some, for example `bash scripts/m0-e2e.sh e2e/golden-path.spec.ts`.

## How it's built

- Web: React, TypeScript, Vite.
- Shared client library (`service/`): conversations, encryption, delivery, files.
- Server: Node.js, Express, Socket.IO, MongoDB.
- Encryption: Vodozemac (Olm) compiled to WebAssembly, the browser's Web Crypto, and Argon2id for the passphrase.
- Android: Kotlin, with the same encryption library in Rust.

## Reporting a security problem

Please report it privately first, as described in [`SECURITY.md`](SECURITY.md). Don't include messages, passwords or other private data in the report.

## Licence

Apache License 2.0, see [`LICENSE`](LICENSE). K3NCRYPT started as a fork of [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee); see [`FORK_NOTICE.md`](FORK_NOTICE.md).

The web QR scanner uses zbar-wasm, which is licensed under the LGPL 2.1. It is shipped as a separate, replaceable file, with its licence text at `/licenses/zbar-wasm-LGPL-2.1.txt`.
