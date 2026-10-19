# Phase 3.9 — isolated phone HTTPS staging proposal (not exposed)

This is a plan for owner approval. No LAN listener, router change, tunnel, public
service, domain, certificate issuance or cloud database has been created.
Production, the existing diagnostic APK and installed Android data remain untouched.

## Recommended minimum: owner's Mac + same-Wi-Fi phone

Use the stabilization source containing the independently reviewed BSON fix and
Phase 3.8 revocation fences. Pin the exact runtime source/image label and record
compiled backend hashes plus the served HTML/JS/CSS/WASM hashes before testing.
A loopback browser certificate exception is **not** acceptable for the Android app.

1. Owner approves one hostname, one LAN HTTPS port, the test phone's source address,
   a short test window (for example 60 minutes) and cleanup ownership. Do not reuse
   the production hostname. Confirm the router permits phone-to-Mac LAN connections.
2. Use an owner-controlled DNS name resolving to the Mac's current LAN address,
   plus an Android-system-trusted TLS certificate for that name. DNS-01 can validate
   a domain without exposing its web server publicly. Perform the DNS challenge
   separately; do not put broad DNS credentials in the backend. Certificate
   transparency/DNS reveal the staging hostname; it is not a secret or access control.
3. Terminate HTTPS at a reviewed reverse proxy bound **only** to that LAN address,
   not all interfaces. Allow only the test phone and Mac sources; deny every other
   source before proxying HTTP or WebSocket upgrades. No WAN forwarding, UPnP or
   router/firewall weakening. If current firewall policy disallows this, obtain a
   separate explicit permission decision; do not disable it.
4. Keep application and authenticated disposable Mongo on an internal Docker network,
   with no published application/Mongo port and no route to production data. Use
   fresh independent database users, database name and device-proof HMAC secret.
   Keep secret files outside Git with restrictive permissions. No production secret,
   vault, identity enrollment or existing user account may be imported.
5. Proxy normal HTTPS and all required Socket.IO upgrade/polling paths. Preserve
   authorization headers. Bind the origin allowlist and CHAT_LINK_DOMAIN to the exact
   stage origin. Use one Node process/instance, 512 MiB application memory, a bounded
   Node heap (tested at 320 MiB), unchanged file quotas and API rate limits. FCM
   remains inactive: no provider credentials or production Android configuration.
   These backend candidates contain no newly integrated Firebase work.
6. For the V2-only scope load `scripts/staging/attachmentPolicy.cjs` in the proxy and
   reject a request/upgrade with 404 unless `allowStagingPath(req.url)` returns true.
   This is an additional boundary, **not authentication**. Allow only the actual V2
   endpoint shapes, not an entire `/v2` prefix: unknown V2-shaped paths can otherwise
   fall through Express into legacy handlers. The checked-in policy enforces this.
   It blocks canonical, case-variant and ambiguous legacy paths; V2 still performs normal room and signed
   device authorization. Keep the backend unreachable directly, including other
   hostnames, or the boundary can be bypassed. Production does not load this policy.
7. Run the existing migrations/index creation **only on the new disposable database**.
   Do not omit legacy index setup: shared readiness still checks those indexes and
   shared admission constructs the legacy service, although V2 never reads its bytes.
   No new migration is introduced by Phase 3.9 or the security-only hotfix.
8. Verify HTTPS from the phone without warnings, both WebSocket and polling paths,
   /api/ready, legacy-route denial, exact revision and all authorization failures.
   Expire the exposure automatically at the end of the approved window; stop the
   proxy and application even if a test is interrupted. Do not rely on an obscure URL.

With existing Mac/Docker and an owned domain there is no added hosting purchase.
Domain/DNS availability, certificate issuance and any required tooling remain
unconfirmed. Do not buy a domain or install tooling without owner approval.

## Alternative: temporary external HTTPS stage

Use only if local DNS/TLS/LAN requirements cannot be met. Requires separate approval
for the host, endpoint and every integration's repository access. A free service is
not inherently private and may share quotas with production.

- A **separate** service, disposable Mongo, independent credentials/secrets, exact
  source/image pin and single instance; never reuse the existing Render service or
  production Mongo database/user.
- Provider-managed public TLS or another Android-trusted certificate. Restrict ingress
  to the owner's approved public egress IP(s), including the provider's direct origin,
  custom domain, health-path exceptions and every WebSocket path. Require a proven
  access-control mechanism at the host/edge or a separately reviewed reverse proxy.
  No browser-only login, Basic Auth or secret custom header can be assumed compatible:
  the existing diagnostic's API client does not supply staging-specific credentials.
- Mongo must be private/restricted to the staging backend with TLS/authentication,
  bounded storage and no public unauthenticated listener. Do not expose the Mac's Mongo.
- Same 512 MiB / one-process / V2-only route policy / original rate-limit and file
  limits. Host limits, account capacity and a hard end-of-test shutdown must be approved.
- Render documents managed TLS on Free services, idle spin-down after 15 minutes,
  roughly one-minute wake-up and ephemeral disks. Workspace free hours/bandwidth/build
  quotas can affect other services; therefore free capacity is **not assumed safe**
  for the existing production workspace. Separate disposable Mongo hosting and its
  cost/limits must be established first. No paid service or spend is authorized.

## Existing diagnostic APK: no rebuild needed

Read-only inspection of `codex/android-stabilization-diagnostic-apk` at
`c1e8c250dc9a0d5303d938d2910ea363f3b0e979`:

- Application ID `com.k3ncrypt.app.stabilization`, separate storage and identity.
- Backend/socket defaults are blank. Runtime Advanced Connection Settings validate
  origin-only HTTPS (no credentials/path/query/fragment); use the approved stage
  HTTPS origin for both fields before creating **disposable** accounts.
- `K3ncryptApi.file` only emits `/api/attachments/v2/...` and the explicit version-2
  header. It does not call legacy create/chunk/chunks routes.
- Release TLS uses platform trust, not debug user-CA overrides. No trust bypass,
  cleartext HTTP, certificate exception or APK rebuild is proposed.
- Firebase auto-init is false and the diagnostic build forbids Firebase resources.
- Do not link or import the owner's Beta 21 account. The diagnostic may coexist with
  it; leave that application's storage and identity unchanged.

## Acceptance and complete cleanup

Create one fresh Web and one fresh diagnostic account. Accept, pin and explicitly
verify the invitation. Test encrypted text both directions, files at 23 KiB,
170 KiB, 307 KiB, 1.2 MiB, 4 MiB and 8 MiB, one repeated 8 MiB transfer, download
hash/integrity, cancel/retry and explicit Save cancellation, offline/reconnect and
app lock/unlock. Record only stage durations, bytes/chunks, status categories,
HTTP 429 counts, revision/hash and aggregate memory. Calls are not changed or
claimed repaired here. Do not claim physical success until the phone test occurs.

Rollback/cleanup: close ingress first (including upgrades/existing sockets); stop
only the named stage proxy/application and database; remove only their disposable
volumes/networks and temporary test accounts/files/profiles; revoke stage-only
credentials/DNS API grants, remove temporary DNS records, and destroy stage secrets
and TLS private keys. For external staging delete its service/database and check
billing/resource inventory. Do not delete the retained source commits/images or
any existing production/local development resources. Clear only the diagnostic's
stage endpoint/preferences if separately approved; never reset the owner's app.

## Primary references

- [Android platform trust and debug-only CA behavior](https://developer.android.com/privacy-and-security/security-config)
- [Let's Encrypt DNS-01, private webservers and credential scope](https://letsencrypt.org/docs/challenge-types/)
- [Render Free service TLS, spin-down, disk and shared-quota limits](https://render.com/docs/free)

**Decision:** technical conditional GO for owner-approved V2 staging provisioning;
NO-GO for phone execution until hostname, trusted TLS, access control, disposable
Mongo and timed exposure are actually established and verified.
