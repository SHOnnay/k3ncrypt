# Phase 6B.8 conflict authority decision

Status: **READY to implement the bounded, blocking v1 profile defined here.**
This is design readiness, not production validation or guaranteed availability.
Baseline: `88819fc9e6d0d1d8fd716129f4dd6348246fb2c0`.
No source changes. This record supersedes the open G1 question in
[protocol §10](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md), and the corresponding
membership-transition restrictions in the [state machine](PHASE6B8_SYNC_STATE_MACHINE.md).
The [ordinary conflict model](PHASE6B8_SYNC_CONFLICT_MODEL.md) remains unchanged.

## 1. Selected architecture

Choose **option 5: a hybrid of authenticated conflict detection, immediate local
fencing, explicit user selection, and unanimous prior-checkpoint fencing before
cross-device sync resumes**. Deterministic rules validate and represent the result;
they never choose which conflicting trust increase wins.

Any existing authorized device may propose a mutation and present the user
ceremony. No permanent primary device, master key, server trust bit, hash winner,
automatic quorum or timeout-based membership replacement exists.

The deliberate availability decision is:

- Local revocation and content blocking never wait for the target's permission.
- Resuming sync under changed membership requires authenticated fencing evidence
  from **every device active at the prior agreed checkpoint**, including a removed
  device. This is an acknowledgment barrier, not authority to approve/reject local
  revocation. Nevertheless, an unavailable or malicious old device can prevent
  sync resumption indefinitely. This availability veto is explicit and accepted
  for this bounded v1; it must not be described as revocation without any veto.
- Missing evidence means durable suspension, not a weaker set of voters or a new
  identity. Local cached data remains subject to existing vault policy. Recovery
  and removal of the resumption veto are outside this decision.

This resolves G1 by choosing a precisely blocking outcome where progress cannot
be proven safely. It does **not** solve available reconfiguration after losing
an old device. A product requiring that capability must reopen this decision;
implementers cannot improvise an override.

## 2. Options considered

| Option | Security impact | Availability | Privacy | K3ncrypt compatibility / decision |
| --- | --- | --- | --- | --- |
| 1. Server sequencer decides winner | Server can suppress/reorder equally valid mutations; trusting its branch would grant identity-related authority. A database transaction alone is not authenticated agreement. | Good while service is reachable; compromised service can fork or deny. | Central mutation timing, user/device relationships and order visible. | Reject as authority. Server may relay ciphertext and offer non-authoritative ordering hints. |
| 2. Primary device decides winner | Concentrates trust and compromise consequences; selection, replacement and loss require new rules. | Primary loss blocks or requires recovery. | Less coordination traffic, but primary role observable. | Reject: hidden or compulsory master device contradicts the requested model. |
| 3. User selection alone | Human choice is appropriate but cannot authenticate remote acceptance, order concurrent choices or fence prior transfers. | Requires user presence; ambiguous simultaneous ceremonies. | Can remain device-local/encrypted. | Necessary ingredient, insufficient protocol by itself. |
| 4. Deterministic cryptographic ordering | Hash order proves neither authority nor intent; attackers can vary nonces/keys to grind preferred order. Signatures would not make that order a safe trust policy. | Fast for participants with identical complete inputs; hidden inputs produce different views. | Broadcast/evidence correlation still exists. | Reject as winner selection. Canonical digests identify exact proposals only. |
| 5. Hybrid selected here | Existing author proof + human choice + durable prior-member fencing prevent an honest participant from accepting two results for the same checkpoint. | Intentionally blocks on missing/hostile old members, conflicts or uncertain storage. | All-peer traffic exposes timing/presence; bodies remain encrypted. | Selected: preserves decentralized proposal authority and fail-closed behavior without new keys or server authority. |

## 3. Trust and fault assumptions

Accountability means each receiver authenticates a decision directly to the
verified CryptoSession peer and stores that peer/context/digest locally. It is
not a publicly verifiable signature or non-repudiation service. Relayed JSON,
SHA-256 digests and forwarded ACKs cannot count as another member's vote.

The safety argument assumes at least one honest, non-rolled-back participant in
the old set, with durable one-choice state. A compromised authorized device may
exercise existing mutation authority, lie, withhold responses or leak data it
already possesses. If all witnesses are compromised or all their checkpoints
are rolled back, no agreement guarantee is claimed. The server is untrusted for
both authority and completeness; it can always deny service.

This decision adds an application sync-resumption barrier around existing
lifecycle authorization, not a replacement authority for generating keys or
enrolling devices. Target confirmation remains mandatory for enrollment. A
removed device never acquires the right to create a replacement identity.

## 4. Checkpoints, proposals and detection

An agreed checkpoint C is the existing `(scope, epoch, commitment, DeviceList)`.
Let O be its exact sorted active-device set. All participants must pin C through
the existing authenticated reconciliation boundary. `O` is fixed for the entire
attempt; do not calculate it from a local proposed successor or server directory.

A proposal is an existing valid lifecycle authorization plus its exact proposed
next list/commitment, issuer, target, base C, nonce and expiry. Issuer authority
and target confirmation are checked by the existing lifecycle rules. Offline
actions are tentative proposals for distributed sync, not already globally
committed trust. Any local immediate revocation separately installs a deny gate.

Detect and suspend on any of:

- different candidate commitments for the same base/next epoch;
- same authorization nonce/issuer sequence with different canonical bytes;
- mismatched scope, issuer/target identity or incompatible lifecycle transition;
- a participant presenting a later/different checkpoint than the locally pinned C;
- different resolution choices for one attempt, or missing authenticated evidence.

The user example needs a validity check: if X is absent from C, an add of X may
be valid but a lifecycle revoke of an unknown X is not automatically valid.
Treat the latter as a request to reject/withdraw the pending enrollment, not a
fabricated revocation entry. If X is already present, apply the existing lifecycle
state rules; an add of the same stable ID is normally invalid. When proposals
depend on different bases, reconcile the causal chain before calling them
concurrent. Never bypass existing validation just because the UI describes both
operations as valid.

## 5. Ordering and explicit user outcome

Order only by authenticated causal ancestry and the existing monotonic epoch.
No wall-clock, arrival order, nonce size, device name or digest lexicographic
position determines trust. Sort proposal digests solely to define canonical bytes.

The UI shows issuer identity, target fingerprint, action, base checkpoint and
known conflicting proposals. The user chooses **one eligible existing mutation**
to reconsider or rejects all proposed additions/changes. Choosing a mutation
requires fresh existing authorization/confirmation if the old one expired or its
base changed. Other changes require later independent ceremonies; disjoint adds
are not silently combined. Each committed lifecycle transition advances exactly
one epoch and preserves the existing previous-commitment chain.

Reject-all leaves C unchanged and records the rejected proposal IDs in the
resolution ledger. It cannot restore a locally denied/revoked device's access.
If C still includes a locally denied participant, ordinary sync remains suspended;
complete its removal or use an independently authorized existing verification
flow. Dismissing a dialog is never trust restoration.

Once a canonical successor is installed, do not roll back to select a competing
branch. A losing proposal becomes stale and must not automatically rebase. If
instances have already installed divergent lists, v1 remains suspended; this
decision authorizes no merge of immutable lifecycle history or recovery path.

## 6. Concrete resolution ceremony

Each scope has at most one outstanding resolution attempt per base C. An attempt
has a random ID but no winning priority. Any eligible O member may coordinate
delivery. It receives no special authority. Every decision is sent directly to
every other O member over existing verified pairwise sessions.

### Phase F — fence old work

1. On valid proposal/conflict, persist `resolutionPending`, C and the attempt
   ID. Block new batch admissions and new content release immediately. Enforce
   any local revocation even if other devices are offline.
2. Each O member fences its own admissions: terminate pending work, persist the
   complete set of active admission IDs and their terminal/uncertain states, and
   close content gates. Manifest-bound ciphertext already released is classified
   as potentially exposed; it cannot be recalled. Unknown persistence outcome
   prevents this member from producing a FENCED acknowledgment.
3. Each sends FENCED directly to all O members, binding C, attempt and its fence
   ledger digest. FENCED means no further content will be released under C by
   that honest member. It is not a deletion claim or the target's approval of
   removal. No member advances without all O FENCED messages.

The removed participant may answer only this bounded fence ceremony on a
previously authenticated control relationship, matched to O and C. It receives
no content, enrollment authority, new active session or generic operation access.
This explicit adapter exception is only for reporting its own fence record.
If an authenticated control relationship cannot be used safely, remain suspended;
do not bypass normal session authentication to obtain the ACK.

### Phase V — settle one human-selected choice

4. Collect direct issuer evidence for every proposal considered by the user.
   Each O member directly announces its bounded known proposal-digest set. The
   user views the union and chooses one eligible mutation or reject-all.
5. Coordinator sends a resolution object R to every O member. Each validates
   the full known proposal set, existing author authority, target confirmation,
   chosen list bytes/commitment and its own fence. A member with a missing or
   unknown proposal does not ACK; obtain direct issuer evidence or suspend.
6. Each member atomically persists **one** CHOSEN digest for `(C, attempt)` and
   sends CHOSEN directly to all O. An honest member never acknowledges a
   different choice for that attempt. New evidence/conflicting user choice before
   all CHOSEN forces suspension and an explicit abort, not an implicit winner.
7. Once a member has all O matching CHOSEN, it persists the irrevocable commit
   decision R locally. It applies the single selected transition through existing
   lifecycle validation/persistence (or records reject-all without epoch change)
   and sends INSTALLED. Failure or expiry before the local commit decision sends
   no success; partial outcome keeps the scope suspended.

Authorization expiry is checked before committing, not extended by votes. If
some members have committed and others cannot install safely, they do not roll
back; scope stays suspended. Availability recovery from this partial case is not
part of v1. It is a defined terminal blocked outcome, not an unspecified retry.

### Phase I — resume only after installed evidence

8. Every retained O member must receive all O INSTALLED evidence for the identical
   R. A removed device attests installation of its own removal/fence status only.
   Any enrolled new device separately completes the existing target ceremony,
   receives direct issuer/old-member confirmation, and sends its own INSTALLED
   evidence directly to every retained member. No pending target sends content.
9. Retained members plus activated targets directly acknowledge the same new
   checkpoint before any new fixed-membership admission. All old C admissions
   remain invalid. Dedicated content session wrappers are stale and require the
   existing verified session lifecycle to create fresh stream IDs as specified
   by the sync protocol. No ratchet/identity state is copied or rewound.

There is no need to believe a coordinator's claim that everyone agreed: receivers
collect the direct messages themselves. If any phase cannot complete, device
adapter state remains `suspended`, with local revocation still enforced.

## 7. Control contract and durable locks

Use the existing v1 dedicated sync-frame encoding and scalar bounds, with
`admission=null`, `transfer=null`. Header epoch/commitment always identify base C
even for INSTALLED. This is a narrow resolution-parser rule, not permission for
old-epoch content frames. Receiver must already hold that pending attempt.

New type `resolution`, body keys in order:

`attempt:ID, phase:"fenced"|"view"|"choice"|"chosen"|"installed"|"abort-request"|"aborted",
resolution:Nullable(H), proposals:H[], fence:Nullable(H), choice:Nullable(Choice)`.

Proposal arrays are sorted unique H values, maximum 32; overflow suspends rather
than omitting evidence. Fields not applicable to a phase MUST be null or an
empty proposals array. FENCED requires fence H; VIEW requires the sender's known
proposal set; CHOICE requires Choice and its resolution H; CHOSEN and INSTALLED
require the accepted resolution H; abort messages bind that digest if one exists.
All phases bind sender/receiver identity through the common authenticated header.

Choice keys in order:
`scope:Ref, baseEpoch:U, baseCommitment:H, oldMembers:Ref[], attempt:ID,
proposals:H[], selected:Nullable(H), nextEpoch:U, nextCommitment:H`.
Old member array sorts by UTF-8 bytes. Selected null means reject-all and exact
unchanged epoch/commitment. Otherwise nextEpoch must be baseEpoch+1 and the list
must be exactly the existing authorized transition; resolved list/authorization
bytes are obtained through the existing direct lifecycle control boundary, not
invented by this sync object. R digest is SHA-256 of ASCII
`k3ncrypt-sync-resolution-v1:` followed by canonical Choice bytes. It identifies
an agreement, never proves author identity by itself.

Persist base, attempt, local phase, accepted R, direct peer evidence, fence ledger,
and commit status through atomic local compare-and-swap before sending a phase
ACK. Fixed-membership admissions consult this same local resolution lock. At
most 8 members and 32 proposals per attempt fit the existing bounded control
profile. No process-local-only store may be represented as restart-safe evidence.

If two attempts race, each member locks the first it durably accepts. Different
locks cause suspension. They do not make first arrival the final trust winner.
To retry, every O member directly ACKs an explicit ABORTED record for all named
attempts, and no member may have committed R. Retain the closed attempt IDs.
If any member has committed, abort is forbidden. New attempt requires a new ID,
fresh user decision/authorization and full fencing. Missing abort evidence keeps
the lock. Restart never clears a lock or manufactures a vote.

## 8. Security argument and limits

For a fixed base C, accepting a result requires direct CHOSEN from every O member.
Two conflicting results cannot both obtain all acknowledgments if at least one
honest member preserves its one-choice lock. Different attempts cannot bypass
that lock: a new attempt requires unanimous abort of the old one before any
irrevocable commit. After commit, no abort/reuse is allowed. The same reasoning
applies inductively to the next agreed checkpoint only after the installed barrier.

Withholding, replay and partition can stop progress, but cannot create missing
honest acknowledgments. A malicious server cannot synthesize a valid peer response
or make a hash act as a response. Members must not count plaintext certificates
forwarded by another peer. The explicit old-set requirement sacrifices liveness
to avoid guessing an intersection after arbitrary single-device removals.

At local revocation time, only local operations are guaranteed fenced. At the
completed installed barrier, honest old participants have fenced old release and
honest retained participants use the agreed new checkpoint. Neither point erases
released ciphertext. A malicious remaining endpoint can leak future plaintext
outside this protocol. The word "global" must not imply control over a modified
client or data already downloaded.

## 9. Worked outcomes and adversarial cases

| Scenario | Required result |
| --- | --- |
| A proposes add X, B asks to reject pending X | Validate base; unknown-X revoke is not fabricated. Fence, show disagreement, user selects rejection or a fresh authorized enrollment. Target confirmation still required for addition. |
| Same-base eligible proposals disagree | Suspend on discovery; one explicit choice plus all old fencing/choice/install messages, or remain suspended. No hash/time winner. |
| A revokes B while B revokes A | Both local deny gates take effect. If the restricted authenticated ceremony cannot reconcile one eligible choice under existing authority, remain suspended indefinitely. No silent reactivation, elected master or account split. |
| Removed X is offline or refuses fence | Local revocation succeeds; sync-resumption status stays pending/suspended. No timeout excludes X from O. |
| Server gives A/B different successor lists | Missing matching direct evidence prevents installed barrier; preserve fork evidence and suspend. |
| Two users/devices choose different outcomes | One-choice locks prevent dual acceptance; explicit unanimous abort before any commit permits a new ceremony. Otherwise blocked. |
| Old CHOSEN or INSTALLED replayed | Scope/base/attempt/phase/digest and durable closed-attempt ledger reject reuse; no extra epoch or activation. |
| Crash after a CHOSEN send | Durable lock remains; restart is suspended and recovers exact evidence. No second choice. |
| Crash after one device installs | No rollback/abort; no resumed sync until all required installation evidence. Unrepairable partial installation stays suspended in v1. |
| Already divergent committed lifecycle histories | No branch merge or lower-epoch restoration. v1 cannot repair; keep sync unavailable. |
| Compromised authorized issuer adds controlled target | May satisfy existing authority; barrier does not prove an honest human clicked. Retained endpoint-compromise limitation. |
| Old admitted manifest replay after removal | Its old admission cannot renew. Already released immutable bytes may remain exposed; no new content may be appended to it. |

## 10. User experience

Use plain states: "Device changes need review", "Sync is paused", and
"Device blocked here; waiting to finish the change on your other devices."
Show issuer, target fingerprint, requested change, and which devices still need
to confirm the fence. Do not show hashes as trust rankings or expose private data.

Offer review, choose an eligible action, reject pending addition, or keep paused.
No force-sync, skip-device, accept-server-version, automatic trust reset, or
timeout recovery action exists. Explain before confirmation that losing an old
device can leave sync paused in this release even though local blocking works.
Cached local history remains readable under existing vault policy; this is not
permission to perform new protected operations under stale trust.

## 11. Readiness and required implementation evidence

**READY for implementation of this bounded blocking profile.** G1's result is
now concrete: unanimous prior-checkpoint fencing plus explicit authenticated user
selection, with indefinite suspension for unavailable evidence, conflicting
committed history or uncertain installation. There is no architectural choice
left to an implementer about a master, quorum, server winner or automatic retry.

Implementation must produce real session/vault tests for every §9 outcome and
every durable phase boundary; state-machine/model tests must demonstrate that
two conflicting resolutions cannot both complete with an honest persistent old
member. Test framework mocks must not supply unconditional trust or fabricated
peer votes. The exact resolution encoding also needs fixed independent vectors.

This is **not production readiness** and does not promise seamless offline
reconfiguration or complete live multi-device messaging. Existing persistence,
bootstrap, attachment and direct-contact integration gates remain implementation
work. Available removal of lost devices, repair of split committed histories,
recovery and improved quorum protocols require future explicit design decisions.
