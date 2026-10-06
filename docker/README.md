# Production container deployment

Use `docker/backend.Dockerfile` from this repository. `docker/Dockerfile` is an identical compatibility entry point; publishing uses the backend path. Do not use the historical upstream image. This produces a single-instance compiled Node backend with Web assets, not a development `ts-node` runtime. MongoDB remains externally configured; this compose file does not provision or alter a database.

## Build

From the repository root:

```sh
docker build --pull -f docker/backend.Dockerfile -t k3ncrypt-personal-beta:local .
```

Node 22 is pinned by digest; npm uses the lockfile and ignores install scripts. Runtime installs root production dependencies without development/workspace packages. The build compiles `dist/index.js`, shared backend modules and `dist/scripts/migrate.js`, and produces `client/dist`. No image is pushed by this command.

For a separate API origin, pass the public HTTPS `CHATE2EE_API_URL` as a build argument **and** the same runtime setting so the compiled Web client and CSP agree. ICE arguments are public browser configuration, never an appropriate place for long-lived secrets; default ICE servers are empty. Same-origin deployments must route API/Socket.IO at the trusted TLS proxy to this backend.

## External runtime configuration

Create a production environment file outside Git and outside the build context using `.env.production.sample` as a checklist. Set actual Mongo URI/database, public HTTPS `CHAT_LINK_DOMAIN`, exact `K3NCRYPT_ALLOWED_ORIGINS`, `K3NCRYPT_TRUST_PROXY=true`, one instance, and a generated device-proof secret. No credentials belong in Docker build arguments, image layers or logs.

```sh
# Paths are placeholders for an operator-controlled file outside the checkout.
docker run --rm --env-file /path/to/production.env   k3ncrypt-personal-beta:local node dist/scripts/migrate.js
docker run -d --name k3ncrypt-personal-beta   --env-file /path/to/production.env -p 127.0.0.1:3001:3001   k3ncrypt-personal-beta:local
```

Apply additive migrations before traffic. `/api/health` is process liveness; `/api/ready` checks Mongo, required indexes and all relays. Missing configuration or unavailable persistent Mongo stops production startup. Bound localhost is the proxy-facing container host listener, not a client endpoint; expose HTTPS through the trusted proxy only. A remote proxy requires a restricted private interface/network rather than opening the backend publicly. It must overwrite forwarded headers: the application trusts exactly one hop.

Compose alternative:

```sh
K3NCRYPT_ENV_FILE=/path/to/production.env docker compose -f docker/docker-compose.yaml up --build -d
```

Compose interpolation for build args comes from the invoking environment; keep it aligned with runtime configuration. Run the one-off migration command first. Database network access must be restricted and persistent backups/restore tested externally.

## Static-only frontend

`docker/frontend.Dockerfile` builds nginx static assets and renders its CSP from the same TypeScript policy generator as Express. Set `CHATE2EE_API_URL` for a separate backend, or `CHAT_LINK_DOMAIN` for explicit same-origin WSS. Provide the same public origins when building the client/backend. Terminate TLS and route the API appropriately at an external proxy. Nginx does not proxy to Express itself, so security headers are emitted once per response. Avoid adding duplicate CSP at the TLS edge.

CSP permits local scripts plus `wasm-unsafe-eval` for existing WebAssembly; no inline JavaScript or JavaScript eval is enabled. Existing React inline style attributes require `style-src-attr 'unsafe-inline'`; stylesheet elements remain local. Blob media/download URLs and data/local QR images are permitted. Connect sources are self plus the exact configured HTTPS/WSS API origin. Camera/microphone permissions are limited to self; frames, objects, form submissions and unrelated capabilities are denied. CSP does not replace TLS, peer verification or endpoint security.

## Build context hygiene and publication

`.dockerignore` excludes local env files, keys/certificates/signing material, Android, Git/worktree metadata, node_modules, build output, native build caches and test fixture directories. Keep all deployment secrets outside the context even with these exclusions. Do not put secrets under arbitrary unrecognized filenames.

Local build/start validation is not image publication or a physical interoperability result. Signed Android builds, physical Web↔Android call/file tests and separate public-release authorization remain pending. Container scanning, backup/restore/rollback evidence and global admission/storage ceilings remain visible future work.
