# Firebase F1b Phase B — implemented, local validation only

Branch: `codex/backend-firebase-f1b`.

- Phase A: `406b1f117b53a245f3b7caa5cc877d8777186128`.
- Approved design: `b3fbb6eca8912a53d9234a401fed40a1cffcf985`.
- Durable implementation: `3d1696d57a72b37e5053bbdf38f182906e6b80ec`.
- Lease/bounds hardening: `9cebbc701deb61a157603bb0b9798d0bc5afdb51`.

No production migration, provider credential, real FCM request, Android change, deployment or push was performed. This is not evidence of device notification delivery.

## Implemented lifecycle and availability

`storeOfflineMessage` still inserts encrypted mail under its existing rules. Only after a successful insert does it invoke the nonblocking optional enqueue hook with the persisted message ID. The hook independently verifies that active, unexpired row before producing a wake. Queue failure, missing optional schema, full capacity, authorization failure and provider outage cannot reject or roll back that insertion. Mailbox claims, ACKs, FIFO, deduplication and seven-day expiry are unchanged.

The post-persistence crash gap remains deliberate. A startup recovery pass scans at most 512 active rows from the last 60 seconds, in batches of 32 with a two-second between-operation budget and Mongo maxTimeMS. It can miss hints under overload or long downtime, and can reproduce a previously completed generic hint. Mongo execution deadlines are not a hard network wall-clock deadline. Reconnect/replay remains authoritative; this is not an atomic outbox or exactly-once delivery.

Only a genuine successful existing legacy admission or Mux subscription may capture a notification route pointer. Capture checks the current owner, active device identity/epoch, current registration, room capability, renewal proof and fresh published identity. The pointer grants no admission, trust, decryption or ACK authority. Dispatch checks current device authority, exact registration version, nonexpired pointer and live room again; it does not query prekeys. Thus prekey expiry alone cannot suppress an already authorized pointer. Existing clients need a fresh admission after push registration; unknown bindings are never guessed.

Signed token rotation uses a transaction confined to notification registrations. Unique token and owner/device constraints prevent stealing or multiple current registrations. Every rotation gets a fresh server UUID. Invalid-token retirement matches the exact observed registration, including that UUID, owner and epoch. Removal/revocation invalidates dispatch through current-registration/current-device checks; inert pointers and queued rows can remain until bounded recycling/TTL. No new identity authority is introduced.

## Storage and indexes

| Collection | Bounds and indexes |
| --- | --- |
| `private_wake_slots_v1` | Exactly 1,024 reusable IDs, strict validator, at most 4 KiB each (4 MiB document payload plus indexes). Unique partial registration index; due-work, lease and event-expiry indexes. No TTL deletion of slots. |
| `device_push_routes_v1` | One document per device, at most 32 routes and 32 KiB. Unique owner/device and unique multikey route indexes; eventual document TTL. Individual routes valid for at most 30 days from admission and checked on every send. |
| `device_push_tokens_v1` | Existing registration fields plus server-generated `registrationVersion`; unique owner/device index. Exact-observation conditional backfill, no owner/identity changes. Duplicate historical owner/device rows stop preflight without deletion. |
| `offline_messages` | Optional descending timestamp/ID index for finite reconciliation; no message schema or delivery-state change. |

One current wave per registration, up to eight route keys per wave, one bounded successor during a lease. A ninth distinct route, full queue or four exhausted enqueue contention attempts declines only the optional hint. Expired queue identifiers are erased when the worker recycles slots, not by a physical 60-second deletion guarantee while FCM is disabled. Route data exposes server-internal relationship metadata to database administrators and needs existing restricted access.

## Worker bounds, fencing and provider behavior

One worker per existing Db/process; no separate service. At most 16 claims per batch; one timer; one active cycle; one-second active/30-second idle cadence. Resolver and admission-capture contexts each cap at 32. Provider jobs cap at 32 per process, including timed-out unresolved SDK requests. Multiple backend processes multiply this resource bound; this does not approve multiple live conversation workers or rolling deployment.

Atomic Mongo claims use server time, random lease IDs and BSON Int64 generations. Leases last at most 15 seconds and are refreshed at persisted attempt admission, bounded by event expiry. Result writes require the same generation/lease ID; request-generation CAS protects concurrent successor arrivals. There is no heartbeat: the provider deadline is five seconds, and ambiguous timeout is terminal for that wave. Pausing for maintenance/stopping before send preserves unattempted work for lease recovery.

At most three persisted provider invocations per wave, with 250/500ms retry eligibility for known transient errors and the original stable event ID/60-second lifetime. Worker cadence may delay those retries. Quota responses terminate this short wave rather than retrying earlier than a minute. Unknown/configuration failures do not retire tokens. Only definitive token-specific errors may conditionally retire the observed registration.

An unresolved SDK call retains its in-process slot until settlement; it is not forcibly canceled. Restart, a late provider response, or a paused process can still cause bounded duplicate external hints. Database fencing cannot fence Firebase itself. Provider acceptance is not device delivery or mailbox consumption. The legacy Phase A process-local successful-send throttle remains for non-durable dispatch; durable waves use queue coalescing and persisted attempt limits instead of dropping a newly queued wave through that throttle.

FCM data contains only `version`, `type`, random `eventId`, `createdAt`, `expiresAt`. No message IDs, routes, contacts, identities, plaintext, keys or token hashes enter payloads or counters. FCM necessarily receives the target registration token as transport addressing. Aggregate numeric counters are process-local and reset on restart; no public diagnostics endpoint was added.

## Validation evidence

Disposable test infrastructure: newly created loopback-only MongoDB 7 replica set with tmpfs database storage and only the image-created anonymous config volume; no owner data or bind mounts. Random test databases were removed by fixtures. The verified task-created container and its anonymous volume were removed after validation. No real provider was used.

| Check | Result |
| --- | --- |
| Focused wake suites | 56 passed: 23 durable Mongo, 3 existing push Mongo, 22 fake dispatcher, 8 registration tests. |
| Existing mailbox and durable device-trust Mongo regressions | 17 passed. |
| Backend-wide Jest rerun without Mongo URI | 220 passed, 1 failed, 47 gated tests skipped. Mongo results above separately cover 43 tests; counts overlap and must not be summed as unique tests. |
| Backend compilation / no-emit type check | Passed. |
| Scoped ESLint / git diff whitespace checks | Passed. |
| Real Firebase/provider/device delivery | Not run; requires separate approval and configuration. |

Real Mongo coverage includes full 1,024-slot saturation with mail persistence intact; queue failure versus mail failure; schema bounds; concurrent claims/workers; a child process exiting after claim/attempt and recovery of its persisted event; stale lease rejection; three-attempt retry cap; expiry; actual five-second unresolved-provider timeout; rotation/invalid-token races and transaction rollback; revoked/changed identity; retained pointer after prekey deletion; missing old schema; historical registration conflict preflight; successor preservation; maintenance pause and single-loop cleanup.

The remaining backend-wide failure is `backend/security/releaseResources.test.ts`, whose broad text assertion rejects an existing private Android build using debug signing. Both that test and Android Gradle are byte-identical to the approved starting source; neither was changed here. An earlier run also failed one prekey expiry test (401 versus expected 409); it then passed all eight targeted tests and the complete backend rerun. That transient failure is recorded, not silently counted as a first-run pass.

The file-ledger Mongo suite that restarts a named external container was not run; the private-network Mongo-gated suite was also not run. No Web or Android suite is claimed. Unit skips are reported rather than counted as passes.

## Files and review boundaries

- New queue/schema: `backend/push/durableWakeStore.ts`.
- New route-pointer checks: `backend/push/authenticatedWakeRoutes.ts`.
- New worker/reconciliation: `backend/push/durableWakeRuntime.ts`.
- Registration and lifecycle: `backend/push/privateWake.ts`, `backend/push/wakeDispatcher.ts`, `backend/api/deviceTrust.ts`.
- Post-insert and post-admission hooks only: `backend/db/index.ts`, `backend/socket.io/listeners.ts`, `backend/socket.io/multiplexed.ts`.
- Startup/shutdown: `index.ts`.
- Explicit optional migration: `scripts/migratePushWake.ts`, compiler include in `tsconfig.backend.json`.
- Regression tests: `backend/push/durableWake.mongo.integration.test.ts`, `backend/push/privateWake.mongo.integration.test.ts`.

Review found no changes to Android, Web, E2EE primitives, calling wire format, ownership implementation, trust authority or mailbox ACK logic. This is a scoped engineering review, not independent security certification.

## Operator runbook — future approval required

These are proposed actions only; none were executed on application or production data.

1. Keep FCM off. Confirm a replica set/sharded Mongo supporting transactions and inspect duplicate registration-owner conflicts without exposing token values. Standalone Mongo cannot support this registration rotation contract.
2. After separate approval, compile with `npm run build:backend`, then explicitly run `node dist/scripts/migratePushWake.js --apply` against the approved target. The script requires MONGO_URI/MONGO_DB_NAME and FCM off; never paste those values into reports. Migration is not chained to core startup. Failure may leave partial optional schema; keep FCM off, investigate, and rerun idempotently after correction. Never remove mailbox rows to fix notification setup.
3. Verify all optional indexes/validators and 1,024 slots. Confirm existing signed-device proof configuration. Only then separately configure owner-managed Firebase project/service-account access and approve enabling the existing feature gate. No credentials belong in source control.
4. Use a disposable opted-in Android identity with notification permission, unlocked/eligible lifecycle and fresh authenticated room admission. Persist encrypted mail, compare aggregate queue/provider counters, verify generic notification, then authorized replay. Verify locked-state behavior, revoked/rotated registration and provider outage. Provider acceptance alone is insufficient.
5. If unavailable/failed/overflow counters increase, first check optional schema readiness, capacity, current authenticated binding and provider configuration using approved internal access. Never log raw rows, tokens, provider exception text or participant labels. No binding means reconnect/re-admit, not bypass authorization.
6. Roll back notification operation by turning FCM off through a separately approved configuration action and stopping the worker. Leave optional collections inert; do not drop mail, change ACKs or claim this removes retained metadata immediately.

Remaining requirements: independent review of database/authentication changes; approved optional migration and real provider setup; physical notification tests with F1a. No background incoming-call behavior is included.
