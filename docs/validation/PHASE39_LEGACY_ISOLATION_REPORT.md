# Phase 3.9 — legacy isolation, independent hotfix and phone staging gate

## Sources and separated changes

- Initial stabilization: `407d78fbdbf393c39bb2da0bb7c2bdbeb97338ce`.
- Live reference: `871fa99d0ae94c88239f6c392325f224d2c085c4` (owner-confirmed source;
  no production service/database queried).
- V1 correction: `81986b293e10414c780ae827c8a4c458e22e6a85` on
  `codex/phase3-offline-stabilization`.
- Staging-only boundary/evidence: `3619662c8aa2c500a52d57c7958e581a580d8467`;
  strict route-shape/fallback correction: `62650cf5b1f9eb75e76e3a17ef5630937a36bb4e`.
- Independent security runtime: `5a82e06c7b0b2d3029cb7b6324760b623cb04850`, direct
  child of live `871fa99d`, on `codex/attachment-revocation-live-hotfix`.
  Review-document HEAD: `031746c728ab1a3a098182784173badc56853a56`.

No existing stable/Android/Firebase branch was modified. No APK, push, merge,
production deployment, infrastructure exposure or live data access occurred.

## A. V1 BSON defect: confirmed, corrected independently

The Mongo driver defaults to `promoteBuffers: false`. Its BSON `Binary` objects
were falsely annotated as Buffer in `mongoAttachmentPersistence.ts`. JavaScript's
`new Uint8Array(binaryObject)` produces an empty array, rather than the stored bytes.
Both nonce and ciphertext were affected for legacy metadata and chunk reads, including
find/list/expiry mapping. This is not a test-only conversion: a signed authenticated
legacy HTTP round-trip against actual Mongo returned 200 with empty ciphertext on
both the live reference and the security-only candidate. Persisted BSON bytes remain
intact; stored ciphertext was not overwritten by the read conversion.

Real V1 users can see empty/apparently corrupted protected data, AEAD failure and
incorrect retry/conflict comparisons. No evidence establishes successful undetected
plaintext alteration or cryptographic bypass. Already canceled/expired/deleted transfers
or client-side failed outputs are not retroactively repaired by this adapter fix.

The correction explicitly handles driver Binary and promoted Buffer, copies logical
bytes (not spare buffer capacity), and fails closed for unexpected types/subtypes or
invalid logical length. No driver option change, protocol change, quota increase,
plaintext caching, schema change or migration. Other storage integrity checks remain.

Regression evidence:

- Seven deterministic BSON serialize/deserialize tests cover default Binary,
  promoted Buffer, independent copies, spare capacity and malformed values.
- Actual Mongo metadata nonce/ciphertext and chunk nonce/ciphertext match exact
  synthetic encrypted inputs through authenticated legacy HTTP. AES-GCM decrypts
  the returned bytes; a tampered ciphertext still fails authentication.
- The existing isolated revocation and cancellation/expiry/identity tests continue
  to pass on stabilization. The old no-auth/restart fixture remains explicitly skipped.

## B. V2 isolation: proven for the documented boundary

V2 mounts at `/api/attachments/v2` before legacy `/api/attachments`. Its account
ledger (`file_ledgers_v2`) stores WireObject nonce/ciphertext as base64url strings;
it never calls `MongoAttachmentPersistence`'s Binary decoder. There is no shared
ciphertext ledger or serialization path. Shared signed device proof, room control,
routing proof, current participant identity and trust authority remain mandatory.

Nuance: shared authentication eagerly constructs the legacy service, and readiness
still requires existing legacy indexes. Constructing that adapter does not read its
bytes. Do not remove the old collections/index setup or claim complete module-level
independence. Existing migrations are needed on a fresh disposable DB, not a new
Phase 3.9 migration on production.

The diagnostic APK's `K3ncryptApi.file` strictly emits canonical V2 paths with version
2. Source inspection found no V1 attachment fallback. The diagnostic worktree/APK was
not changed or rebuilt.

Staging-only `scripts/staging/attachmentPolicy.cjs` is **not imported by production**.
A stage proxy uses its `allowStagingPath(req.url)` before HTTP forwarding and upgrade
handling. It rejects V1, encoded/ambiguous/case-variant legacy paths and unknown
V2-shaped paths, while allowing actual canonical V2 endpoint shapes and required
shared authentication/socket routes. V2 authorization is unchanged; this filter is
neither an identity authority nor an access-control substitute.

An initial prefix-only policy had a proven Express fallthrough gap: DELETE `/v2`,
PUT `/v2/chunk`, POST `/v2/complete` reached a mounted legacy sentinel. Three tests
failed deterministically before the correction and pass after exact route-shape
filtering. This was a newly prepared staging policy defect, not a production change.
All 20 boundary tests now pass, and actual loopback HTTPS returns 404 for blocked
legacy/unknown targets and 403 for unauthenticated V2. Valid signed V2 transfers work.

A real-Mongo signed V2 create/manifest/chunk/complete/status/download round-trip
observes **zero find/insert/update/delete commands** to `attachment_metadata`, `attachment_chunks` and
`attachment_access`, and zero legacy HTTP dispatches. Command payloads/identities are
not retained. Browser encryption and output-hash verification also pass through the
V2-only proxy. Thus V1 can be disabled at staging ingress without changing valid V2
behavior, provided no direct backend/origin bypass exists.

## C. Independent live security hotfix

Only six runtime files change: `attachmentTrust.ts`, `authorizationContext.ts`,
`authenticatedAttachmentService.ts`, `api/attachments/production.ts`,
`api/attachments/files.ts`, `attachments/fileLedger.ts`; three focused test files
accompany them. Exact scope and results are documented on the separate branch in
`docs/validation/PHASE39_LIVE_SECURITY_HOTFIX.md`.

The port preserves live's CAS-backed downloads and all rate limits, authentication,
quotas, protocol, client source, dependencies, schema/indexes and message ACK behavior.
It does not import the V1 fix or stabilization download/prekey optimizations. Current
lifecycle/epoch checks and precommit/final fences port safely without those changes.

Seven deterministic signed-revocation races pass on the hotfix. Its old Binary
round-trip remains the one known failing test; the adapter is byte-for-byte identical
to live. This failure is disclosed rather than hidden or bundled into a security fix.

A final primary lifecycle read is a point-in-time authorization fence; it is not
atomic with another collection's write or network delivery. Already released bytes
cannot be recalled. A raced CAS can commit bounded encrypted progress but final
revocation denial prevents a successful response; unsafe rollback is not attempted.
No new trust authority, positive cache or key/identity change was introduced.

## D. Tests, performance and limitations

Final stabilization relevant attachment/authorization/crypto/HTTP tests:
**105 passed, 2 skipped**. Five additional production/trust/resource suites:
**15 passed**. Independent hotfix equivalent relevant set: **61 passed, 1 failed,
2 skipped**, plus **15 passed** ancillary security cases. The lone failure is the
unchanged V1 BSON test. The two skipped tests require a particular old no-auth Mongo
container/restart fixture; that unrelated container was not borrowed.

Backend TypeScript and production frontend builds pass for baseline, hotfix and final
stabilization images. Both branches' ESLint and diff checks pass. Initial hotfix host
lint could not resolve the intentionally uninstalled local dependency tree; a read-only
Docker dependency mount resolved tooling and lint passed without source changes.

Authenticated Chromium tests use independent disposable identities, normal invitation
acceptance/explicit verification, real encryption, signed HTTP auth and output hashes.
One transfer sequence per source, 307 KiB and ~1.2 MiB; rate limits unchanged within
sequences. Baseline/hotfix results:

| bytes | live-source send/download ms | security hotfix send/download ms | 429 each |
|---:|---:|---:|---:|
| 314368 | 901 / 392 | 890 / 404 | 0 |
| 1258291 | 17983 / 25013 | 17980 / 24991 | 10 |

All four hashes pass. No meaningful hotfix penalty is demonstrated in these single
local samples; retained live rate limiting dominates the larger sequence. No phone,
Render or statistical performance claim follows. Baseline peak application cgroup
memory is 92,053,504 bytes; hotfix 90,271,744 bytes under a 536,870,912-byte limit,
one CPU and 320 MiB Node heap, zero OOM. Seven served HTML/JS/CSS/WASM hashes match
built artifacts per image; baseline/hotfix frontend hash sets are identical.

The final V2-only staging sequence takes 892 / 390 ms send/download for 307 KiB,
and 1,898 / 1,918 ms for ~1.2 MiB (zero and one HTTP 429 respectively); both hashes
pass. This retains earlier stabilization optimizations and is **not** the independent
security hotfix's performance. Peak is 93,065,216 bytes under the same cap with no
OOM. The final staging image/boundary and timing evidence is in the adjacent sanitized
JSON. The retained stabilization V2 runtime optimizations are not in the hotfix.
The browser 503/manual retry (same encrypted chunk), deterministic cancellation,
next transfer, oversize rejection and reload/unlock fixture passes on the hardened final policy (12.1 seconds).
This is controlled local browser evidence, not real Android network evidence.

A first baseline fixture bootstrap returned 403; a fresh unchanged retry passed.
Its precise cause is unresolved, and it is not described as repaired. Development
checks also caught/corrected an expired-status 410 port regression (live status
contract restored), and the staging-prefix fallthrough described above. No final
new application test failure is being concealed.

The 8 MiB repeated/boundary staging from Phase 3.8 was not repeated in Phase 3.9;
V2 runtime is unchanged by the V1 adapter/policy work. Existing maximum-size and
resource-limit unit tests pass. Broader unrelated suites and physical Android
instrumentation are not claimed tested by this focused phase.

## E. Decision and next owner action

- **GO for prompt narrow production security-hotfix review**, not deployment or a
  general legacy-health certification. Review independent runtime `5a82e06c` and
  explicitly decide whether the separate BSON fix should accompany a later release.
  No dependency on performance optimizations, migrations or Android changes exists.
- **Conditional GO for owner-approved phone-reachable V2 staging provisioning**;
  **NO-GO for starting phone tests yet**: trusted TLS, chosen host, source restrictions,
  timed exposure and independent disposable Mongo must first be established.
- Prefer existing Mac + same-Wi-Fi phone, owner-controlled hostname/public-CA cert,
  LAN-address-only HTTPS proxy and explicit source allowlist. External staging is
  an approval-requiring fallback with separate hosting/DB/access-control/quota review.
  Full options, costs, exact runtime Advanced settings, primary references, rollback
  and complete cleanup are in `PHASE39_HTTPS_STAGING_PLAN.md`.
- Keep the current diagnostic APK; configure both origins only after the approved
  HTTPS stage is verified. Use fresh accounts, pin/verify normally, test text and
  the bounded file-size/retry/cancel/restart matrix, and report physical results.
  Do not import production identities, bypass TLS, enable FCM or reset the owner's app.

Security hotfix rollback is code-only to schema-compatible live `871fa99d` under the
existing maintenance/socket-drain gate, preserving all current flags. It reintroduces
the known security gap, so a forward security repair is preferable. No production
migration/backup/restore operation is needed solely for this schema-neutral candidate.
Temporary resources created for this phase are cleaned up; retained images/source
are local only. No external endpoint has been created.
