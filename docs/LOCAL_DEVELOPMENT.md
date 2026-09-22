# Local development

## Requirements

- Node.js 22.12 or newer.
- npm.
- MongoDB for durable lifecycle, membership, and persistence tests.
- Docker Desktop or Docker Engine for the container workflow.

## Environment

Copy `.env.sample` for local development. Production deployments should start from `.env.production.sample` and provide `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, `K3NCRYPT_TRUST_PROXY`, and a randomly generated `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` of at least 32 characters. Never commit a real secret.

The client uses `CHATE2EE_API_URL`, `CHATE2EE_ICE_SERVERS`, `CHATE2EE_ICE_TRANSPORT_POLICY`, and `CHATE2EE_ENABLE_DEBUG_LOGS`. The backend uses `PORT` and the Mongo/configuration variables above.

## Commands

```sh
npm install
npm run build-service-sdk
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
