# Phase 6B.8 sync state machine

Normative design only. Uses the [protocol](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md).
Overall status remains NOT READY at its membership-ordering gate. States here
are adapter states, not changes to the existing device lifecycle enum.

## 1. Device adapter state

| State | Meaning | Permitted behavior |
| --- | --- | --- |
| `pending` | Existing lifecycle pending or approved-pending-confirmation | Restricted existing enrollment ceremony; no user-content sync |
| `approved` | Active lifecycle plus locally pinned scope, verified peer and reconciled checkpoint | Request/participate in admission; read eligible local data |
| `syncing` | Approved and participating in one admitted batch | Only manifest-bound operations while admission remains valid |
| `suspended` | Unknown trust, conflict, restart, missing peers, expiry or uncertain persistence | Local cached reads under vault policy; authenticated reconciliation only; no content release/import |
| `revoked` | Authenticated lifecycle revokes local device | No sync or new sessions; lock/cleanup via existing boundary; no recovery shortcut |

Transition table is exhaustive. Unlisted transitions reject without state mutation.

| From -> to | Trigger and durable precondition |
| --- | --- |
| pending -> approved | Existing target confirmation/activation committed; scope and checkpoint directly reconciled; no user content used to establish trust |
| pending -> suspended | Bootstrap identity conflict, failed persistence or expiry |
| pending -> revoked | Existing authorized lifecycle revocation |
| approved -> syncing | Local READY plus all required matching peer readiness under protocol §6 |
| approved -> suspended | Any freshness/persistence ambiguity, peer loss or membership change |
| approved -> revoked | Verified local revocation |
| syncing -> approved | Durable successful/failed terminal evidence for batch; unchanged trust; reservation safely released |
| syncing -> suspended | Admission invalidation, uncertain result, conflict or unknown terminal evidence |
| syncing -> revoked | Verified local revocation; cancel work immediately |
| suspended -> pending | Original incomplete enrollment may safely resume through existing ceremony; no identity replacement |
| suspended -> approved | Direct same-checkpoint reconciliation and all uncertain operation states resolved; membership reconfiguration remains blocked by protocol §10 |
| suspended -> revoked | Verified local revocation |

`revoked` is terminal for this stable device identity. Self-transitions are
idempotent only for the identical persisted event. `pending -> syncing`,
`revoked -> approved`, or generic snapshot-driven activation always reject.
On restart an approved/syncing device begins suspended; persisted lifecycle state
does not restore live admission. Suspend/resume cannot extend a deadline.

## 2. Transfer state

| State | Durable meaning |
| --- | --- |
| `created` | Manifest, selected eligible data and local consent are frozen |
| `authorized` | Local admission READY plus required direct peer evidence exists |
| `transferring` | At least one chunk is encrypted/released or durably staged |
| `verified` | All chunks, complete digest, permissions, causal dependencies and current deletion frontier pass; not yet visible |
| `completed` | Receiver atomically committed data/replay/COMPLETE; sender reaches this only after authenticated COMPLETE |
| `failed` | Terminal failure for this transfer ID; reason and any uncertain outcome retained |

Allowed: `created -> authorized -> transferring -> verified -> completed`.
Source may move `transferring -> completed` only on valid receiver COMPLETE;
it never invents receiver verification locally. Any nonterminal state may go to
failed on rejection, expiry, epoch change or unrecoverable uncertainty. Completed
and failed never reopen. A new transfer may contain unchanged logical record IDs,
but must receive a fresh ID/admission and pass the entire current policy.

Duplicate identical input does not transition twice. An identical chunk already
staged yields the cached RECEIPT; conflicting bytes for the same index fail.
COMPLETE before all validation/application is forbidden. A source cannot mark
completed after a mere RECEIPT or transport delivery ACK.

Final verification and commit are serialized with local deletion/trust updates.
If a deletion/epoch change arrives between verification and commit, abort or
revalidate; never publish the superseded snapshot. Admission must remain valid
at commit. A remote delayed completion does not renew an expired reservation.

## 3. Admission substate

`none -> proposed -> prepared -> ready -> terminal`, with `uncertain` reachable
from every nonterminal state. Prepared and ready are durable locks for the exact
manifest/epoch. Direct peer deny causes failure; missing decision causes suspended
uncertainty. No timeout elects a winner or produces commit evidence. All-active
and lifecycle transition rules must satisfy protocol §10 before deployment.

Local revocation closes the target gate immediately. Existing admissions become
invalid locally, pending transfers fail, and published ciphertext is classified
as potentially exposed. `globalFence=unknown` persists until a specified valid
reconfiguration proves otherwise. It is never inferred from best-effort delivery
of a trust event or from deletion of an outbox row.

## 4. Crash recovery contract

The inspected `VodozemacRuntime.encrypt/decrypt` persists session progress before
returning. Sync storage is a separate transaction. Do not claim shared atomicity
or roll back ratchets to repair a lost result. The following conservative rules
are mandatory around those existing APIs.

| Crash/failure point | Durable evidence | Recovery |
| --- | --- | --- |
| Before outbound intent | No envelope reserved | New admission needed after restart; original consent/data revalidated |
| After outbound intent, before/inside encryption | Intent only; ratchet progress unknown | Mark stream uncertain, close dedicated session, fail transfer. Never reuse reserved sequence or reconstruct old ratchet. |
| After encryption returns, before ciphertext outbox write | Intent without exact envelope | Same uncertain procedure; original application data may later be freshly exported under a new session/transfer. |
| After durable ciphertext, before/during network send | Exact ciphertext + intent | Do not release after restart without valid admission; old transfer fails. No re-encryption of the uncertain envelope. |
| Before receive intent | Nothing consumed | Reject/receive normally only after admission; no stored success assumed |
| After receive intent, before/inside decrypt | Ciphertext digest/intent; no authenticated staging | Ratchet may have advanced. Close dedicated session and fail transfer; never replay against a restored older state. |
| After decrypt returns, before vault staging | Same incomplete receive intent | Same uncertain procedure. Request fresh export after fresh session/admission; no false ACK. |
| After authenticated staging commit | Vault plaintext, validated frame, digest, receipt record | No second decrypt; staging stays invisible. Restart invalidates admission, so transfer fails; delete staged payload after retaining replay/failure evidence. |
| During final application | Atomic batch transaction outcome queried from durable journal | Either all records/replay/COMPLETE are present, or none. Unknown transaction outcome keeps device suspended; do not start another writer. |
| After final commit, before COMPLETE sent | Durable COMPLETE and applied record versions | Do not apply twice; send cached response only after current authenticated peer validation. No new data transfer is implied. |
| After COMPLETE sent, before source receives it | Receiver complete; sender uncertain | Receiver may repeat cached COMPLETE. Source remains uncertain until evidence or terminal failure; receiver does not undo committed data. |

Closing a dedicated session uses its existing public lifecycle API. Establishing
a replacement requires ordinary verified bootstrap and a new stream ID; it is
not key recovery. Application records stay in the source's own vault, allowing
eligible re-export. If data is no longer retained, report a gap. No secret-bearing
session material is copied. Correctness is favored over transparent availability.

## 5. Persistence and rollback

Future storage adapter must offer atomic local transactions for record updates,
replay claims, tombstones, cursors and ACK state plus compare-and-swap on expected
checkpoint/version. Across processes enforce real uniqueness and serializable
updates; a JavaScript mutex is insufficient. This is a persistence requirement,
not a server authority to decide a lifecycle branch.

Lower epoch, same epoch/different commitment, missing high-water data, incompatible
operation digest, partial-record read or broken chain suspend. No attempt to
repair by choosing the larger timestamp or accepting server "latest". Complete
rollback of every independent trusted checkpoint is undetectable locally; sync
remains unavailable until direct trusted reconciliation establishes continuity.

## 6. Required transition tests

Enumerate every allowed and forbidden transition, including same-ID conflicting
duplicates. Fault each crash-table row with durable storage and independent
processes; assert no premature display, network release or ACK. Test revoked and
old-epoch session handles, epoch change after verification, lost COMPLETE,
expired admission after suspension, and receive-ratchet progress without staging.
Cryptographic stubs cannot substitute for the persistence-ordering tests.
