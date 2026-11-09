# Local development

## Requirements

- Node.js 22.12 or newer.
- npm.
- MongoDB for durable lifecycle, membership, and persistence tests.
- Docker Desktop or Docker Engine for the container workflow.

## Environment

Copy `.env.sample` for local development. Production deployments should start from `.env.production.sample` and provide `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, `K3NCRYPT_TRUST_PROXY`, and a randomly generated `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` of at least 32 characters. Never commit a real secret.

The client uses `CHATE2EE_API_URL`, `CHATE2EE_ICE_SERVERS`, `CHATE2EE_ICE_TRANSPORT_POLICY`, and `CHATE2EE_ENABLE_DEBUG_LOGS`. The backend uses `PORT` and the Mongo/configuration variables above.

The browser vault always requires the normal local passphrase unlock. There is no development auto-unlock or passphrase-resume shortcut. Keep local account data in a dedicated development browser profile and do not store passphrases in environment files or browser storage.

## Commands

```sh
npm ci
npm run build-service-sdk
npm run build:backend
npm run dev
npm test -- --runInBand
npm run lint
npm run client:build
npm audit
```

For durable integration tests:

```sh
MONGO_URI=mongodb://localhost:27017 MONGO_DB_NAME=k3ncrypt \
  npx jest backend/security/durableDeviceTrust.mongo.integration.test.ts --runInBand
```

## Docker

The repository includes `docker/Dockerfile`, `docker/backend.Dockerfile`, `docker/frontend.Dockerfile`, and `docker/docker-compose.yaml`. Use the sample environment file and keep database credentials outside source control.

## Production build/start

Run `npm ci`, `npm run build:backend`, `npm run build-service-sdk`, and `npm run client:build` in this checkout. `npm run serve` and `npm run migrate` use compiled Node artifacts through the production launcher; they require the normal production environment and no development ts-node runtime. Rebuild after source changes. Run migrations before accepting traffic. See [Docker deployment](../docker/README.md) for external Mongo, HTTPS proxy and header/origin requirements. Dependencies must resolve inside this checkout; do not symlink node_modules to another worktree.

## Windows without Docker (native disposable MongoDB)

Docker Desktop needs a current WSL; where that is not available, use a native, disposable MongoDB that never runs as a Windows service.

1. Download the MongoDB Community 8.0 **zip** from `fastdl.mongodb.org/windows/` (check it against the published `.sha256`) and unpack its `bin` folder to `%LOCALAPPDATA%\k3ncrypt-mongo\bin`.
2. `powershell -File scripts/local-mongo.ps1 start` starts a single-node replica set `rs0` on **127.0.0.1:27117** (loopback only; data in `%LOCALAPPDATA%\k3ncrypt-mongo\data`). Port 27117 is deliberate so an existing MongoDB on 27017 is never touched. `stop` and `reset` are also available.
3. Mongo-backed Jest suites: `powershell -File scripts/test-mongo.ps1` (the Windows twin of `scripts/test-mongo.sh`; it skips `fileLedger.mongo`, which restarts a Docker container).
4. E2E: `K3NCRYPT_M0_NATIVE_MONGO=1 bash scripts/m0-e2e.sh [specs]` from **Git Bash**. Install the browser once with `npx playwright install chromium`.
5. Unit tests that start the app in production mode read the root `.env`; if you copied `.env.sample`, `CHATE2EE_API_URL` is `http://localhost:3001` and production-mode tests fail with "Web CSP requires an HTTPS API origin". Run them with `CHATE2EE_API_URL=https://relay.test.invalid`.
