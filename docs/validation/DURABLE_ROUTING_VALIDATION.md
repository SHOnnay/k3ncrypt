# Seven-day routing lifecycle candidate — implementation and validation

Branch: `codex/web-durable-routing-ownership`.
Base: `4eaddb2beec484db5d9ebae33f170689b5d43f41` (`codex/web-lifecycle-completion`).
Scope: prospective durable Web routing and restoration; no owner-data recovery or deployment.
The final documentation commit is the candidate HEAD; resolve with `git rev-parse HEAD`.

## Confirmed defects and corrections

1. `prekey_bundles` held the renewable routing-secret verifier, participant public identity and disposable cryptographic bootstrap keys in the same seven-day TTL record. Cleanup removed server routing evidence while local contact pins, verification, room descriptors and history remained. The candidate separates those lifetimes.
2. `ModernConversation.connectUnlocked` fetched remote bootstrap keys before preparing authenticated device recovery, even when restoring a healthy existing Olm session. It now prepares current device authority first, replenishes its own expired publication through signed authorization, and uses a separate authenticated identity-only lookup for an already established, unchanged pinned peer. A new cryptographic session still needs real current bootstrap keys. No fallback key is fabricated or retained past its intended publication lifetime.
3. The real Mux browser experiment found an additional availability dependency: `MultiplexedRelayConnection.sendEnvelope` required a live peer feature advertisement after restart, despite an encrypted room-and-pin-bound message-version floor. Observed counters: authenticated device socket, one subscription, committed encrypted outbox, **zero send attempts**, and Sending after 15 seconds. `ModernConversation` now supplies the existing authenticated floor only around a current-trust-checked retry dispatch, clearing it in `finally`. The immutable room adapter never turns this into a live peer advertisement, call capability, identity, trust, or server authorization. Unknown floors still fail; current authenticated subscription/proofs and peer binding remain mandatory. The corrected real eight-day Mux flow passed offline acceptance, replay and file integrity. The final Mux fixture passed in 22.2 seconds (24.1 seconds including runner setup). Overall fixture duration is not a per-message latency benchmark.
4. Missing current routing authority has its own safe UI classification. Established saved contacts stay visible without an open-session claim. Missing local registry, changed identity, expired/deleted rooms, network outages and lost server authority remain distinct. Storage failure returns 503; explicit authorization denial returns 403. Neither deletes local records.

## Authorization invariants

- A room capability, routing address, invitation, saved local descriptor or expired prekey alone establishes no durable ownership.
- Initial adoption requires an unexpired existing publication, its original routing proof, a fresh single-use signed device authorization scoped to this room, exact public identity/fingerprint and Ed25519 key agreement, current active device/epoch, and a live room.
- Admission/renewal/revocation use bounded Mongo transactions. A conditional write to the current device and the room document serializes against concurrent device revocation, epoch/key/identity changes and room deletion. Maximum three transient transaction attempts; five-second commit bound.
- Current reads use a primary snapshot aggregate joining the room, owner and current device. No positive authorization cache survives revocation. Final identity-response checks cover both requester and target. Existing attachment final-boundary checks additionally include current routing ownership.
- Owner tombstones cannot be overwritten or inferred from temporary material. Revoked slots still count against capacity. Room deletion remains authoritative. Data already released before a revocation cannot be retracted; no zero-time network revocation guarantee is claimed.
- Message persistence, encrypted acceptance, FIFO/deduplication and recipient ACK authority are unchanged. Server acceptance is Sent; Delivered requires the existing authenticated recipient acceptance path.
- New message-version evidence is dispatch-scoped, memory-only and bound to the immutable room adapter. It is cleared after success/failure and on close; it does not authorize calls, another room, a changed pin or a revoked device.

## Exact additive schema and indexes

Existing `links` documents gain:

```text
routingOwnershipVersion: 1
routingOwnershipRevision: integer
routingOwners: [                         # at most two, including tombstones
  {
    address,
    identity: {curve25519, ed25519},      # public keys only
    identityReference,
    renewalProofHash,                    # verifier, never the raw routing secret
    accountIdentityReference, deviceId, deviceEpoch, verificationKeyReference,
    state: active | revoked,
    generation,
    establishedAt,
    revokedAt?                          # permanent tombstone when revoked
  }
]
```

Existing `device_lifecycle` documents gain an incrementing `routingAuthorizationFence` used only for transactional conflict detection. It is not an authority or credential.

Reuse existing unique `links.hash`, device account/device and identity registry indexes. No new collection, TTL index, bulk migration or background worker. `prekey_bundles.expiresAt` remains seven days. Owner lifetime follows explicit room/device/owner authorization, not temporary keys. Mongo replica-set transactions and snapshot reads are prerequisites; standalone/volatile storage is not a supported activation target.

New additive, no-store endpoints under the existing room capability:

- `GET /api/chat-link/:channel/routing/:address/identity`
- `POST /api/chat-link/:channel/routing/:address/prekeys` (own route only)
- `DELETE /api/chat-link/:channel/routing/:address` (own route only)

All require a fresh existing `device-control` proof scoped to the room, nonce, authenticated participant route and its original proof. Identity lookup returns identity only, never bootstrap material. No old API or Socket.IO/Mux wire format is replaced.

## Existing-valid versus already-expired relationships

### A. Original server evidence still exists

Enable only after the deployment gates below. Each participant reconnects and proves its own current device and original route while its original publication remains valid. Both participants must adopt before expired-peer offline routing can be relied upon. Merely enabling the flag does not backfill offline peers. Once adopted, temporary prekeys can disappear and the updated Web client can restore and renew without another invitation or verification reset.

An epoch/key/identity replacement fails closed; this candidate does not automatically rebind an owner to changed authority, even when a separate lifecycle operation was legitimate. Such rebind/recovery needs its own reviewed procedure. Tombstones are never cleared automatically.

### B. Original publication already deleted, no durable owner

The independent device registry proves the device, but contains no authenticated evidence of its former room/address ownership. Genuine current device + old room capability + old route secret still fails adoption/renewal. The Mongo regression demonstrates this denial. No automatic reconstruction is implemented.

Safe procedure: retain the original encrypted vault, pins, descriptors and history; do not reset/delete/reverify them as a repair. Review whether an independently authorized peer can supply a fresh signed binding to the exact existing pinned relationship. Defining/validating that peer-assisted recovery is a separate protocol/design decision, not an inference this candidate makes. Alternatively, an explicitly accepted and compared new invitation can establish a separate relationship while the original records are retained; it does not restore the old room or automatically combine histories. No such action was executed on owner accounts.

## Lifecycle matrix (changed and preserved rules)

| Object | Lifetime / cleanup | Result and safe recovery |
|---|---|---|
| Temporary prekeys | Seven days; actual Mongo TTL | Current signed owner replenishes its own keys; no fake bootstrap key |
| Durable routing owner | No TTL; explicit room/device/owner revocation | Current exact binding only; permanent bounded tombstones |
| Local contact/pin/verification | No age-based TTL | Retained through server cleanup; no automatic trust replacement |
| Local encrypted session/history | Existing encrypted vault/storage bounds | Healthy session restores under exact pin and current server admission |
| Invitation | Existing 24-hour first-admission boundary | Established matching acceptance receipt is distinct; no new admission from expiry |
| Room | Existing explicit deleted/expired flags | Denied, never resurrected |
| Device/proof/epoch | Existing signed lifecycle and short proof windows | Fresh authorization and replay protection; no stale-epoch recovery |
| Offline ciphertext | Existing seven days, 64 active mailbox slots | Authorized replay within retention; older mail intentionally not guaranteed |
| Attachments | Existing V2 24 hours and quotas; legacy V1 bounds unchanged | Valid retained bytes only; expiry/revocation/integrity checks preserved |
| Browser tab lease | Existing bounded 15-second crash guard | Normal unload releases it; abrupt process death can require retry after expiry |

Full unchanged source lifecycle inventory: `WEB_LIFECYCLE_COMPLETION.md`. Expiry values were not globally extended.

## Real isolated validation

No production credentials, network services, owner profiles or real identities were used. Mongo 7 ran in a task-owned Docker replica set bound to loopback. Test databases/profiles are synthetic and separately named. Browser tests restart independent persistent Chromium profile processes and the backend, using a newly generated test proof secret retained only across that case's restart.

Backend and browser clocks advance deterministically. Mongo's TTL monitor runs on wall time: at the virtual seven-day boundary the fixture backdates **only** temporary publication expiry and waits for real TTL monitor deletion. It does not fabricate routing/device ownership. This combines deterministic 0–30-day application behavior with actual Mongo cleanup; it is not a claim of waiting 30 wall-clock days or testing the owner's Brave profile.

| Virtual inactivity | Persistent browser + backend restart | Original pin / verified history | Offline Sent then authenticated Delivered | Actual prekey TTL deletion |
|---|---|---|---|---|
| 0 days | PASS | PASS | PASS | Not due |
| 4 days | PASS | PASS | PASS | Not due |
| 5 days | PASS | PASS | PASS | Not due |
| 7 days | PASS | PASS | PASS | PASS |
| 8 days | PASS | PASS | PASS | PASS |
| 15 days | PASS | PASS | PASS | PASS |
| 30 days | PASS | PASS | PASS | PASS |

The final default-transport matrix passed **7/7 in 2.0 minutes**, with per-case fixture durations 15.6 / 15.0 / 15.3 / 16.0 / 20.2 / 16.2 / 18.3 seconds. These durations include setup, verification, multiple browser launches, database checks and backend restarts, not message latency. The eight-day case also queues a message on day six, then proves its replay after day-seven prekey cleanup. It waits for the specific send's truthful status before shutting down, rather than confusing an unrelated profile-envelope row with message acceptance. Both displayed peer codes are compared before verification. Duplicate message count is checked.

Protected 23 KiB file bytes are downloaded and SHA-256 compared at days eight and thirty. This validates a fresh retained file after long inactivity, not availability of a file older than its documented retention. Existing file expiry/cancellation/revocation regressions remain separate.

Additional gates:

- **169 suites / 1,099 tests passed**: final non-Mongo Web/backend suite, including offline Mux correction. No pending tests in that invocation. Database suites intentionally run separately.
- **25 real Mongo signed-device routing tests passed**: all ages, TTL, restart, proof replay/wrong scope, wrong device/identity, capacity/tombstones, concurrent room deletion, device epoch/key/identity/revocation fences, delayed requester/peer revocation at identity response release, expiry during transaction, cleanup racing renewal, storage outage and signed device revocation.
- **19 real Mongo attachment revocation/read tests passed**: existing security fences and exact retained reads. Observed test-only 307 KiB / 1.2 MiB read stages: 29 / 38 ms, zero ledger writes; this is not a matched production benchmark.
- **8 real Mongo legacy lifecycle tests passed**: flag-off/unadopted legacy expiry and mailbox retention unchanged; actual TTL monitor observed.
- **95 focused session/Mux unit tests passed**, overlapping the full suite.
- **68 focused UI classification tests passed**, overlapping the full suite.
- SDK type generation, production backend TypeScript, production Web TypeScript/Vite, focused ESLint and diff whitespace checks passed. Existing >500 kB client bundle warning remains.

Early failed attempts are not counted as successes: an overly broad Jest CLI ignore override tried to execute Playwright with Jest; a synthetic DB mock lacked the new client accessor; browser fixtures initially used hidden-element innerText, optional names, ungraceful process shutdown and insufficiently correlated mailbox counts. The last added race fixture also initially shadowed its publication helper and failed TypeScript compilation before execution; the local variable was renamed and the suite rerun. These fixture/invocation failures were corrected. A test-only backend orphan from an interrupted run was identified and stopped; the harness now refuses an occupied backend port. The genuine Mux live-peer gate was reproduced independently and corrected, rather than being dismissed as a test failure.

Not validated: owner account recovery, physical Brave/Android behavior, actual Render cold starts, real multi-region failover or production Mongo topology, all 30-day operational workloads, and recovery after legitimate authority replacement. No physical call success claim is made.

## Compatibility and deployment gates — no operations executed

- `K3NCRYPT_DURABLE_ROUTING=true` is explicit opt-in; absent/false preserves unupgraded legacy behavior. Upgraded rooms fail closed when disabled; flag-off is not a full operational rollback.
- Old HTTP bundle GET stays unchanged, including 404 after temporary expiry. The new identity-only lookup does not pretend to be a bundle. Legacy renewal cannot recreate expired upgraded authority.
- Android Beta 22 exact reference `4c9c093b0ba9f2f82b50b721202389d071169016` sends room-scoped device proofs and original route proof. Source contracts remain compatible before expiry. Its `VodozemacBundleCodec.parse` requires real one-time/fallback material and it lacks the new signed expired-publication recovery API. Thus **unchanged Beta 22 long-inactivity recovery is not fixed**. Old Web clients share the analogous limitation. No Android file was changed or APK built; physical compatibility is untested.
- Updated Web against the old backend remains ordinary-contract-compatible while old authority is valid. If authority has expired, the absent recovery endpoint fails closed; the new backend must be approved/deployed/activated for durable restoration.
- This is an additive **schema and authority lifecycle change**, despite requiring no new index migration. Confirm replica-set transactions, snapshot reads, current device indexes, compatible collection validators and capacity before activation. No bulk copy of expiring records is authorized.
- Drain/stop **all old backend workers before activation**. Old binaries ignore owner tombstones; mixed-authority rolling operation is unsafe. New compatible workers can coexist only with consistent activation policy. Do not expose a partial rollout to family conversations without a coordinated transition.
- Both peers must adopt while their original evidence is valid. Active-only adoption can pause an unmigrated/offline peer's message routing until that peer authenticates; plan this explicitly rather than advertising seamless bulk migration.
- After adoption, do not roll back to `871fa99` or another old binary. It would ignore durable revocation and restore the old expiry coupling. Safe rollback uses a compatible updated binary or maintenance isolation and retains owner/tombstone data. Turning the flag off blocks upgraded rooms; it does not reconstruct old publications.
- New persistent public identity/device/room linkage lasts longer than prekey metadata. It contains no message plaintext, private keys or raw route secrets, but is still privacy-sensitive server metadata. Two bounded slots prevent per-room unbounded growth; operational access/backup controls remain required.

## Reviewable commits / changed areas

- `4855b2d2341bc35668c1328cfd1af4bf12c4d556`: design and activation gates.
- `7c25f22fd35ffd2b61fccc8ddaefebf40ffa26de`: durable owner store, authenticated routes, current relay/file binding and Mongo tests.
- `812998f2e28e7614713c02cd426d1fc5096099de`: Web existing-session recovery and own signed key replenishment.
- `6fb343dba49e895a5ddd901db7a8bfe2c37876b5`: final-boundary revocation/expiry/outage regression gates.
- `24a751c86005c07d7f249ef787e853845037ecf7`: truthful non-destructive routing-recovery presentation.
- `d20f4e3e9f8426e0f78162fd04542beb59849e44`: dispatch-scoped authenticated version floor for offline Mux sends.
- Following local test/documentation commit: persistent browser clock harness, seven-age matrix and this consolidated report.

Implementation files are confined to backend routing/security/attachment authorization adapters, Web SDK restoration/transport handling, diagnostic presentation, their tests and this documentation. Existing attachment ledger/security fixes remain in the base. WebRTC/ICE/call signaling, Android, Firebase, mailbox authority and cryptographic primitives were not modified.

## Reproduction commands

Use an isolated checkout and a disposable loopback Mongo replica set only. Build the SDK first. Existing Jest tests should resolve the local SDK source, not an older workspace dependency. For example:

```sh
npm run build-service-sdk
node_modules/.bin/jest --runInBand --collectCoverage=false --moduleNameMapper='{"^@chat-e2ee/service$":"<rootDir>/service/src/sdk.ts"}' --testPathIgnorePatterns='/e2e/|/node_modules/|\.mongo\.test|mongo\.integration\.test|mongoAttachmentPersistence\.test'
K3NCRYPT_ROUTING_MONGO_URI='mongodb://127.0.0.1:57096/?directConnection=true' node_modules/.bin/playwright test --config=playwright.routing.config.ts
K3NCRYPT_ROUTING_TEST_MUX=true K3NCRYPT_ROUTING_MONGO_URI='mongodb://127.0.0.1:57096/?directConnection=true' node_modules/.bin/playwright test --config=playwright.routing.config.ts -g 'after 8 days'
```

Port 57096 was task-owned disposable Mongo, not an existing application database. The standalone clock helper refuses non-test execution, remote Mongo and non-test database names. Browser test services bind loopback; no tunnel or phone/public endpoint is created. Do not point these tests at production or copy an owner's browser profile.

## Decision

**GO for review of a controlled, opt-in updated-Web/backend candidate for still-valid/adopted relationships.** Real Mongo cleanup and authenticated long-lived conversations demonstrate the prospective seven-day coupling correction.

**NO-GO for automatic production rollout, owner-account recovery claims, or a claim that unchanged Android Beta 22 is fixed after expiry.** Required decisions: coordinated adoption and worker replacement; already-lost-authority recovery; supported epoch/device replacement; eventual Android/old-client recovery compatibility. No push, merge, migration, deployment, production data access or owner-browser operation was performed.
