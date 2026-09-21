# Phase 6B.8 synchronization threat model

Status: design only, baseline `09f121b61f189701a15a88c3140364580b9bf48a`.
Controls below are proposed requirements, not results of executed attack tests.
See [architecture](PHASE6B8_MULTI_DEVICE_SYNC_ARCHITECTURE.md) and
[roadmap](PHASE6B8_IMPLEMENTATION_ROADMAP.md) for the corresponding release gates.

## Assets and trust boundaries

Protected assets: message/history confidentiality, contact relationships,
verification decisions, common user-scope membership, private device keys,
session state, vault data, causal journals, epoch/high-water checkpoints, deletion
tombstones, and availability of an accurate user-visible state.

Trust is local and explicit: independently generated device keys, authenticated
modern sessions, pinned peer identity, existing lifecycle approval plus target
confirmation, and client validation of accepted checkpoints. A server may
coordinate storage/ordering but its response is never membership authority.
Hashes are not signatures. A peer's pairwise authenticated plaintext cannot be
forwarded to another device as independently verifiable authorship evidence.

Adversaries include a malicious delivery/database operator, network attacker,
malicious contact, stolen unlocked device, compromised active device, revoked
device with historical keys, and components running stale state. Attackers may
delay, duplicate, reorder, suppress, fork, or restore records and race revocation.
An attacker controlling an authorized endpoint can read that endpoint's allowed
data and issue actions within its authority. No protocol here repairs that
compromise or guarantees deletion of data already delivered.

## Attack and defense matrix

| Attack | Asset/boundary | Required defense | Residual limitation / acceptance experiment |
| --- | --- | --- | --- |
| Malicious server substitutes a fake phone bundle or user scope | Enrollment and same-user identity | Explicit fingerprint comparison; session-bound identities; target confirmation; pin existing user scope | User comparison errors remain. Substitute both routing and payload identities; activation and export must reject. |
| Server marks a phone approved or injects a device-list hash | Membership authority | Lifecycle verification on clients; no server-only trust; hashes never authorize | Server may deny service. Deliver a well-formed list/digest with no authenticated ceremony; no transfer. |
| Compromised active laptop enrolls attacker | Authorized-device powers | Existing authority ceremony, explicit target confirmation, visible device list and revocation | A fully controlled authorized issuer plus malicious target may satisfy the policy. No claim of resistance without changing the authority model. |
| Stolen phone reads cached history | Endpoint/vault | Existing vault locking and platform protection; minimize retention | Unlocked endpoint/plaintext cannot be recalled. Test honest-client cleanup without describing it as remote wipe. |
| Revoked phone uses old session, queue or attachment reference | Operation admission | Current membership/epoch gate, no new destination encryption, close wrappers, reject pending old-epoch work, independent attachment authorization | Already received ciphertext can remain decryptable. Test retry, cached call handles, signaling receive and download adapters, not only lifecycle functions. |
| Malicious server hides revocation from isolated peers | Distributed freshness | Persist uncertainty; fresh directly authenticated admission from current members; serialize admission against lifecycle changes | Partitions sacrifice availability. In-flight pre-revocation data cannot be recalled; unlimited offline safety is impossible. Test split views and suppressed updates. |
| Server sends future epoch then restores old state | Checkpoint/reconciliation | Quarantine content path persistently; authenticate lifecycle catch-up; retain high-water | Unauthenticated hints must not install trust; bounded availability attack remains. Restart after the rejected event must not resume old trust. |
| Replayed sync package or ACK after restart | Exactly-once apply | Scope/device/epoch-bound IDs, durable per-author sequences, atomic replay/application/ACK state | Storage rollback can defeat purely local evidence. Replay before/after crash and after compaction; no second application. |
| Modified/reordered/truncated sync snapshot | Content integrity/completeness | Existing session authentication, manifest/chunk binding, exact counts/digests, atomic staging | Source device can lie about its own export. Tamper each header/payload, omit a chunk, substitute another transfer; nothing becomes visible. |
| Wrong recipient or device substitution | Device isolation | Check both public identity references against pairwise session context | Routing IDs alone are insufficient. Relay B's package to C; it must not import. |
| Cross-purpose injection into call/chat parser | Protocol separation | Dedicated same-user session, versioned sync discriminator and allow-listed parser | Current framing must first be proven correct. Send sync as enrollment/call/message and vice versa; reject. |
| Old history presented as live contact message | Provenance and user trust | Imported-history type, source attribution, no outbound replay or forged original-contact signature | Authorized source can fabricate an alleged history entry. UI must not claim independent sender authentication for imported text. |
| Contact verified flag copied to wrong fingerprint | Verification integrity | Preserve evidence/provenance; local re-confirmation; changed identity blocks | More verification work on new devices. Mix identity and verification records from different snapshots; do not trust. |
| Offline edits resurrect deleted messages or unblock contact | Causal state | Tombstones, explicit causal dependencies, restrictive security conflict rule | Permanent deletion cannot remove an adversary's copy. Replay pre-deletion snapshots and concurrent unblock; no silent restoration. |
| Same-epoch list fork, stale writer, or concurrent add/revoke | Lifecycle consistency | Existing epoch/commitment verification plus shared atomic commit; conflicting views quarantine | No automatic fork winner. Race real independent instances and verify one coherent committed branch or unavailability. |
| Malicious active device supplies conflicting sequences | Journal integrity | Previous digest and durable sequence binding; reject same sequence/different digest | Compromised device can withhold data or cause denial of service. Require explicit investigation/revocation. |
| Crash after encrypt, before outbox; crash after apply, before ACK | Ratchet and persistent state | Crash-safe envelope persistence; atomic importer and replay/ACK state; quarantine uncertain operations | Existing primitives alone do not promise cross-record atomicity. Fault every write boundary and restart with actual storage. |
| Restore all vault records to an older valid snapshot | Rollback protection | Reconcile against independently retained authenticated peer checkpoints before use | If every trusted copy is rolled back/lost, local detection cannot be guaranteed; block rather than invent continuity. |
| Oversized/gapped/deeply nested packages exhaust memory | Availability | Pre-allocation limits, bounded manifests/causal graphs, quotas, expiry and backpressure | Authorized peers can still waste quota; no permissive parser fallback. Test resource ceilings under concurrent streams. |
| Relay correlates fan-out and sync time | Metadata privacy | Opaque per-destination handles, encrypted manifest/ACK, coarse logs, bounded padding/batching | Device count and relationships may be inferred from IP/timing/traffic; no anonymity guarantee. |
| Plaintext leaks through logs/temp files/backup | Confidentiality | Allow-listed export, in-memory handling, own-vault persistence, payload-free diagnostics | Compromised client OS remains outside protection. Inspect server, logs, staging, browser storage and crash artifacts with canary content. |

## Security invariants to verify

1. No data export before active target confirmation and fresh same-scope admission.
2. No private identity key, session pickle, raw vault, vault key, recovery secret
   or device impersonation capability crosses the sync boundary. Attachment
   access requires its own reviewed authorization; generic sync grants none.
3. Every content import is authenticated to a known active source and the exact
   local target at an admitted epoch/commitment; generic records cannot alter trust.
4. Unknown/conflicting lifecycle state blocks content across restart. Lifecycle
   reconciliation traffic is separately constrained and cannot carry user history.
5. No ACK or cursor advance precedes durable application. Duplicate identical
   records are idempotent; conflicting duplicates fail.
6. Revocation prevents future admitted content delivery, not access to plaintext
   already possessed. A target's cooperation is not required to revoke it.
7. Imported verification and history never acquire stronger provenance merely by
   being synchronized. A server-provided contact mapping cannot enable B to send.
8. Safety under partitions is obtained by blocking cross-device transfers; cached
   local reads are explicitly distinguished from fresh remote authorization.

## Admission assumptions and revocation race

The strict initial policy requires all active devices' fresh, directly
authenticated participation for a bounded sync batch. This is not threshold
membership authority: existing lifecycle rules still decide adds/removals.
The future serialization adapter must prevent honest members from approving
incompatible admission/mutation decisions and persist those decisions across
restart. A server cannot replace those authenticated decisions with a database
row. If an active device is unavailable, sync waits or the user explicitly revokes
it; timeout alone cannot create a new membership list.

An operation already admitted before revocation may have ciphertext in flight.
The revocation completion contract must fence/drain admissions and distinguish
committed removal from successful remote cleanup. A malicious endpoint may
retain old keys; a malicious relay may retain old envelopes. Neither an epoch
number nor an event ACK makes prior ciphertext undecryptable.

## Required evidence before security acceptance

Use three independent devices with different keys and durable stores, multiple
service processes, and a programmable delay/drop/reorder/fork transport. Include
real lifecycle runtime, real vault boundary, and real Vodozemac sessions where
available. Stubs may inject faults but must not return unconditional trust or
stand in for cross-instance atomicity. Tests must assert denied operations have
no decrypt/render/send/ACK side effects. Exercise full restore and migration of
test data, not only in-memory functions.

Current readiness: **not accepted for production**. This document makes no new
attack-test pass claim. Existing reports provide historical evidence, but their
local checks do not establish distributed freshness or complete synchronization.
