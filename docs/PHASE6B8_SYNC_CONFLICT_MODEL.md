# Phase 6B.8 sync conflict model

Normative design only. Depends on the [protocol](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md)
and [record permissions](PHASE6B8_SYNC_RECORD_PERMISSION_MODEL.md). No last-write-wins
by wall time, delivery order, server sequence or lexical device ID is permitted.

## 1. Operation identity and causality

Each eligible local write reserves a durable author sequence before exposure.
Operation identity is `authorDevice:decimalSequence`. A device never resets or
reuses the counter; exhaustion or lost counter suspends writes. Its canonical
operation digest binds user scope, record/field, value, author, prior author digest
and the explicit parent-version set. Parent IDs sort lexicographically by UTF-8
bytes. Parent references must be known versions in the same record/field unless
the operation type explicitly denotes a known message read/deletion reference.

An operation causally supersedes the parents and their ancestors, not every
lower-sequence operation in the system. Concurrent operations have neither as
ancestor of the other. Missing dependencies are staged, never guessed. A bounded
snapshot may supply materialized historical versions plus explicit provenance;
it does not prove the original author's entire journal or authorize old trust
changes. Dependency depth/count above protocol bounds fails the batch.

Conflicting content for the same version ID is a fork: quarantine that record
and the submitting stream, retain evidence, and require reconciliation. Do not
drop the conflicting version silently or choose the first arrival as authentic.
An authenticated device may be compromised; authorization is still checked per
record. Local offline writes are tentative until current membership admission.

## 2. Ordinary field merges and worked example

Contact label and appearance fields use multi-value registers. Remove a value
from the current visible set only if an authorized new operation explicitly
causally supersedes it. Identical concurrent values may display once but retain
both version IDs as parents for future resolutions. Distinct concurrent values
display a conflict. No trust behavior depends on the displayed label.

Example, contact label initially `Sam` at version `L:1`:

1. Offline A writes `Samuel`, parents `[L:1]`, version `A:7`.
2. Offline B writes `Samira`, parents `[L:1]`, version `B:9`.
3. After admission, receivers retain both `A:7` and `B:9` regardless of arrival.
4. User chooses `Sam`, creating `A:8` with parents `[A:7,B:9]`. Both siblings
   are resolved on devices that receive that operation.
5. A late independent `C:4`, parents `[L:1]`, arrives. It was not covered by
   `A:8`; conflict reopens between `A:8` and `C:4`.
6. Another explicit choice referencing both current versions resolves it.

Different fields merge independently. A rename is not a fingerprint replacement.
For ordinary settings conflicts keep the last locally confirmed presentation
until explicit resolution; do not broadcast this local display choice as a merge.
On a newly imported unresolved field use the app default with a conflict marker.

## 3. Messages, read markers and conversation mapping

Messages are immutable application facts with provenance. Union nonconflicting
IDs, preserving each author's causal order. Concurrent appends may be displayed
in deterministic version-ID order for presentation only; that order conveys no
authority or real-world chronology. Duplicate matching ID/digest applies once.
Do not modify content under an existing ID; edits are outside v1.

The device that first introduces an application record allocates a random record
ID in the pinned scope. A replayed own-device replica preserves that ID. Two
devices independently observing the same remote message cannot deduplicate solely
by matching text, timestamp or plaintext hash; retain provenance until an existing
authenticated remote message identifier establishes equivalence. No fabricated
global delivery guarantee is allowed.

Conversation record IDs are own-scope replica IDs. The introducing device binds
the record to its observed contact fingerprint(s) and immutable protocol mode.
Import makes a local historical view only. It does not assign remote users to
that ID or create another device's live transport/session binding. Explicit local
contact verification and existing direct-session creation remain required;
unknown or conflicting identity mappings disable direct sending. This v1 scope
decision avoids inventing a new external-contact protocol.

Read state is the union of explicitly known read message IDs. Unknown IDs do not
mark future content read. Manual unread creates a versioned marker; clear names
every marker it covers. A concurrent unseen unread marker survives. There is no
single timestamp used as a global unread cutoff.

## 4. Security conflicts

| Object/action | Deterministic rule |
| --- | --- |
| Contact fingerprint observation | Different fingerprint for an existing contact creates changed/pending-review state; generic import cannot replace trusted identity. |
| Verification evidence | Preserve exporter/verifier provenance; it never grants local verified status. Use existing explicit local verification. |
| Block | Restrict on receipt of an authorized block operation immediately; cannot be overridden by a concurrent unblock. |
| Unblock | Outside v1 sync; local existing UX may unblock locally but cannot silently clear replicated blocks. Future synchronized unblock needs a reviewed explicit-resolution ceremony. |
| Device list/epoch | Lifecycle path only; stale rejects, same-epoch fork suspends. No ordinary operation can supersede a list. |
| Protocol mode | Immutable in sync; conflicting mode rejects/quarantines record, never migrates legacy. |

Restricting synchronized unblock is an explicit v1 narrowing of the earlier
generic conflict rule. It prevents implementations from guessing whether an
imported resolution is sufficient user confirmation for a trust increase.

## 5. Deletion, expiry and retained history

V1 synchronized deletion hides/removes an eligible own-scope record from all
honest replicas. It does not issue a new contact-side deletion request. Existing
local-only hide remains local. Deletion tombstones bind record ID, author,
operation ID and original scope; any authorized own device may request this
own-scope deletion after explicit local confirmation.

An accepted tombstone permanently dominates later imports of that record ID.
V1 has no undelete. Reusing the ID with different bytes is conflict. A compromised
active device can destroy availability by valid deletion; this follows existing
own-device authority and is not prevented by encryption.

Before snapshot commit, compare local deletion state against the selected source
frontier. A known tombstone excludes its record even if the snapshot is authentic.
Do not extend original expiration. When expiry cannot be safely interpreted under
existing retention policy, omit the record and report unavailable rather than
resetting its deadline. Do not introduce new message-expiry semantics here.

No tombstone or replay compaction in v1. Storage exhaustion pauses sync. Newly
enrolled devices receive all applicable retained tombstones within bounded batches
before content referencing that collection becomes visible. If prerequisites
exceed quota or are incomplete, block that collection and report a gap.

Offline beyond server TTL requires a current source snapshot. A missing record
is not automatically a deletion. When all authorized sources lack it, record a
history gap. Current exporters may re-export retained historical text originally
received from a now-revoked device, with current-exporter provenance. They cannot
launder that device's old lifecycle/verification/authorization operation into a
new epoch. Already committed valid history is not erased solely due to revocation.

## 6. Conflict resolution acceptance cases

Require permutation tests for ordinary edits; explicit resolution followed by
late sibling; identical values with distinct parents; unknown dependency, forged
parent and sequence forks; imported changed fingerprint; block versus local
unblock; tombstone versus old snapshot; expired original history; missing source;
and immutable legacy mode. All tests must assert both visible results and retained
causal evidence. Application ACK occurs only after these rules are applied.
