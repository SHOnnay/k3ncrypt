# Phase 3.6 isolated Web/backend staging plan

Status: prepared only; no staging deployment is authorized or performed.
Application candidate: `3190a7e1049d7b32517224ffbecf389291b7e841` (the four approved Phase 3 corrections plus a tested admission-rate error-copy correction).
The n=5 matched benchmarks used `6dc2cda10af488ac2f419624bd236c6773de5efa`; the subsequent fix changes only a Failed-state label.
Rollback application baseline: `871fa99d0ae94c88239f6c392325f224d2c085c4`.
A later validation-only commit may add this plan, tests and aggregate results without changing the application tree.

## Smallest environment

Use the existing Mac and Docker; an external paid service is not necessary for this gate.
The Phase 3.6 benchmark uses one local backend, one Vite client, one Chromium worker,
and a dedicated `mongo:7` container with 1 CPU, 1.5 GiB RAM, loopback-only random port,
and an anonymous `/data/db` volume. Every fixture uses new browser contexts and
new account identities. `/api/ready` requires persistent MongoDB and the existing
indexes; a volatile fallback does not satisfy readiness.

This validates application behavior in test/development mode. It does not validate
Render cold starts, production TLS, operating-system scheduling or real device networks.

For the next production-mode staging gate, after approval:

- Export the exact tracked candidate into a new temporary build context; never
  build from an owner's dirty checkout or copy `.env`, signing material or profiles.
- Build the existing `docker/Dockerfile`, supplying no external API origin so the
  bundled Web client and backend use one origin. Keep ICE configuration unchanged.
- Label the image with the full source SHA and record image digest, backend build
  hash, `client/dist/index.html` hash and referenced asset hashes in a local manifest.
  Verify the served HTML/assets against these hashes; health alone is not revision evidence.
- Run a single application process, initially 512 MiB container memory with a
  320 MiB Node heap and 1 CPU. Treat OOM or restart as a failed acceptance check;
  do not silently raise memory beyond the intended Render-sized comparison.
- Use a separate authenticated MongoDB container/database and new random staging
  credentials, retained in a mode-0600 temporary environment file outside Git.
  Run only the existing migration command against that disposable database.
- Use a Docker internal network. Publish only a loopback HTTPS proxy port;
  MongoDB and application ports must remain private to that network.
- A local HTTPS reverse proxy may use `phase36.localhost` and a temporary
  certificate accepted only by the disposable automated browser. Do not install
  a system CA or change the application certificate policy. Native phone testing
  instead requires an explicitly approved, phone-reachable HTTPS endpoint with
  a normally trusted certificate.
- Configure `NODE_ENV=production`, the disposable `MONGO_URI`/`MONGO_DB_NAME`,
  staging `CHAT_LINK_DOMAIN` and `K3NCRYPT_ALLOWED_ORIGINS`, a newly generated
  `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET`, `K3NCRYPT_INSTANCE_COUNT=1`, and the
  existing explicit trusted-proxy policy. Backend ingress must be possible only
  through that known proxy. Set debug logging off.
- Do not provide Firebase credentials or enable FCM. These four application commits
  do not import the separate F1b notification architecture.
- Keep existing limits: 8 MiB plaintext, 256 KiB chunks, 32 chunks, two active
  transfers, 12 MiB reserved storage per sender, bounded record counts and expiry;
  aggregate API and mutation rate limits remain enabled.

Estimated runtime budget: 512 MiB application + 1.5 GiB MongoDB + up to 128 MiB
proxy, plus a separate 0.5–1 GiB Chromium/test budget. Allow roughly 2 GiB of
additional build workspace/cache and enforce a disposable-volume disk budget.
These are proposed limits, not measured production capacity or a cost quote.
Local execution uses existing tools and needs no new cloud service.

## Acceptance sequence

1. Verify source/image/asset hashes and `/api/ready`, and confirm no production
   hostname, database, credential, identity or traffic is configured.
2. Create two independent disposable accounts through the real UI. Invite, accept,
   compare and explicitly verify identities. Exercise encrypted text and restart.
3. Run five isolated samples per standard size and separate sustained sequences;
   verify output hashes. Include 4 MiB and the exact 8 MiB boundary, plus oversize,
   quota, 429/Retry-After, transient failure, cancellation and sequential downloads.
4. Record only relative timings, byte counts, operation categories, response codes,
   retry counts and aggregate memory. Never retain request bodies, headers, URLs,
   room/contact IDs, tokens, private filenames or keys.
5. Exercise wrong-room selection supersession, vault lock/identity lifecycle,
   persistence and offline message recovery with fresh test identities.
6. Simulate idle by closing clients and reopening after a bounded delay. Then
   separately restart the application process while retaining only this disposable
   database, verifying readiness, reconnection and ciphertext survival. Neither test
   simulates Render's provider-managed cold-start duration.
7. Inspect container peak memory and restart count, request latency and all 429
   categories. Fail on indefinite progress, bad hashes, unauthorized data, or
   false message-delivery success.

## Rollback and disposal

The four candidate changes add no database schema/index or protocol migration.
Existing required indexes must still be present; fresh staging needs the existing
idempotent setup, not a new migration. Roll back by stopping the one candidate
process, confirming that its recorded container/process is stopped and no longer
listens, and starting the separately built exact baseline image against the staging
database. Do not run two relay versions concurrently. Preserve the old image and keep request limits unchanged.
Verify readiness and the same disposable identity/message/file tests again.

Disposal must name only the staging containers, anonymous volumes, temporary
secrets, browser contexts and build context created for this gate. Do not use broad
Docker prune, Git cleanup, or remove an existing shared worktree/database.

## Android decision

Beta 21 (`4899f2ebef38906e8511dabca19efb1521cbc59d`) already has editable HTTPS
service/socket addresses in Advanced settings. However, do not redirect the owner's
installed identity/vault into a disposable backend. Use an Android OS test profile
or other authorized disposable app data compartment if available, with new accounts.
A stock Beta 21 private build requires trusted HTTPS and cannot access the Mac's
loopback-only staging from a physical phone.

If that isolation and trusted endpoint cannot be provided, a separate diagnostic
application ID using disposable accounts can be proposed later. It would not be
an in-place update to the owner's app and is not needed for this browser/backend
investigation. Any eventual normal update must keep `com.k3ncrypt.app`, use a
versionCode above 21 and reproduce the established signer certificate exactly;
verify the resulting APK rather than relying on Gradle configuration alone.
No Android source correction in this phase currently justifies Beta 22.
