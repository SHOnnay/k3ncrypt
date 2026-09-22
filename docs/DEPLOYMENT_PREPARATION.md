# Deployment preparation

## Required services

- Backend API and Socket.IO relay processes.
- A separately managed MongoDB deployment with persistent storage.
- A frontend served over HTTPS.
- STUN/TURN infrastructure when the selected call topology needs it.

Run migrations with `npm run migrate` before sending traffic. Treat lifecycle and membership collections as security-sensitive metadata.

## Secrets and configuration

Provide `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` as a randomly generated secret with at least 32 characters. Also configure Mongo credentials, `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, and `K3NCRYPT_TRUST_PROXY`. Keep secrets in the deployment platform’s secret store, never in Git or client bundles.

## HTTPS and network controls

Terminate HTTPS at a trusted proxy, configure exact allowed origins, restrict MongoDB access to the backend, and expose only required HTTP/WebSocket ports. Do not run production with debug logging enabled.

## Backups and recovery

Back up MongoDB using encrypted, access-controlled storage and test restoration before beta launch. Protect lifecycle, membership, and replay data from unauthorized writes. A restore must preserve trust state or fail closed until reconciled.

## Operational preparation

Complete health/readiness monitoring, log redaction review, rate-limit tuning, dependency updates, container image scanning, and a controlled rollback plan before public deployment. This repository does not claim those controls are complete.
