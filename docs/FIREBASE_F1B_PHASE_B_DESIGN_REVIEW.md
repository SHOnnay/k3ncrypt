# Firebase F1b Phase B — historical database/lifecycle proposal

Historical proposal, subsequently approved by the owner. See [implementation and validation](FIREBASE_F1B_PHASE_B_IMPLEMENTATION.md) for current behavior and documented deviations. The following text preserves the original review proposal.

Original status: design for owner review only. No schema, migration, worker or durable retry has been implemented. Phase A is commit `406b1f11` on `codex/backend-firebase-f1b`, based on `9aec504f74f2981f80b61347b9584a35c823ef2d`.

## 1. Decision and availability tradeoff

Recommend a **fixed-capacity optional MongoDB wake queue after mailbox persistence**, not an all-or-nothing mailbox/outbox transaction. Use the existing MongoDB and backend process; no second service, paid infrastructure or Android wire change.

A transaction that requires both mailbox insertion and queue insertion would fail when the queue is full, its indexes/validator are unavailable, or its write fails. That violates the priority that a notification failure cannot reject encrypted mail. Conversely, a separate post-commit enqueue has a crash gap. There is no unconditional guarantee of both atomic enqueue and unchanged mailbox availability with that design. Do not describe it as transactional outbox/exactly-once delivery.

Proposed order:

1. Persist encrypted mail under existing dedupe/slot/FIFO rules; this remains the authoritative operation.
2. Return sender acceptance independently of notification work. Schedule optional bounded recipient resolution/enqueue only after successful persistence. No notification transaction/session is passed into the mail insertion.
3. Enqueue/coalesce in the bounded queue. Failure, capacity exhaustion or unknown binding increments an aggregate counter and returns; no mail rollback, rejection, claim, retry-state change or ACK.
4. On startup, recover already queued jobs from expired leases. Separately, perform a bounded best-effort scan of *already persisted active mail* from the last 60 seconds to repair some persistence-to-enqueue gaps. A crash/overload/long downtime can still lose a wake hint, never encrypted mail. Existing reconnect/replay remains the recovery authority.

Rejected for this milestone: unconditional wake fields on every mailbox row (extra global storage/retention plus mailbox-write coupling); an unbounded outbox; pretending a transaction can be optional after it has aborted the mailbox write. If strict atomic wake intent is later required, review the mailbox-write change and degraded-mode contract separately.

## 2. Documents and hard bounds

All identifiers below are **server-internal**; none become FCM payload fields. JSON examples use descriptive placeholders, not credentials. Dates are BSON Date; fencing counters are BSON Int64, never lossy JS numbers.

### A. Existing `device_push_tokens_v1`

Preserve existing token hash `_id`, raw provider token, signed owner/device/identity, trustEpoch and updatedAt. Add server-generated `registrationVersion` (UUID) on every authenticated register/rotate. It is an ABA/version fence, not identity authority. Never derive trust from it.

Indexes proposed:

- Existing unique `_id` (token hash), preserving prevention of token reassignment to another owner.
- New unique `{ accountIdentityReference: 1, deviceId: 1 }` for one current token per device.

Rotation/remove use a short transaction confined to notification registrations: authenticated owner is verified by the existing authority/proof/signature path; delete own previous token and insert/update the replacement atomically. Unique owner/device and token indexes prevent cross-instance write skew. A transaction failure rejects/retries registration only, never a message. Recheck device lifecycle/epoch before and after; a stale row still cannot be dispatched because every send rereads existing device trust. Do not modify trust epochs to serialize notifications.

Preflight must detect duplicate owner/device rows before adding the unique index. **Do not arbitrarily delete/select one**; report conflicts for explicit resolution. Backfill a random registrationVersion only with a conditional update of the exact observed old row. Missing version is ineligible for durable dispatch until repaired or authenticated registration refresh; encrypted mail stays usable.

### B. `device_push_routes_v1`: one bounded document per registered device

```js
{
  _id: "SHA256(domain || account || device)",
  accountIdentityReference: "existing owner",
  deviceId: "existing device UUID",
  deviceIdentityReference: "existing pinned public-identity reference",
  trustEpoch: 1,
  revision: "server UUID",
  routes: [ // max 32, no duplicate key
    {
      key: "SHA256(k3ncrypt:push-route:v1 || room || routingAddress)",
      room: "existing room UUID", routingAddress: "existing recipient address",
      identityReference: "fingerprint from validated live publication",
      verifiedAt: ISODate(), validUntil: ISODate()
    }
  ],
  updatedAt: ISODate(), expiresAt: ISODate()
}
```

Bounds: 32 routes/device, 32 KiB BSON/document, validUntil at most 30 days from successful authenticated admission. Trim expired routes before updates. At capacity, decline additional optional bindings and count rejection; do not evict a route silently or block the conversation. Owner can reconnect/rebuild after explicit future policy; no new management UI is included here. Document expiresAt is the latest remaining route expiry. TTL cleanup is eventual; every read enforces validity itself.

Indexes: unique `_id`; unique `{ accountIdentityReference: 1, deviceId: 1 }`; unique multikey `{ 'routes.key': 1 }` with partial filter `{ 'routes.key': { $exists: true } }`; TTL `{ expiresAt: 1 }` with expireAfterSeconds 0. Empty arrays, duplicate keys within a document and concurrent conflicting owners require real-Mongo validation. Do not turn on dispatch if those invariants cannot be enforced.

Binding lifecycle:

- Capture only after a successful existing authenticated legacy join or Mux subscription, with current room capability check, active device proof/epoch, valid routing renewal proof and unexpired publication. Compute the existing identity fingerprint and require it to equal the proof-bound deviceIdentityReference. A mismatch suppresses this optional wake binding; it must not rewrite trust or silently change room admission behavior.
- Persist this *notification eligibility pointer* after admission. It cannot authorize joining, sending, decryption, verification or ACKs. Never replace existing admission checks with this table.
- If push is not registered, do not create a binding. Existing already-connected sessions may need a genuine reconnect after opt-in; do not fabricate an admission from a token registration. No automatic backfill from expired prekeys, bearer-only requests, arbitrary mailbox fields or network presence.
- Subsequent prekey expiry alone does not delete this established pointer. Before wake dispatch, require current matching device identity/epoch, current registration, a nonexpired route entry and an existing room not marked deleted/expired. A missing/ambiguous trust/room record fails closed. Existing relay/prekey renewal requirements remain unchanged.
- Identity/epoch change invalidates old entries until a fresh authorized admission. Room deletion/expiry invalidates its entries. Signed opt-out/removal cancels corresponding queue work and conditionally retires notification route state. Revocation remains authoritative immediately through device_lifecycle checks even if cleanup is delayed.
- Token rotation within the same unchanged active device epoch need not recreate valid route entries. Cleanup must compare observed owner/epoch/revision so an old operation cannot delete a replacement.

This duplicates some existing server-side relationship metadata. It is a new metadata-retention/privacy decision requiring approval, not a cryptographic identity authority. No raw capabilities, renewal secrets, proofs, private keys or prekey bundles are stored here.

### C. `private_wake_slots_v1`: exactly 1,024 reusable slots

```js
{
  _id: 0, // integer 0..1023, preallocated; never upsert outside this range
  slotGeneration: NumberLong(1),
  state: "idle|pending|leased",
  registrationId: "token hash", registrationVersion: "server UUID", trustEpoch: 1,
  routeKeys: ["validated route key"], // at most 8
  event: { id: "random UUID", createdAt: ISODate(), expiresAt: ISODate() },
  attempts: 0, // 0..3 application provider invocations across all workers/restarts
  nextAttemptAt: ISODate(),
  requestGeneration: NumberLong(1),
  lease: { id: "random UUID", fence: NumberLong(1), until: ISODate(), capturedRequestGeneration: NumberLong(1) },
  successor: { // at most one coalesced newer wave, only when current wave is leased
    id: "random UUID", createdAt: ISODate(), expiresAt: ISODate(), routeKeys: ["max 8"]
  }
}
```

Idle rows contain only `_id`, slotGeneration and state; unset all registration/event/route/lease fields when recycling. Maximum BSON size 4 KiB/slot, at most 4 MiB document payload plus fixed indexes. Preallocate exactly 1,024 slots in the separately approved migration; strict collection validation limits `_id` to integer 0..1023, states, field types, array limits and no unknown fields. No dynamic fallback collection and no unlimited successor list. Never recycle a live unexpired lease just to admit another request. Overflow skips/coalesces the wake only.

Indexes:

- Unique `_id`.
- Unique `{ registrationId: 1 }`, partial `{ registrationId: { $exists: true } }`; unset it on idle rows.
- `{ state: 1, nextAttemptAt: 1, _id: 1 }` for due work.
- `{ state: 1, 'lease.until': 1, _id: 1 }` for abandoned leases.
- `{ 'event.expiresAt': 1, _id: 1 }` for bounded recycling. **Not TTL**: TTL must not delete preallocated slots.

Queue producers coalesce an existing exact registration/version with atomic conditional updates. For a free slot use findOneAndUpdate on an observed idle/expired-unleased slot, increment slotGeneration, and initialize the wave. Up to 16 allocation attempts per enqueue; unique registration collisions reread/coalesce. Never update a leased wave's immutable event ID. New accepted mail during a lease populates/merges only its one successor and advances requestGeneration. No successor expiry extension beyond 60 seconds from its first creation; more recent activity after expiry can start a genuinely new wave.

## 3. Worker, leases, retries and fencing

- One optional worker loop per existing backend process; no new fleet/service. Disabled unless existing FCM gate AND reviewed optional schema/index readiness pass. Maintenance pauses acquisition/dispatch. Missing optional schema disables wakes, not core /api/ready or mail persistence.
- Poll at most once/second, batch at most 16; at most 32 live jobs/provider requests per process (including timed-out uncancelable requests). Empty queues back off up to 30 seconds; notification enqueue may wake the same bounded loop. Timers are canceled at shutdown; no per-message permanent timer.
- Atomic findOneAndUpdate claims only due, unexpired work with no current live lease, increments a fence and sets a random lease ID. Initial lease 15 seconds, heartbeat every 5 seconds while work is owned, never past event expiry. Use Mongo server time for lease comparisons/updates; no assumption of synchronized backend clocks.
- Before each send: compare slotGeneration, lease ID/fence and event expiry; reread exact current registrationVersion/token/epoch and existing durable device trust; validate at least one referenced route as above. A route is not permission to use a different/new token. No route/trust lookup success means no provider send.
- Persist attempt increment under the lease BEFORE provider invocation. Three attempts maximum for a wave, including crashes in the send window. Application provider deadline is min(5 seconds, remaining event lifetime). Reuse the exact event UUID, createdAt and expiresAt across retries/restarts; FCM TTL is remaining lifetime, never reset to 60 seconds.
- Known transient failure: retry at 250ms then 500ms (or a provider Retry-After if available and later), only if next attempt fits the original lifetime. Quota/rate-limit: minimum 60-second deferral, normally terminal expiry for this wave. Definitive invalid-token: exact registrationVersion/hash/owner/epoch CAS retirement; never generic invalid-argument/auth/configuration errors. Unknown/permanent errors are terminal for the wave, not the device.
- Every result/release/promote update filters slotGeneration + lease ID/fence. An old worker cannot clear a new wave or overwrite a newer result. If successor exists, promote it atomically with a fresh wave and reset attempt count for that new activity; otherwise recycle slot. Compare request generation to prevent completion racing a new enqueue.
- Timeout is **ambiguous**, not definite rejection. While the original process lives it retains its provider slot and renews ownership until SDK settlement or wave expiry, and starts no overlapping local send for that registration. After process death an expired lease can be recovered within the event lifetime/remaining attempt budget. A late SDK response/process pause can still race lease takeover; FCM has no application fencing/idempotency transaction. Exactly-once external send is impossible. Same-event duplicates are bounded and handled as generic wake hints; never duplicate mail acceptance/ACKs.
- Provider acceptance records only notification acceptance, not device delivery, user visibility or mailbox consumption. A restart after provider acceptance but before Mongo result commit can cause another same-event send. Revocation/rotation after final authorization but during an external send cannot recall that packet. Existing recipient trust/vault checks and generic payload contain the impact.

## 4. Gap reconciliation and boundedness

The queue itself has a strict 1,024-slot bound independent of user count/message rate. Accepted mail is never held waiting for queue capacity.

Propose a nonunique optional mailbox index `{ timestamp: -1, _id: -1 }`. On startup/re-enabled worker, scan only active, unexpired persisted rows whose timestamp is within the last 60 seconds. Use indexed range/cursor pagination (32 rows/batch), at most 512 rows and 2 seconds per recovery pass, never a collection-wide rescan or persisted unlimited cursor. Resolve each through current authenticated route state and attempt bounded enqueue. Do not requeue old seven-day backlog or reinterpret rejected rows. Quota/time budget exhaustion records an aggregate recovery-limit counter and stops.

This repairs some crash gaps but can miss wakes under overload/downtime. It can also produce a duplicate generic wave after a prior completed wave was recycled. A persistent unlimited per-message success ledger is intentionally not proposed. Existing Android generic notification ID/collapse behavior and dedupe help; they are not proof of exactly-once notification. Restart correctness means persisted *pending jobs* recover with bounds/fencing, not every message necessarily generates a push.

## 5. Retention, compatibility and multiple processes

- Mailbox documents, seven-day expiry, dedupe keys, slot/FIFO claims, cryptographic envelopes and ACK deletion remain unchanged. Queue operations never take/extend a delivery claim. A message ACK/deletion racing a push is not an error or a new delivery receipt.
- Queue events expire at 60 seconds; release expired slots and erase identifiers in bounded batches. Route records expire after at most 30 days unless renewed by a new authenticated admission; individual expired routes never become valid via document TTL lag. Registrations remain owner-controlled; invalid/revoked entries conditionally retired.
- No old message backfill/migration. Existing routes are not guessed: clients require a fresh successful authorized admission to populate pointers. Old registration versions are conditionally backfilled as metadata only; conflicts block optional FCM activation, not messaging.
- Core startup/readiness must not invoke new migration or require optional wake indexes. Operator explicitly applies approved optional schema/index setup while FCM is off, validates it, then separately authorizes a controlled provider test. Rollback disables worker/FCM and leaves inert optional collections; never drops mailbox data or indexes.
- Concurrent backend processes use the same unique queue/registration constraints and CAS leases. They can duplicate external FCM sends in ambiguous failure windows, but cannot grant trust, steal a newer lease or ACK mail. Resource cap is **32 times explicitly configured backend process count**, not a fictional cluster-wide 32. Production remains single-instance; this does not approve multi-instance conversation ownership, rolling releases or another worker deployment.
- Raw provider tokens stay in existing registration storage/provider requests, not queue payloads or logs. Route/queue records expose server-internal linkage to database administrators; limit access and retention. FCM receives only existing version/type/random eventId/createdAt/expiresAt, never token hashes, registration revisions, slot IDs, route keys, room/account/device/contact IDs, message IDs, content or keys. Transport targeting necessarily provides FCM the destination registration token; it must not be duplicated in the data payload or diagnostics.
- Counters remain aggregate/process-local and reset on restart. No provider exception text, per-user labels or persistent diagnostic trail. No guaranteed Firebase delivery, background call wake or new Android synchronization authority.

## 6. Required tests before implementation can be accepted

Existing test environment: disposable loopback `mongo:7` single-node replica set, no mounted application data; transaction commit/rollback capability was proved. No Phase B schema or recovery algorithm was exercised. Tests must use a fresh instance after design approval, never owner application databases.

Real-Mongo tests required, beyond mocks:

1. Validate strict slot/document limits, unique partial/multikey indexes, empty route arrays, duplicate route ownership and transactional token rotation/rollback.
2. Saturate all slots: the next encrypted message still persists and retains ordinary ACK/FIFO behavior; only enqueue fails. Simulate optional index/collection/transaction outage independently of mailbox collection.
3. Two independent workers claim the same job; only one current DB lease. Kill claimant before send/after send/before result commit, reconstruct worker and prove bounded same-event recovery and stale-result fencing. Test generation reuse/ABA and successor arrival during completion.
4. Provider timeout with uncancelable request, late success/rejection, expired lease, clock differences, three-attempt cap, event expiry and bounded full-queue recovery scan. Observe possible duplicate generic sends honestly.
5. Concurrent rotation/removal/revocation while queued/in-flight; an old worker cannot delete/register/retarget a new token or revive a revoked device. Same token re-registration gets a new server revision.
6. Missing/expired prekey with an already valid independently authenticated binding can notify; no prior binding or unknown/mismatched device identity cannot. Deleted/expired room and expired route reject. Prove no existing relay authorization uses this table.
7. Historical mail/registrations without optional state, migration preflight conflicts, restart, cleanup, rollback with FCM off and standalone Mongo registration failure: encrypted mail behavior remains unchanged.
8. Payload/diagnostic privacy assertions, bounded memory/timers/document count under outages and concurrent producers. Real FCM/device tests are a separate approval after these pass.

## Requested owner decision

Approve or reject the above exact **post-persistence fixed-capacity queue**, authenticated route-pointer lifecycle, registration revision/unique-owner migration, bounded gap-repair limits and explicitly non-guaranteed enqueue/external delivery semantics. If atomic mailbox+intent is required instead, approve a separate availability-contract design first. No schema implementation should start on this document alone.
