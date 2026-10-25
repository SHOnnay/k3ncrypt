# Final Web/backend release integration gate

Branch: `codex/web-final-release-gate`.
Reviewed runtime base: `12a199f9203b017ac3777254e4ef2d92e6800acd`.
Last owner-confirmed live baseline: `871fa99d0ae94c88239f6c392325f224d2c085c4`.
The accompanying archive manifest records the exact final documentation/test HEAD.

## Decision

**GO for review of this isolated candidate. NO-GO for production activation now.**
Acceptance commit: `4a75d7c040bc6eb91906acdbdc901c60f555ba3b`.

No new production-runtime correction was required by this gate: the approved ancestry already integrates the requested fixes. This branch adds acceptance evidence and a loopback-only production test harness. No merge/cherry-pick was performed. Production Mongo topology/permissions/validators and old Render worker termination are unverified. These are explicit release prerequisites, not tests claimed to pass. Unchanged Android Beta 22 cannot perform the new expired-prekey renewal. Already-deleted legacy ownership is not automatically restored.

## Exact integration evidence

All the following are ancestors of the runtime base and final candidate:

| Included area | Original implementation commit(s) |
|---|---|
| Contact visibility, missing-local versus remote error | `da58c470`, `343d6928`, `c3a299e2` |
| Invitation/session lifetime and persistent restoration | `819763c3`, `812998f2` |
| Durable owner transactions, signed renewal, revocation fences | `7c25f22f`, `6fb343db`, `24a751c8` |
| Offline Mux and truthful relay/recipient status | `d20f4e3e`, `b5bb816c` |
| Warm selection, draft/download fencing, startup feedback | `ecddc3a9`, `ea9715d7`, `bbec1eb6`, `2fc6e4a2` |
| File read contention, final status progress, prekey request bounds | `b976fa2a`, `27f8e1cf`, `c5a989c8` |
| Attachment final trust fencing, exact BSON bytes | `566c71e5`, `81986b29` |
| Rate versus quota feedback, bounded recovery | `3190a7e1`, `6dc2cda1`, `91a142b7` |

Standalone hotfix `f3aab1d64edf47a6f84b4c5bafc52ebace94855f` and earlier contact candidate `1cc7daae1459907ada44403d4b593326d10091ad` are NOT literal ancestors. Their relevant corrections exist through the original commits above; importing their histories again would be redundant. The archive includes machine-generated full-SHA ancestry evidence and the exact production-source diff from the live baseline.

No changes from live to this candidate in Android, existing Firebase wake implementation, migration definitions, production entry script, maintenance gate or production configuration validation. No WebRTC/call engine changes were introduced. Existing live functionality is not represented as newly imported Firebase work.

## Final validation on disposable resources

| Gate | Result |
|---|---|
| Non-Mongo Web/backend Jest | 170 suites, 1,106 tests PASS; none pending |
| Real Mongo signed-device routing, transactions and two-process boundary | 26 PASS |
| Real Mongo attachment revocation and exact ledger reads | 19 PASS |
| Legacy Mongo lifecycle and actual TTL cleanup | 8 PASS |
| Persistent Chromium ages 0/4/5/7/8/15/30 plus mixed adoption | 8 PASS, 2.4 min |
| Lost legacy owner, explicit replacement room, original encrypted records retained | 1 PASS, 18.9 s case |
| Eight-day Mux, real TTL, browser/backend restart, offline replay | 1 PASS, 20.8 s case |
| Compiled production HTTPS file acceptance, no watcher | 4 PASS, 1.9 min |
| SDK, production backend and Web compilation/type generation | PASS |
| Focused ESLint and whitespace checks | PASS |

File cases: rate-limited create reaches bounded truthful failure and a new transfer succeeds (11.5 s); cancellation prevents late publication (7.8 s); retry/cancel/next transfer/reload (55.6 s); two independent Save links and teardown cleanup (37.7 s). These are complete authenticated fixture durations, not file-speed benchmarks. Production-mode tests use compiled frontend/backend over loopback HTTPS, an ephemeral local test certificate, synthetic accounts, separate Mongo database, and a 320 MiB Node heap setting. This is NOT a measured/enforced 512 MiB process-RSS acceptance test. No phone/public endpoint was exposed. Client bundle retains the existing >500 kB build warning.

Age tests advance application clocks deterministically and backdate only temporary prekey expiry so the real Mongo TTL monitor removes it. They do not claim 30 wall-clock days. Original pins, explicit verification and encrypted history survive; offline Sent precedes valid recipient Delivered; deduplication is checked. Fresh retained 23 KiB files at days 8/30 pass byte-hash verification. Old attachment lifetime is not extended.

Two-process acceptance: a routing-aware flag-off worker serves legacy rooms but rejects upgraded-room relay after another process adopts; no rejected ciphertext is persisted. Revocation survives process restart. A maintenance process permits health/readiness, rejects API writes with 503/Retry-After and denies Engine.IO admission. This does not make original 871fa99 workers safe or certify Render termination, and is not approval for multi-instance production (the existing production validator permits one instance).

Initial invalid attempts: a stale Docker port refused connection; one test expected the wrong WebSocket error level; a development watcher restarted the backend during a file fixture edit. None is counted as a successful acceptance run. Port/fixture assertions were corrected; the file tests were repeated against compiled production code without a watcher. No final selected test failure remains. Other Mongo suites and unrelated browser suites were not exhaustively rerun; no physical Brave/Android, Render cold start, production topology, production RSS, or owner recovery test was performed.

## Schema, authority and resource invariants

See `DURABLE_ROUTING_DESIGN.md` and `DURABLE_ROUTING_VALIDATION.md` for full field/endpoint definitions. Existing links gain version/revision and at most two owner slots INCLUDING permanent tombstones. Existing device lifecycle gains a transaction conflict fence. No new collection/index or bulk migration is needed; existing validators must permit the additive fields. Existing records are readable. Transactions and snapshot reads on a supported replica set are mandatory. No inference of replica-set support is made from a mongodb+srv example.

Ownership requires fresh signed current-device authority, exact identity/epoch/key and original unexpired server routing evidence. Room/device/owner revocation, deletion and tombstones fence admission and renewal. No positive authorization cache or raw secret is persisted. Persistent public identity/device/room linkage is privacy-sensitive metadata despite containing no plaintext/private keys. Temporary prekeys remain seven days; retained offline ciphertext remains seven days/64 active mailbox slots; V2 files retain their existing 24-hour bounds/quotas.

Server acceptance remains Sent, authenticated recipient acceptance remains Delivered; DRAINED is not delivery. No mailbox authority or crypto primitive changed. A rejected/adoption-blocked send must not be labeled accepted. One-peer adoption test observes rejection, no mailbox insert, then successful retry after the offline peer authenticates and adopts.

## Old clients and existing relationships

- Existing current contracts remain usable while their legacy authority and bootstrap material remain valid. Older clients do not implement signed expired-publication renewal or identity-only restoration. Do not claim Android Beta 22 long-inactivity recovery is fixed.
- Both participants must authenticate/adopt while the original evidence remains valid. One peer offline/unadopted can pause relay after the first adopts; this is tested, not advertised as seamless migration.
- Exact epoch/key/device replacements fail closed. There is no automatic authority rebind or tombstone reset.
- Relationships whose legacy evidence has already disappeared need the separate non-destructive recovery plan. Local verified pins never prove missing historical server ownership.

## Activation and rollback

Follow `FINAL_WEB_OWNER_GUIDE.md`; no commands there were executed against production. Flag off is default; disabling it after adoption blocks upgraded rooms and is not rollback. Old binaries ignore new tombstones. No rolling mixed-authority activation or transparent zero-downtime promise is safe. After adoption only a routing-aware compatible binary (reviewed runtime `12a199f9`, identical to this candidate) or forward repair under maintenance is supported. Never restore a DB snapshot that discards revocations/tombstones/new mailbox acceptance.

## Remaining release blockers

1. Non-secret operator/provider confirmation of intended Mongo replica-set transaction support, permissions and additive validators; no production access performed here.
2. Explicit maintenance cutover and provider evidence of every old worker exiting before activation; health checks do not prove it.
3. Owner acceptance of coordinated both-peer adoption and old-client/Beta22 limits.
4. Separate explicit choice for already-expired relationships; no claim the owner's three original rooms have recovered.
5. Actual Render memory/health monitoring during a future separately approved deployment; local Node heap is not an RSS guarantee.

No owner physical test is requested at this gate. The next action is an explicit release/adoption decision, not further feature development.
