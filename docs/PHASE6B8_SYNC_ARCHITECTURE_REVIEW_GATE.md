# Phase 6B.8 synchronization architecture review gate

Review baseline: `7b5a18139d36b8ff12721cc29330dd5c5e2a2d72`.
Current verdict: **READY for implementation of the bounded blocking v1 profile**
in §14 and the [final authority decision](PHASE6B8_CONFLICT_AUTHORITY_DECISION_RECORD.md).
Prior NOT READY findings and the interim §13 disposition are retained as audit
history. This is not production readiness: unavailable old devices may prevent
sync resumption indefinitely, while local revocation still takes effect.
This is a design review: attacks below are reasoned counterexamples and required
experiments, not executed exploits or newly passing tests. No source is changed.

Reviewed inputs:

- [Sync architecture](PHASE6B8_MULTI_DEVICE_SYNC_ARCHITECTURE.md), especially
  sections 3–8.
- [Sync threat model](PHASE6B8_SYNC_THREAT_MODEL.md), including its admission
  assumptions and invariants.
- [Implementation roadmap](PHASE6B8_IMPLEMENTATION_ROADMAP.md), entry gates and S1–S4.
- [Final adversarial audit](PHASE6B_FINAL_ADVERSARIAL_SECURITY_AUDIT.md), open
  distributed persistence, propagation and target-runtime findings.

The foundations are appropriate: independent device keys, one explicitly bound
user scope, existing authenticated sessions, no server master key, no generic
trust import, and recipient-specific ciphertext. However, several required
protocol decisions are deferred to adapters and tests. An interface called
"serialization" does not specify how mutually distrustful or partitioned
participants agree. Passing local epoch checks cannot close that design gap.

## 1. Findings and severity

Severity describes the consequence of implementing the unresolved design
literally, not a claim that the proposed sync feature is deployed.

| ID | Severity | Evidence in design | Weakness / consequence |
| --- | --- | --- | --- |
| G1 | High | Architecture §6 steps 2–4; §8; threat-model admission assumptions | No complete admission/membership-change protocol, participant-set transition or revocation linearization rule. A server CAS alone would make server consistency an unstated trust assumption. |
| G2 | High | Architecture §3 steps 2–4 and final paragraph | Initial scope authentication, third-device ratification, and removal of an unavailable author are insufficiently specified. A pairwise transcript cannot act as a portable authorization certificate. |
| G3 | High | Architecture §5 and §7; roadmap S1 | Session progress, envelope persistence and application ACK are described as atomic without a concrete crash protocol. Consuming a ratchet message then losing staging may make retries permanently undecipherable. |
| G4 | High | Architecture §3 steps 5–7; §6 old-epoch rejection; §7 compaction | No complete post-retention or departed-author catch-up contract. Strict rejection plus expiring queues can lose history or tempt unsafe relabeling of old authorization. |
| G5 | High | Architecture §4 conflict table and contact compatibility; §7 | Record authority, resolution-operation semantics and shared conversation identity are not fully defined. Valid device authentication is not permission to rewrite any record. |
| G6 | Medium | Architecture §5 numerical limits; §6 60-second admission | Package bounds, clock semantics, authenticated uncertainty triggers and sequence namespaces lack executable specifications. Implementations can disagree or allow denial of service. |
| G7 | High, accepted-model risk | Threat model compromised active laptop row | A compromised authorized issuer and malicious target can complete both sides of enrollment. Target confirmation is not a second independent honest approval. |
| G8 | Medium | Architecture §4 history/attachments; §9 metadata | Historical re-export expands exposure and fan-out exposes correlation; attachment exclusion is safe but means complete media synchronization is not delivered. |

G1–G6 require normative design changes before relevant security-sensitive coding.
G7 requires explicit acceptance of the existing authority threat model, or a
separately approved authority redesign. G8 requires precise scope/privacy wording,
not a new cryptosystem. The audit's earlier implementation gaps remain open;
this review does not close them by reference to a design.

## 2. Bootstrap authentication and authority review

The proposed key exchange correctly creates a new device identity and fresh
pairwise sessions. A new phone cannot decrypt the laptop's old session ciphertext
without forbidden state copying. The laptop must export eligible application
records and encrypt them anew to the phone after activation.

Required amendments for G2:

1. Specify an immutable user-scope anchor and its local pinning rule. A user scope
   may refer to the original user's public identifier without sharing its private
   key; a device fingerprint, display name, or routing handle is not interchangeable
   with that scope. Define the exact authenticated binding tuple: scope, stable
   device ID, public identity reference, ceremony ID, purpose, target, epoch and
   commitment. Scope replacement must not happen through import.
2. Define a restricted bootstrap session before active membership. It may carry
   only bounded identity comparison, enrollment and target-confirmation controls.
   The phone must be able to confirm while pending without receiving history or
   acquiring ordinary-operation permission. A universal "active device required"
   guard would deadlock enrollment; a universal exception would escalate privilege.
3. Define which already trusted devices directly ratify the exact new checkpoint,
   when the phone begins participating in admissions, and what happens if the
   approving laptop disappears before ratification. Existing pairwise sessions can
   carry direct attestations; forwarded JSON, digests and other peers' ACKs cannot
   establish the alleged original author's identity. If evidence is unavailable,
   block and require the existing explicit verification ceremony.
4. Separate peer identity proof, lifecycle authority, target confirmation and
   content-export consent. An active phone's approval to join is not permission
   to export all history. Bind consent to the exact recipient and selected history
   frontier; changing the target or range invalidates it.
5. Persist ceremony replay claims and commit status at both ends. Define identical
   retry versus conflicting replay, target restart, expiry and issuer revocation
   between approval and activation. Never accept a server "already approved" flag.

One user with independent devices remains feasible. It does not imply identical
device fingerprints or automatic trust of new devices by external contacts.
Imported evidence must preserve its source. Contact re-verification on a new
device is a conservative policy, but the product must describe this as shared
contact records with device-local confirmation, not identical trust flags.

### Compromised issuer

An attacker controlling an active laptop can generate a new phone identity,
authorize it, and confirm as that phone. Both prompts can be simulated on
compromised endpoints. Under existing single-active-device authority this can
be policy-valid. The honest user's consent is not cryptographically established.
Recommendation: retain the approved authority model for this scope and clearly
accept that compromise of an authorized device can expand membership. Do not
claim target confirmation prevents this attack. Requiring another independent
trusted approval would change the authority model and needs separate approval.

## 3. Encryption-model comparison and final recommendation

The option letters in this review follow the user's comparison: **A** means
separate ciphertext. The original architecture labels that same choice B.

Let D be the number of destination devices and M the payload size, ignoring
headers, padding and retransmissions.

| Model | Security and key lifecycle | Cost | Revocation | Metadata |
| --- | --- | --- | --- | --- |
| A: separate ciphertext per device through existing pairwise sessions | Independent sessions and authentication; no common payload key to manage. Any authorized endpoint can still leak plaintext. | Approximately D × M payload bytes; full mesh can require D × (D−1)/2 pair relationships. | Stop future encryption/admission to removed device. Previously addressed ciphertext remains exposed. | Fan-out count, similar lengths and timing correlate copies despite randomized encryption. |
| B: one encrypted payload plus individually encrypted content keys | Can be secure with fresh per-object AEAD key, authenticated object/recipient/context binding, nonce discipline and key erasure. Adds an envelope-encryption construction requiring review. | Approximately M plus D key wrappers; downloads still consume per-recipient bandwidth. | Withhold future wrappers; cannot revoke a key already delivered. Rewrapping the same content key does not remove an old recipient's access. | Shared object handle/access pattern directly correlates recipients; private wrapping does not hide common downloads. |
| C: reviewed group epoch encryption, such as MLS | Potential efficient group key management, but adds a group protocol, membership credentials and new key schedule. | Better suited to larger groups; costs depend on protocol/update pattern. | Requires authenticated membership updates and key evolution; no retroactive erasure. | Group membership/traffic still require metadata protection. |
| C alternative: explicit direct device-to-device snapshot transfer | Reuses A without server history retention. | Similar encryption cost; requires source availability and transport. | Still needs current membership and admission; transport locality is not trust. | Reduces stored server objects, but relay/network timing may still be visible. |

**Final recommendation: retain A for initial bounded device synchronization.**
It fits the existing session boundary and avoids introducing a new bulk-key
construction before membership correctness is established. Prefer batching and
incremental sync over changing encryption first. Eight-device cost must be
measured; it is not evidence that A can scale indefinitely.

Model B is a reasonable separately reviewed future optimization for large immutable
payloads. It is not inherently weaker, nor inherently better at revocation. It
would require an approved payload format, wrapper binding, key lifecycle, access
authorization and metadata analysis. Do not repurpose an attachment capability
as a content key or add this optimization to the present implementation gate.

As comparison evidence, Signal's [Sesame specification, §3.3](https://signal.org/docs/specifications/sesame/#sending-messages)
describes per-device encryption in a multi-device system. Its server/device-list
assumptions must not be imported as K3ncrypt authority rules. [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)
specifies MLS as a group protocol; it is not a drop-in synchronization adapter.
These sources support the comparison, not a security endorsement of this design.

## 4. Admission, offline availability and revocation ordering

G1 is the principal blocker. All-device fresh participation can deliberately
trade availability for safety, but the design has not defined a complete protocol.

Counterexample: A and B agree to a batch at epoch N. A starts removing B while
B starts removing A, each using the current single-device mutation authority.
A malicious coordinator presents separate N+1 branches. Who is permitted to
complete each removal, which durable records prevent conflicting admission,
and which old-member acknowledgments must intersect? "Transactional CAS" on a
malicious server does not answer these questions. Requiring all old members to
approve removal also gives the stolen device a veto, contrary to §8.

A second counterexample: an admission covers only epoch, operation name and
recipient set. A sender receives it, waits for revocation, then encrypts newly
created history under that admission. Expiry alone cannot establish which content
was authorized before removal. The batch must bind an immutable manifest digest,
frontier, identities, maximum bytes and one-time admission ID before release.

Required G1 amendment is a concrete state/decision table for admission and
membership reconfiguration. It must specify:

- proposed, prepared, committed, cancelled and uncertain states, their actors
  and durable transitions; no timeout implicitly changes membership;
- exact old/new participant sets, direct authentication of each decision,
  and how conflicting removes/adds freeze rather than choose a server winner;
- the point beyond which ciphertext may be released, and the point removal is
  locally recorded versus globally fenced; the removed target cannot veto removal;
- termination or safe indefinite blocking when a peer is missing, plus a bounded
  outcome for previously admitted batches; no claim of guaranteed progress;
- evidence establishing global fencing without trusting the relay's assertions,
  and limitations when evidence is unavailable or endpoints collude.

Recommendation: preserve strict blocking for now, but make removal immediately
effective for the local author and report global fencing as pending until proven.
Specify completion relative to the remaining authorized participants and the
old admission barriers. If this cannot be made coherent without changing authority,
stop and revise the authority assumption in a separate design decision.

All-active participation makes phone-offline/laptop-online synchronization
unavailable even between the laptop and an online PC. Do not encourage revocation
as the routine cure for battery loss or sleep. Product/security owners must
explicitly accept this first-release restriction. An asynchronous alternative
would need a stated stale-access bound and trust assumptions; it cannot silently
retain the strict revocation promise.

## 5. History ownership, retention and catch-up

Logical history belongs to the user's application state; each device possesses
only the records it legitimately retained. The initial source of history is an
authorized device, not server-readable storage or a universally decryptable backup.
The server is a temporary store of target-specific ciphertext. No future device
can use a pre-enrollment copy addressed to a different device.

Required G4 decisions:

| Situation | Required behavior |
| --- | --- |
| New active device | Explicit selected snapshot from a current authorized source, then deltas after that snapshot's frontier. Imported history retains source provenance. |
| Offline beyond 24-hour queue retention | Reconcile and request fresh export of retained eligible state. If no trusted source retains it, declare a history gap; do not call it recovery or imply completeness. |
| Message author/source device later revoked | Preserve previously committed history. A remaining active source may attest an imported historical record as its own export; it must not manufacture a current authorization by the revoked author. |
| Old-epoch undelivered packet | Reject as live sync authority. If an authorized source retains eligible data, create a new transfer under new consent/admission with explicit historical provenance. |
| Concurrent deletion and snapshot | Validate deletion frontier again at final commit. Exclude expired/deleted data and retain tombstone evidence; do not publish a snapshot captured before a now-known deletion. |
| No common complete snapshot | Record missing ranges/provenance and block claims of complete history. A manifest proves transmitted completeness, not that the source supplied everything ever sent. |

Define user-scope deletion, local hiding and any contact-authorized deletion as
distinct operations. Own-device sync cannot introduce a new remote delete power.
Deletion must not resurrect through snapshots, compaction or device re-enrollment.
Checkpoint compaction needs a rule for newly enrolled devices, departed authors
and causal dependencies older than the retained journal; a digest alone cannot
reconstruct missing deletion information.

Historical re-export increases the number of endpoints holding plaintext. It
also exposes that history if a receiving endpoint is compromised later, even
when the original ratchet has erased old keys. Independent encryption preserves
session separation, not the original history's exposure lifetime. Retain opt-in
history ranges and preserve disappearing-message deadlines instead of resetting
them at import.

Attachments currently remain secret-free placeholders in generic sync. This is
the correct interim boundary. Real attachment access needs independently issued
target authorization plus permitted delivery of existing encrypted references;
no source token/session credential copying. Expired attachments remain unavailable,
not silently re-uploaded. Decide and document placeholder-only initial scope;
complete attachment synchronization requires a separate reviewed adapter contract.

## 6. Conflict rules and record authority

For contact-name edits, use a causal multi-value register: an edit carries contact
ID, field ID, author device, operation ID and the versions it supersedes. A and B
editing the same base offline create concurrent siblings. Preserve both, display
a conflict, and allow an explicit resolution referencing both siblings. A late
sibling not covered by the resolution reopens the conflict. Delivery time and
device clock never decide the winning name. Independent fields may merge.

G5 requires a per-record authority table and operation schema before coding:

| Record | Authority and merge recommendation |
| --- | --- |
| Message append | Original receiving/sending device's assertion; retain provenance and per-author order. Define stable logical IDs so replicas do not become duplicate live messages. |
| Contact label / preference | Current own devices may edit; causal multi-value resolution as above. Conflicts do not affect cryptographic identity. |
| Contact identity / verification | Existing identity and verification ceremony only. Generic sync cannot supersede fingerprints or promote imported verification. |
| Block/unblock | Blocking restricts locally on receipt; unblocking must explicitly cover known block versions and pass current trust review. Unseen concurrent blocks reopen restriction. |
| Read/unread | Reads are scoped to known event IDs; manual unread has an explicit causal clear operation. No unseen message is marked read by an unbounded frontier. |
| Lifecycle | Existing authority boundary; never merged as ordinary content. |
| Global deletion | Explicit eligible scope and tombstone operation; local hiding cannot be upgraded to global deletion by a replica. |

Also define who assigns a logical conversation ID, how contacts map additional
device identities to it, and how an attacker is prevented from splicing messages
from one conversation into another. Public labels and common user scope alone
are insufficient. Until this is defined, history replication must not be described
as complete independent sending from every device.

## 7. Exact revocation guarantees

Distinguish local revocation, fenced revocation and data destruction:

| Data/operation | Guarantee that can be offered |
| --- | --- |
| Future content after proven fencing | Honest remaining senders do not encrypt to the revoked identity or issue valid new admissions; fresh sessions and protected operations reject it. |
| Locally queued work not yet admitted/released | Cancel target delivery and prevent retries; retain only necessary non-secret failure/replay records. |
| Already released or downloaded ciphertext | Assume the target/server retains it and the target may decrypt it later. Queue deletion, expiration and epoch updates cannot revoke those bytes. |
| In-flight admitted batch at removal | Must be classified by the specified admission boundary; do not call removal globally complete while this classification is unknown. No new content may be added to the admitted manifest. |
| Honest offline target | On reconnect reconcile before import; reject stale work and lock according to local policy. No guarantee a modified target obeys. |
| Offline honest sender with stale view | Strict admission blocks new cross-device transfer. Without that mechanism, global revocation is unproven. |
| Previously displayed plaintext / exported files | No remote erase guarantee. |
| Compromised still-active device | Can leak content to a revoked peer outside the protocol; revocation cannot prevent authorized-endpoint collusion. |

Session destruction is a local enforcement action, not key erasure on an attacker
device. A revoked device cannot use synchronization as recovery; if no authorized
source remains available, synchronization stops without a server reset.

## 8. Replay, crash consistency and schema amendments

For G3, specify both send and receive crash tables. Receiving session state may
advance before application commit. Persist authenticated plaintext only inside
the destination vault as bounded staged data, together with a resumable record
binding the envelope identity/digest and import status. The storage design must
explain how a crash before staging is recovered without ratchet rollback, unsafe
key reuse or duplicate display. The existing primitive's durability guarantees
must be inspected before choosing the adapter transaction strategy.

Exactly-once network delivery is not available. Promise idempotent committed
application with retriable acknowledgments. Lost ACKs may cause duplicates, but
only an identical durable record may receive a repeat ACK. Unknown commit outcome
must not be automatically retried as a new operation.

For G6, define sequence scope separately for logical author journal, destination
delivery stream and admission. Filtered history exports must not appear as missing
mandatory journal entries. Publish canonical field order, exact required/optional
fields, operation authorization, expiry comparisons and stable byte vectors.

Clarify whether 64 KiB includes plaintext framing/padding, how a 1 MiB delta is
fragmented under the existing transport limit, and what total batch limits include.
Bound dependency depth and outstanding incomplete transfers before allocation.
Use local monotonic elapsed time for admission deadlines; remote timestamps are
not proof of clock agreement. Suspend/restart invalidates admission. A timeout
does not recall a previously released ciphertext.

Only authenticated relevant peer evidence may trigger persistent trust uncertainty;
raw routing hints cannot install a higher epoch or impose unbounded permanent
state. Define how uncertainty clears through direct reconciliation and how abuse
is bounded, without suppressing a genuine conflict.

## 9. Metadata assessment

Server observations include IP addresses, simultaneous connections, queue handles,
fan-out, upload/download sizes, timing, retention and ACK patterns. Device count,
relationships and daily activity may be inferred even when all payload fields are
encrypted. All-device admission adds correlated bursts and presence information.
Separate ciphertext avoids a single shared blob identifier, but does not prevent
matching equal-sized near-simultaneous transfers.

Recommend fixed documented size buckets within existing limits, bounded batching,
encrypted manifests/ACK frontiers, per-destination opaque handles, short retained
delivery metadata, no plaintext content hashes for cross-user deduplication, and
payload-free metrics with restricted retention. Handle rotation must be authenticated
and must not drop replay/checkpoint state. Do not promise anonymity or hide device
count as an achieved property. Cover traffic or anonymizing infrastructure would
be separate scope with explicit cost and threat analysis.

## 10. Requested attack walkthroughs

| Attack | Impact / design result | Required defense |
| --- | --- | --- |
| Malicious server sends different sync states | Authenticated old snapshots can be valid on isolated devices. Local hashes alone do not prove a common latest state. | G1 reconfiguration/admission evidence, durable high-water and explicit fork quarantine. With unavailable evidence block; do not select server's branch. |
| Replay old synchronization package | May duplicate display or resurrect pre-deletion state if replay/frontiers are lost or re-export is mislabeled. | G3 atomic idempotent apply and G4 deletion/checkpoint rules; bind target, purpose, epoch and stable operation identity. |
| Stolen device requests sync | Locked device security depends on vault; an unlocked still-active device has legitimate protocol access. | Explicit revocation and freshness fencing. Do not claim the protocol detects theft. |
| Fake approved device | Server state or forwarded digest could be mistaken for active membership. | G2 authenticated scope binding and target ceremony; no content in bootstrap-only state. |
| Compromised laptop adds phone | Can succeed under single-device authority when attacker controls target too. | Explicitly accept G7 limitation or separately change authority; target confirmation alone cannot solve it. |
| Conflicting offline contact states | Arrival-order winner can silently replace data/trust. | G5 causal siblings and explicit resolution; restrictive handling for identity/block changes. |
| Revoked device tries to recover data | Can still decrypt old retained copies, but must not obtain newly admitted content. | G1 fencing plus queue/retry guards; no recovery shortcut; state the prior-ciphertext limitation. |

## 11. Original required changes before coding and review verdict

The minimum remaining work is to amend the existing three design documents with
the contracts below, rather than create another general architecture proposal.

| Gate | Exact design amendment | Closure evidence before implementation |
| --- | --- | --- |
| G1 | Admission/reconfiguration state table, immutable batch binding, participant rules, local/fenced removal and offline policy | Reviewed traces for concurrent mutual revocation, missing target, stale coordinator, epoch change during batch and restart; no server-only trust or target veto. Product explicitly accepts all-active availability cost. |
| G2 | Stable scope/device binding and bootstrap-only privileges; direct third-device ratification and absent-author rule | Three-device ceremony transcript with identity source for every step; no transferable hash proof, account split or pending-device content access. |
| G3 | Send/receive persistence transaction and crash-recovery tables | Every crash point has a defined durable state and safe next action without ratchet rollback, duplicate application or false ACK. |
| G4 | History retention/catch-up, old-author provenance and deletion/compaction rules | Offline-beyond-retention, revoked original author, new replica after compaction and concurrent deletion all have deterministic outcomes or explicit gaps. |
| G5 | Typed record authority, causal resolution and conversation/contact mapping | Worked contact-edit/resolve/late-edit example; exact block/unblock and identity rules; independently keyed new device cannot impersonate prior sender. |
| G6 | Canonical schemas, sequence namespaces, framing/resource bounds and deadline semantics | Fixed byte vectors plus accepted/rejected examples, clock/suspend behavior and bounded uncertainty recovery. |
| G7 | Explicit authority-risk acceptance | State that a compromised authorized issuer plus target may enroll; any stronger requirement is routed to separate authority review. |
| G8 | Initial history/media/privacy scope | Explicit selected-history exposure, placeholder-only attachments until authorization exists, and metadata limits; no complete media-sync claim. |

Recommended encryption decision is final for the initial scope: **A, independent
pairwise encrypted copies**. Production adapters, browser evidence, performance
measurement and deployment configuration remain later implementation/release
gates; they cannot substitute for the missing decisions above.

**Final decision: NOT READY.** Non-production research and test-vector drafting
can continue, but security-sensitive sync coding should wait for G1–G6 normative
contracts and G7–G8 scope/risk acceptance. This is stricter than treating every
missing contract as an implementation detail in S1. No crypto, messaging,
attachment, call or lifecycle source change is authorized by this review.

## 12. Review validation

Documentation only: verify this file exists, local links resolve, and staged
changes contain only this report; run `git diff --check`. No implementation,
browser or adversarial execution results are claimed for this milestone.

## 13. Interim design closure disposition (superseded by §14)

The following design-only addenda supersede conflicting v1 details in the earlier
architecture and roadmap. They are specifications, not implemented guarantees:

- [Protocol specification](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md)
- [State machine](PHASE6B8_SYNC_STATE_MACHINE.md)
- [Conflict model](PHASE6B8_SYNC_CONFLICT_MODEL.md)
- [Record permissions](PHASE6B8_SYNC_RECORD_PERMISSION_MODEL.md)

| Finding | Design disposition | Residual work |
| --- | --- | --- |
| G1 | **OPEN.** Fixed-membership admission and immediate local suspension are specified. Global ordering of competing lifecycle changes is not. | Protocol §10 requires an explicit agreement/reconfiguration decision under the existing authority assumptions. Do not implement a guessed server CAS, trusted sequencer or quorum. |
| G2 | Defined restricted bootstrap, stable scope pinning, independent device identity binding, direct author/target ratification and unavailable-author suspension. | Real bootstrap composition and cross-device tests; checkpoint activation across membership change depends on G1. |
| G3 | Defined conservative durable intent/staging/ACK crash table around the inspected runtime's persist-before-return behavior. Uncertain streams close; no ratchet rollback. | Implement actual local atomic application transaction and fault tests; transparent retry across uncertain ratchet progress is deliberately not promised. |
| G4 | Defined snapshot-after-retention, explicit gaps, current-exporter historical provenance, expiry preservation and no v1 tombstone compaction. | Storage/quota and deletion-race tests. |
| G5 | Defined typed object authority, causal multi-value resolution, immutable contact/protocol identity, historical-only conversation mapping and local-only unblock. | Independent contact sending remains outside initial v1 sync; do not claim complete live multi-device messaging. |
| G6 | Defined exact frame/body schemas, canonical rules, namespace bounds, fragmentation, local deadlines and a fixed full-frame digest fixture. | Additional independently reviewed schema fixtures and parser limits tests before merge. |
| G7 | Retained approved single-device authority and explicitly documented issuer-plus-target compromise as a limitation. | A stronger guarantee requires separately approved authority changes; no hidden second approval is inferred. |
| G8 | Specified selected retained history, appearance-only settings, attachment placeholders, no automatic verified-contact import and explicit metadata limits. | Full attachment/direct-contact compatibility is not part of v1 readiness. |

**Overall: NOT READY.** Luna can implement the closed data-model contracts only
in isolation; Luna cannot implement the complete sync system without making the
G1 architectural decision. No code should choose that decision implicitly.

Exact next action: resolve protocol §10 with a membership reconfiguration decision
record. It must explain how concurrent A-revokes-B/B-revokes-A and an unavailable
removed device yield one fenced outcome or a deliberately suspended outcome,
without granting the server trust authority or claiming the removed device erased
its old ciphertext. If only permanent suspension is supported, label that scope
restriction explicitly rather than reporting distributed synchronization complete.

Documentation validation: verify the four new files and local references, confirm
the frame fixture byte count/digest, and run staged diff whitespace/scope checks.
No runtime validation or design proof of G1 is claimed.

## 14. Final conflict authority decision and readiness

Selected architecture: **hybrid authenticated fencing and explicit user selection**,
with unanimous prior-checkpoint evidence required before sync resumes. The
[decision record](PHASE6B8_CONFLICT_AUTHORITY_DECISION_RECORD.md) evaluates all five
options and specifies proposal validation, participant sets, one-choice locks,
direct authenticated phase messages, abort limits, installed barrier, UI states,
fault assumptions and adversarial outcomes.

G1 is **closed as a design decision for this bounded profile**. No server sequencer,
primary device, hash-selected winner or implicit quorum may be substituted.
Luna can implement the stated transitions, including permanent suspension for
unavailable evidence, without choosing an additional authority architecture.

The availability tradeoff is substantive: a removed old device can withhold the
fencing acknowledgment needed for cross-device resumption. It cannot veto local
blocking, but sync may remain paused indefinitely. This supersedes earlier wording
suggesting removed-device cooperation is unnecessary for every stage. No seamless
lost-device reconfiguration, recovery, divergent-history repair or production
availability is claimed. Future requirements for these reopen the design gate.

Implementation acceptance still requires real authenticated peer tests, durable
phase-lock/crash tests, resolution byte vectors and the safety checks in decision
§11. The earlier runtime/storage findings are not marked fixed. Cryptographic
accountability is authenticated peer attribution, not portable digital signatures.

**Final readiness: READY for the specified bounded implementation; not production
ready.** No source files changed. Document links, staged whitespace/scope and
current-versus-historical readiness wording must be checked before commit.
