# Phase 3.8 — attachment trust revocation correctness

## Source and contract

Starting checkpoint: `cc1ab159d19f4c0c56f189445ad2829a9676adc4`.
Correction: `566c71e5a56f6de1a772d351533920b180ffa21e`.
Live source reference: `871fa99d0ae94c88239f6c392325f224d2c085c4`; no live service/database was accessed.
No Android, Firebase, E2EE, trust ceremony, signaling, mailbox ACK or deployment changes.

The applicable deployed contract is `DurableDeviceTrustAuthority`'s signed, one-time,
operation/resource-scoped device proof, backed by current `device_lifecycle` state. Admission
checks active state, exact device/account/identity and epoch, signature, expiry and replay.
`docs/PHASE6A_DEPLOYMENT_SECURITY_MODEL.md` requires durable membership/revocation consultation;
`DeviceTrustEnforcer.assertTrusted` also means current trust, not an unconditional grace lease.
Future Phase 6B8 global-fencing requirements are not represented as implemented server semantics.
No located deployed contract expressly authorizes completing every operation for 30 seconds after
revocation. Conversely, no implementation can retract a response already released to the network.

### Confirmed gap, not a new identity authority

`authenticateAttachment` previously supplied an `assertTrusted` closure that compared proof
expiry and captured values only. V2 called it at start and after object/status retrieval, but it
could not observe revocation or epoch/identity replacement. V2 mutations and the legacy authorized
service also lacked final continuation checks. A request admitted before revocation could return
protected ciphertext or transfer metadata afterward. There was no cross-request positive cache;
the stale authority was the in-flight request itself. V2 final read checks bounded it by proof
expiry, while a slow mutation/legacy operation had no equivalent final expiry check.

Exposure requires valid prior device/room authorization, relevant participant/identity binding and
file access. It does not give an unrelated user access, reveal E2EE keys, decrypt server ciphertext
or revoke plaintext/ciphertext already obtained by a compromised recipient. A previously authorized
endpoint may already possess decryption material; allowing a further protected download matters.

## Deterministic evidence

Tests use a fresh, randomly named authenticated Mongo database, synthetic AES-GCM objects and
independent ephemeral Ed25519 devices. Issuers bootstrap, enroll targets, targets activate; proofs
and revocations use the actual signing/verification/nonce lifecycle authority. Room/prekey fixtures
are explicitly disposable test records; no privileged fixture endpoint or production credential.
Real HTTP route tests call the production attachment authenticator and actual Mongo file ledger.

Each race uses entered/release promises, not sleeps: obtain a storage snapshot/object, pause,
commit signed revocation through the existing authority, then release the same admitted operation.
All seven V2 operations returned HTTP 200 before correction: create, status, manifest upload,
chunk upload, chunk download, complete and cancel. After correction all seven return generic
HTTP 403 authorization denial; no protected result is returned and no precommit-gated write occurs.

The same seven failures were reproduced against an exported exact `871fa99d` source with this
new test harness only. The production authenticator and legacy authorized service have no diff
between that live reference and the Phase 3.7 starting point. The issue predates this stabilization.

## Narrow correction

- `backend/security/attachmentTrust.ts`: immutable request-local snapshot of the device/account,
  pinned device identity, verification-key reference, epoch and capped expiry already admitted.
  Every check reads the existing lifecycle collection on the primary, with field projection and
  a 5-second **server query** maxTimeMS. This is not a promise of a 5-second end-to-end network
  deadline. Missing, revoked, pending, replaced, expired or unavailable state fails closed.
- `backend/api/attachments/production.ts`: build that continuation from the verified record and
  cap context expiry to the proof expiry (maximum 30 seconds). No proof is issued or consumed twice.
- `backend/attachments/fileLedger.ts`: fresh trust before each bounded mutation CAS attempt and
  before successful completion; keep the final read-only trust fence, reproject time expiry after
  its asynchronous lookup, and recheck write expiry. Retain Phase 3.7's final status snapshot.
- `backend/security/authorizationContext.ts`: context/trust revalidation without another request
  consumption, using the existing injected clock.
- `backend/security/authenticatedAttachmentService.ts`: legacy pre-operation and final completion
  fences, including protected reads and create/access-registry completion.
- `backend/api/attachments/files.ts`: continuation denials use existing authorization category;
  database errors remain unavailable/storage failures. No protected/error-detail fallback.

No schema/index, protocol, key, quota, resource-limit or dependency change. The continuation stores
no global positive authorization cache. Reads add no file-ledger writes, proof nonce claims or
ciphertext refetch. Queries use the already-indexed account/device lifecycle binding.

## Exact concurrency boundary and limitations

The final lifecycle read is an authorization check at a point in time. A revocation observed there
blocks the result. Revocation after that check, during serialization/socket delivery, cannot retract
already released bytes. The lifecycle read, file CAS, file-state read and HTTP write are not a
cross-collection/network transaction. This work does not claim global linearizability or continuous
stream cancellation, cross-instance failover rollback protection or erasure of endpoint-held keys.

A mutation can commit after its last valid precommit check while revocation races the Mongo write.
The final check then denies the response. Already committed encrypted allocation/progress is not
rolled back; an unsafe rollback could overwrite another worker. Existing active-transfer/quota/expiry
bounds and cleanup still apply. A CAS retry must recheck trust and cannot reuse a stale admission.
Cancellation/file-state checks retain their existing snapshot fencing; changes after the last
corresponding fence remain a race boundary. Time expiry is reprojected before V2 release.
Legacy resource expiry remains checked by its storage service; authorization expiry is checked again
at completion. Strict atomic revocation versus all mutations/packet release would need a separately
approved architecture and is not asserted here.

## Separately discovered legacy failure

An explicit legacy V1 Mongo round-trip test finds ciphertext stored as BSON Binary but mapped using
`new Uint8Array(document.ciphertext)`, producing empty bytes under the default driver configuration.
The normal legacy HTTP request returns 200 with empty ciphertext. This test fails on both the exact
live source and candidate. It is **not** fixed or hidden by changing driver promotion/test settings.
The legacy revocation-completion test is separate and passes; V2 base64 ciphertext round trips pass.
No claim is made that legacy encrypted-file delivery is healthy. This is outside the trust correction
and requires a separately reviewed correction or an explicitly V2-only staging scope.

## Regression results

- Focused backend/authorization/HTTP/file workflow unit suite: **97 passed**.
- Disposable Mongo suite: **17 passed, 1 failed** across 18 cases. The one failure is the
  separately identified legacy V1 BSON ciphertext round-trip, reproduced on the live reference.
  Passed cases include the seven signed-revocation races, available-recipient manifest fencing,
  uninterrupted requests, wrong/foreign bindings, expired/canceled objects, post-commit response
  denial, CAS-retry fencing, one-time proof replay, stale epoch, legacy completion revocation,
  and the two Phase 3.7 real-Mongo stale-progress/read-without-writes checks.
- The ordinary unit command reports 20 integration skips; those 18 cases were run explicitly
  with disposable Mongo as above. Two older port/container-restart fixture cases remain unrun;
  their fixed container was neither created nor borrowed. No hidden pass is assigned to them.
- The pre-fix candidate reproduction has 7 expected failures (all HTTP 200 after signed revocation).
  The exact live-source reproduction has those same 7 failures plus the legacy binary failure.
- Fresh guard read, expiry-before/after-query, immutable admission, missing/pending/revoked state,
  changed account/device/identity/key/epoch, unavailable database and no-cache checks pass.
  Legacy completion unit tests cover create/read/write/complete/delete with gated storage.
- A transfer-expiry-during-trust-query test initially failed, then passed after time expiry was
  reprojected. Development fixture type errors and a write attempted after fixture completion were
  corrected; they are not reported as successful runs or unresolved application regressions.
- Backend TypeScript compilation, production frontend compilation, repository-wide ESLint and
  diff checks: PASS. No APK or Android build.

## Performance and isolated browser staging

Both images used the same tracked frontend and dependency configuration, normal authentication,
unchanged quotas/rate limits, fresh independent disposable browser identities and separate
random-secret databases. Only one application revision served at a time. Application limits:
512 MiB cgroup memory/swap, 320 MiB JS heap, one CPU. Mongo remained authenticated/internal;
the temporary HTTPS proxy published only on loopback. Its certificate exception applied only to
the disposable automated browser, never Android or system trust.

Baseline image source label `27f8e1cf` is the exact Phase 3.7 runtime (the accepted `cc1ab159`
checkpoint adds only tests/evidence). Candidate image source is `566c71e5`. Compiled backend hashes
and all seven served HTML/JS/CSS/WASM hashes were verified; **the entire frontend artifact hash set
is identical** between the two images. No frontend change was used to obtain a pass.

Three sustained samples per size, all output SHA-256 checks passed:

| Bytes | Baseline median send/download ms | Corrected median send/download ms |
|---:|---:|---:|
| 314,368 (307 KiB) | 3,114 / 1,899 | 3,121 / 1,891 |
| 1,258,291 (~1.2 MiB) | 9,147 / 10,933 | 9,148 / 9,935 |

Rate limits were not reset within either six-transfer sequence. HTTP 429 totals: baseline 56,
candidate 49. These are small local serial samples under throttling, not a statistically isolated
estimate of a performance gain. No meaningful local end-to-end penalty was demonstrated; no remote
Render/Atlas latency or physical-phone speed conclusion follows. Added current-trust checks are
read-only indexed lookups (two continuation reads per V2 read, three per V2 mutation excluding
initial proof verification). A local 100-check serial probe took 35.12 ms, added no proof claims
and no file-ledger document or write. That microbenchmark is not an Internet database latency bound.

Boundary/fault controls and final memory figures are recorded below and in the adjacent sanitized
JSON. No request bodies, private keys, capabilities, push tokens, personal files or owner identities
are retained in that evidence.


## Boundary, release decision and cleanup

The corrected production image passes the exact 8,388,608-byte transfer and output SHA-256 check:
9,929 ms send, 55,126 ms download, 55 observed HTTP 429 responses. The authenticated Chromium
503/retry (same ciphertext), cancellation, subsequent transfer, oversize rejection and
reload/unlock cleanup fixture passes in 12.2 seconds. Candidate memory peak: 94,339,072 bytes
(~89.97 MiB) under 512 MiB; zero OOM or unexpected restarts. Baseline peak: 94,048,256 bytes.
These results preserve the bounded local V2 functional staging conclusion after correction;
they do not establish Render/phone performance or repair the legacy adapter.

**Trust-revocation gate: PASS at the documented authorization fences.**
**Conditional GO for phone-reachable isolated HTTPS staging with the existing V2 diagnostic APK,
disposable identities and an explicitly approved endpoint/exposure scope.** Read-only source
inspection confirms that APK's K3ncryptApi uses `/api/attachments/v2`; no APK rebuild or modification
was made. Normal Android-trusted HTTPS and secure Socket.IO forwarding remain required; this
loopback/self-signed browser stage is not directly usable by a phone. Never reuse owner vaults,
identities, production secrets or databases, and do not bypass certificate validation.

**General backend/legacy V1 release: NO-GO** pending the independently reviewed BSON byte conversion
failure. Do not include legacy file clients in the staging acceptance claim. No production rollout
or security-complete global atomic revocation guarantee is approved by these results.

Remaining physical checks: fresh diagnostic-account invitation and explicit verification, ordinary
and interrupted V2 files with integrity, cancellation/retry and revocation during a physical transfer
using disposable devices. Observe actual phone behavior and remote-database latency; no physical
result is inferred from Chromium or simulated file gates.

No indexes/migration or environment-variable changes are required by this correction. A future
staging rollback stops the candidate process before starting the recorded baseline; do not overlap
relay workers. After evidence export only newly created Phase 3.8 containers, networks, their own
anonymous Mongo volumes and temporary generated secrets/certificates/fixtures were removed. The
baseline and corrected local images are retained for review. No existing worktree, APK, identity,
signing file, public branch, Firebase setting or live resource was modified. No push/merge/deploy.
