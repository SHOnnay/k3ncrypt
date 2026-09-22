# K3NCRYPT Phase 8A/8B Production Foundation Report

Date: 2026-09-22

## Deployment architecture

K3NCRYPT deploys as three separate operational concerns:

| Component | Image/service | Responsibility | Persistent state |
| --- | --- | --- | --- |
| Frontend | `docker/frontend.Dockerfile` | Immutable React/Vite build behind Nginx | None |
| Backend and relays | `docker/backend.Dockerfile` | API, legacy relay, authenticated sync relay, ciphertext attachment transport | None; Mongo is authoritative |
| MongoDB | Coolify managed Mongo service or managed external MongoDB | Room metadata, pre-key bundles, queued ciphertext, attachment ciphertext and metadata | Required, backed up |

The backend image compiles TypeScript and the service SDK in a build stage. Its runtime stage installs production dependencies only, runs as the unprivileged `node` user, and starts compiled JavaScript. The frontend image is an Nginx runtime containing only the static build output.

`docker/compose.production.yaml` is a local production-equivalent reference. Coolify should create separate Frontend, Backend, and Mongo services rather than using the legacy development Compose file.

## Coolify deployment order

1. Provision MongoDB with durable storage, authentication, and a backup schedule.
2. Set Backend production environment variables from the platform secret store. Do not commit `.env.production`.
3. Deploy the backend and confirm `/api/health` returns 200 and `/api/ready` returns 200.
4. Run `npm run migrate` once as a release job against the same Mongo database. Migrations are additive and idempotent; the application does not run schema changes automatically at startup.
5. Build and deploy the frontend with `CHATE2EE_API_URL` set to the public HTTPS backend URL. Set `K3NCRYPT_ALLOWED_ORIGINS` on the backend to the public HTTPS frontend origin.
6. Configure HTTPS and a reverse proxy. Set `K3NCRYPT_TRUST_PROXY=true` only where Coolify is the direct trusted proxy. Keep `K3NCRYPT_INSTANCE_COUNT=1`; multi-instance Socket.IO operation remains deliberately rejected until a reviewed adapter is supplied.

## Required configuration and secret handling

Use [.env.production.sample](/Users/sakibulhudaonnay/Documents/ChatGPT/chatapp/.env.production.sample) as a field reference. Required backend values are `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, and `K3NCRYPT_TRUST_PROXY=true`. Production startup rejects missing database configuration, absent or non-HTTPS browser origins, malformed public chat-link URLs, debug logging, and unsupported multi-instance deployment.

Mongo credentials belong only in Coolify secrets. K3NCRYPT does not introduce a server-side message-encryption key: private message, device, and attachment keys remain client-side under the existing Phase 6 model. TURN credentials, if used, are supplied as the frontend build-time ICE-server configuration and must be treated as service credentials. Do not enable `CHATE2EE_ENABLE_DEBUG_LOGS` in production.

## Health, logging, and abuse boundaries

- `GET /api/health` is a liveness endpoint and verifies that the process can answer traffic.
- `GET /api/ready` verifies Mongo connectivity, persistent storage, required migration indexes, and initialization of both relays; it returns 503 until dependencies are ready.
- HTTP API traffic has a broad per-address limiter; room/device-control endpoints retain their stricter route limiter; legacy and sync relays each have independent packet limits and token buckets.
- Process and request error paths return a fixed safe error response. Structured operational logs record event class, route, method, status, and error type only. The logging boundary excludes messages, ciphertext, keys, capabilities, proofs, authorization values, identities, and secrets.

## Database operations and recovery

Migrations in `backend/db/migrations.ts` only create required collections indexes. They do not drop collections, data, indexes, or rewrite security records. Run the migration job before switching traffic to a new backend release. If it fails, do not deploy that release; investigate against a database snapshot and retry only after correcting the cause.

Back up MongoDB using provider point-in-time recovery plus a tested encrypted daily logical backup. Retain backups under a policy appropriate to the deployment and separately protect backup credentials. Restore into an isolated Mongo instance, run the migration job, verify `/api/ready`, and switch the backend only after integrity and access checks. A database restore restores opaque ciphertext and routing metadata; it does not recover client private keys, bypass device trust, replace identities, or weaken recovery ceremonies.

## Remaining operational requirements

- Provision an authenticated TURN service before relying on calls across restrictive NATs; use `relay` ICE policy when a working TURN service is configured.
- Configure external uptime checks for `/api/health`, deployment gating for `/api/ready`, Mongo backup monitoring, disk/connection alarms, and log retention controls.
- The current relay is intentionally one backend instance. Horizontal scaling needs a separately reviewed Socket.IO adapter and shared rate-limit strategy.
- Perform a real Mongo restore drill and a Coolify staging deployment with production secrets before public launch.

## Validation results

| Gate | Result |
| --- | --- |
| Jest | Passed: 88 suites, 405 tests; 1 environment-gated test skipped |
| Service TypeScript | Passed |
| ESLint | Passed |
| Client production build | Passed: 212 modules transformed |
| SDK build | Passed |
| npm audit | Passed: 0 vulnerabilities at high threshold |
| Docker image builds | Passed: backend and frontend multi-stage images built locally |
| Diff check | Passed: no whitespace errors |

The root `tsconfig.json` remains unsuitable as a standalone validation gate because it combines CommonJS backend compiler settings with Vite client sources. The supported Phase 7 validation gates are the service TypeScript compiler and the client production build, which are run independently.
