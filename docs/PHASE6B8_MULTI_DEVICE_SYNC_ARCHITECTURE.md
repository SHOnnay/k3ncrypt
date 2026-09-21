# Phase 6B.8 multi-device synchronization architecture

Status: design only. Baseline reviewed: `09f121b61f189701a15a88c3140364580b9bf48a`.
MUST/MUST NOT describe future acceptance requirements, not implemented guarantees.
This document specifies synchronization adapters; it does not change any existing
cryptographic primitive, lifecycle format, message protocol, or production default.

References:

- [Phase 6 master specification](PHASE6_COMPLETE_ARCHITECTURE_SPECIFICATION.md)
- [Final adversarial audit](PHASE6B_FINAL_ADVERSARIAL_SECURITY_AUDIT.md)
- [Distributed trust enforcement report](PHASE6B_DISTRIBUTED_TRUST_ENFORCEMENT_REPORT.md)
- [Enrollment integration boundary](PHASE6B2_RUNTIME_INTEGRATION_BOUNDARY.md)
- [Threat model](PHASE6B8_SYNC_THREAT_MODEL.md)
- [Implementation roadmap](PHASE6B8_IMPLEMENTATION_ROADMAP.md)

## 1. Decisions and implementation reality

One user has a locally pinned user scope and a lifecycle-authorized set of
independent device identities. Phone, laptop, and PC are replicas belonging to
that scope, not new accounts. A scope string is a namespace, not proof of
ownership. The public fingerprint of each device remains distinct. The existing
authority ceremony binds those identities to the scope; no shared private user
identity or new root signing key is introduced.

Choose **B: separately encrypted copies per destination device**. Reuse the
existing authenticated modern session primitives for each device pair. Never
clone identity keys, session pickles, ratchet state, vault keys, or a universal
sync key. This costs storage/bandwidth proportional to the recipient count but
allows independent sessions and removal of a destination from future delivery.

The current repository is not a functioning distributed synchronization system:

| Observed boundary | Consequence for this design |
| --- | --- |
| `DeviceTrustEnforcer.snapshot()` validates a local list and commitment | A valid local snapshot is not evidence that no remote revocation exists. |
| `TrustStateEventCoordinator.accept()` requires an event to match already installed local state | It cannot install a newer list or reconcile a device by itself. |
| `ModernConversation.handleDeviceControl()` catches and drops rejected trust events | Contrary to the stronger wording in the distributed report, rejection does not persist a quarantine flag. A stale local device can still pass a later local check. |
| `assertCurrentDeviceTrust()` checks the locally read epoch and advances its observed epoch | It is not an immutable session-epoch binding or a distributed freshness check. |
| `retryPending()` sends stored envelopes without a new trust check; cached call composition can return before the new check; signaling has its own receive path | Every send/retry/decrypt/operation path needs enforcement evidence before synchronization is enabled. |
| Lifecycle persistence uses process-local locks and separate state/high-water writes | Cross-process atomicity and rollback resistance after restoring all local records are unproven. |
| Runtime seeds local scope from its own identity and uses a conversation routing address as device ID | A common user scope and stable cross-conversation device mapping require explicit adapter work; copying that initialization onto every device would create separate scopes. |
| Device-control send encodes the prefixed string through JSON serialization, while decode tests the raw prefix | Framing round-trip evidence is required before using this channel; an interface declaration is insufficient. |

These are integration prerequisites, not issues fixed by these documents. Earlier
completion reports must not be interpreted as proof of distributed revocation.

## 2. Proposed architecture and boundaries

```text
User scope (pinned locally; membership authorized by existing lifecycle)
   |                     |                     |
Phone identity       Laptop identity       PC identity
own vault/sessions   own vault/sessions     own vault/sessions
   |                     |                     |
   +------ lifecycle reconciliation / trust admission ------+
                         |
       typed snapshot + per-device operation journals
                         |
      dedicated same-user CryptoSession pair per peer
                         |
           opaque recipient-specific sync delivery
                         |
        decrypt -> verify -> atomic local apply -> ACK
```

Future adapters have distinct responsibilities:

| Adapter | Responsibility | Must not do |
| --- | --- | --- |
| Same-user binding | Map verified session peer to stable device ID and pinned user scope | Trust payload sender, routing ID, display name, or server account assertion |
| Lifecycle reconciliation | Validate existing authority and target ceremony; install a coherent list/checkpoint | Treat hashes or relayed approvals as transferable signatures |
| Trust admission | Check current membership, epoch/commitment, reconciliation status, and operation scope | Rely solely on a cached `active` flag |
| Sync exporter | Export allow-listed application records after user authorization | Export raw vault or crypto state |
| Sync transport | Store/relay separately encrypted envelopes with quotas/expiry | Interpret contacts/messages or approve membership |
| Sync importer | Stage, verify provenance/dependencies, and atomically apply records | Write lifecycle or contact verification through generic record import |
| Sync journal | Persist exact outbound envelopes, inbound replay state, cursors, and commit status | ACK a record before durable application |

All are proposed components. No server route, durable transaction adapter, or
public CryptoSession identity-directory API is assumed to exist.

## 3. Device bootstrap and key exchange

1. B generates its own identity and local vault using existing primitives. A and
   B use the existing public bundle/pre-key session bootstrap and canonical
   fingerprint comparison. QR/manual comparison is public presentation, not a
   secret or automatic approval. Both explicitly confirm the peer binding.
2. Bind the pairwise session to enrollment purpose, A/B device public identities,
   user scope, one-time request nonce, expiry, and current list commitment.
   Sender identity comes from composed session context, never the request body.
3. Run the existing lifecycle ceremony: `pending_enrollment` ->
   `approved_pending_confirmation` -> `active`. B's authenticated confirmation
   and the committed list/epoch must be durable before any content export.
   Before activation only bounded public pairing/lifecycle data is permitted.
4. B pins the common user scope and validated membership checkpoint. A's existing
   scope is retained even though B has different keys. B must not initialize an
   unrelated singleton scope and label it synchronized. Each already active
   device reconciles and establishes its own verified pairwise session with B.
5. A shows a transfer selection: conversations, contact records, history range,
   and eligible preferences. Default history selection is none; history export
   requires explicit approval. Disappearing/deleted/expired content is excluded.
   Record the selection and target binding in the encrypted transfer manifest.
6. After trust admission, A exports a consistent snapshot at a journal frontier,
   encrypts bounded chunks separately for B, and sends an authenticated manifest.
   B stages the snapshot in its own encrypted vault, verifies all chunks, scope,
   recipient, epoch, manifest digest, and provenance, then commits atomically.
7. B returns an encrypted ACK binding transfer ID, manifest digest, epoch, and
   committed frontier. Deltas after the snapshot frontier then replay exactly
   once. Interrupted snapshots remain invisible and may resume only after fresh
   admission. An epoch change abandons the old transfer and requires re-export.

B receives application records, public identities, a verified lifecycle
checkpoint, and its own independent session outputs. It never receives another
device's private identity/session state, vault unlock material, recovery secrets,
or server credentials. There is no full-device-loss bootstrap in this milestone.

Pairwise authenticated plaintext is not a portable proof of who authored it.
When C learns that A approved B via another device, C MUST reconcile directly
over a verified relationship with an author authorized at the relevant checkpoint
or require the existing explicit re-verification ceremony. A forwarded JSON
authorization and its SHA-256 digest cannot authorize C's trust update. If the
required authenticated evidence cannot be obtained, synchronization blocks.

## 4. Synchronized records and exclusions

| Data | Transfer semantics | Security treatment |
| --- | --- | --- |
| Conversation index | Stable opaque logical conversation ID, label, immutable protocol mode, participant public references | Same logical conversation across devices; transport sessions are device-specific. Unknown mappings remain unavailable. |
| Existing message history | Explicit selected history re-encrypted by an authorized source; include source device and original identity attribution | Mark as imported history. It proves which own device supplied it, not an independently verifiable signature by the original contact. Never replay history as a new outbound message. |
| New sent/received messages | Logical event ID with source-device sequence and per-destination envelope | Deduplicate own-device replicas; retain originating device provenance. Do not make own devices appear as new contacts/accounts. |
| Read/unread state | Per-device observed event sets/frontiers and explicit manual unread markers | Union observed reads; unread marker persists until explicitly cleared for its causal branch. No wall-clock ordering. |
| Contacts | Contact ID, public identity, display fields, verification evidence provenance | Identity conflicts block use; imported verification is an assertion by the exporting own device. |
| Verification | Exact contact fingerprint, verifying device, method and evidence reference | Display synchronized evidence but keep new device's local verification unconfirmed until the existing explicit ceremony. Never copy a `verified` boolean into trust. Changed identity always blocks. |
| Lifecycle | List, commitment, epoch and authenticated reconciliation evidence | Process only through lifecycle adapters. Generic sync cannot enroll, revoke, activate, or reset high-water state. |
| Preferences | Explicit allow-list such as appearance and non-security display settings | Concurrent values require resolution; OS permissions, vault unlock settings, and key material remain local. |
| Attachments/media | Eligible encrypted message references only after independent target authorization | Do not copy another device's access capability or session token. If current attachment model cannot authorize B safely, show unavailable; transferring references does not grant access. |
| Calls | At most separately approved non-sensitive history records in future | No active call/session/SDP/ICE/media-key synchronization or call takeover. |

Synchronization adds an application record format outside frozen message
envelopes. It does not change remote-contact wire messages, migrate legacy
conversations, or copy mailbox cursors/tokens as credentials. Legacy entries may
remain visible as unavailable on B; they receive no modern-device trust upgrade.

### New messages and contact compatibility

An existing authorized device can replicate messages it legitimately sends or
receives to its own devices. B can read such replicas without impersonating A.
For B to send directly to a contact, the contact must explicitly recognize B's
device identity through a reviewed contact-to-user binding adapter and establish
an independent modern session. The logical conversation mapping is app state,
not permission to reuse A's session or pretend B has A's fingerprint.

Existing single-device contacts do not automatically accept all user devices.
Until this compatibility boundary is implemented and reviewed, B shows direct
send unavailable for those contacts. There is no hidden forwarding of B's
outbound text through A while presenting B as cryptographic author. Complete
independent multi-device sending is therefore an integration gate, not a
capability provided by history synchronization alone.

## 5. Encryption and package binding

Server storage holds only recipient-specific CryptoSession envelopes plus the
minimum routing, byte-count, expiry, and delivery metadata. Device transfer uses
the same existing primitives in a dedicated same-user pairwise session and an
adapter-owned, versioned sync discriminator. The dedicated session avoids call
or chat parsers consuming sync records. No new primitive/channel enum is required;
an existing encrypted channel can carry the adapter frame after round-trip and
cross-purpose rejection tests. Existing chat/call sessions are not repurposed.

Each decrypted frame MUST bind these fields to session authentication:

- version and purpose (`sync-manifest`, `sync-chunk`, `sync-delta`, `sync-ack`, or
  `sync-reconcile`); pinned user scope;
- source/target stable device IDs and both public identity references;
- admission ID, exact epoch and list commitment;
- transfer ID, per-source sequence, previous operation digest, causal dependencies;
- creation/expiry, content class, snapshot frontier or operation ID;
- manifest digest, chunk index/count, total bytes and payload digest as applicable.

Source and target are checked against session context before import, including
the local receiving identity. Digests bind structure and completeness; origin
authenticity comes exclusively from the authenticated session. Deterministic
UTF-8 encoding follows the canonical specification, with a separate allow-listed
sync schema; duplicate/unknown fields, unsafe integers, unknown versions and
ambiguous Unicode fail. Exact schema byte vectors are a pre-merge requirement.

Initial resource policy: maximum 8 active sync devices, 64 KiB decoded chunk,
32 MiB snapshot batch, 512 chunks per batch, 256 operations per delta, 1 MiB
delta bytes, and 24-hour ciphertext retention. Larger history uses independently
verified batches. These bounds are future sync policy, not lifecycle-format
limits; exceeding them pauses sync rather than ignoring enrolled devices. Parser
limits apply before allocation, and aggregate per-scope quotas are mandatory.

Decrypt in memory, validate, and persist through the destination's own vault.
Private identity, session and vault keys remain within their existing APIs.
Secret-bearing attachment references are excluded from generic snapshot export;
their later transfer requires the separately validated recipient authorization
boundary described above. Until then, synchronize only an unavailable-media
placeholder without secrets. No plaintext staging files,
debug logs, external processing, public URLs, or server search/indexing.

## 6. Freshness, offline behavior, and the partition limit

A valid commitment proves internal consistency, not global recency. A malicious
relay can suppress a revocation and present an isolated device with an old but
valid view. No local epoch comparison or bounded expiry can prove that an unseen
revocation does not exist. Already delivered ciphertext cannot be recalled.

For the first release choose strict synchronization admission with an explicit
availability cost:

1. Resume begins in `reconciling`. No content transfer starts merely because the
   last local list says active. Restore durable high-water/frontiers and reconcile
   all lifecycle evidence first. Unknown newer events persist `trust-uncertain`;
   dropping the event must not clear that state.
2. Before each bounded content batch, every active device in the reconciled list
   authenticates a fresh challenge for the same scope, operation, recipient set,
   epoch, and commitment. Each participant responds directly through its own
   pairwise session; forwarded ACKs/hashes are insufficient. Missing responses
   block the batch. Initial admission expiry is at most 60 seconds; uncertain
   time or process restart invalidates outstanding admission.
3. Admission and lifecycle mutation require a common durable serialization
   boundary. A trust mutation cannot be acknowledged as complete while an older
   admitted batch is unaccounted for. An overlapping batch either linearizes
   before revocation or is cancelled/quarantined; it is never relabeled as a new
   epoch. Persist begin/complete/abort records and drain or expire old admissions.
4. A stale component cannot renew admission using a server assertion. Reconcile
   peer commitments on every renewal. If a malicious coordinator equivocates,
   an honest participant's persistent conflicting claim blocks admission; if all
   relevant endpoints and their storage are compromised, this defense is lost.

This distributed admission/serialization adapter is a design requirement, not
present code or a claim that process-local CAS is distributed consensus. Its
crash/partition behavior must pass the roadmap gates before rollout.

If phone is offline, laptop may read its own cached history and queue tentative
local changes. Cross-device synchronization waits. Direct existing chat behavior
is not silently changed by this design; extending these strict guarantees to
all message/call/attachment operations requires separately validated integration.
The user may explicitly revoke an unavailable device using the existing ceremony;
the remaining membership can then reconcile. Offline devices are never
automatically removed. Immediate revocation and always-available offline
synchronization cannot both be promised.

On reconnect: fetch control hints, authenticate and reconcile lifecycle, compare
high-water state, obtain new admission, resume bounded batches from durable ACKs,
then publish eligible local deltas. Old-epoch ciphertext is not imported. A
still-active author may explicitly revalidate an unsent local change and create
a new current-epoch operation with provenance; rejected security actions must
undergo their original ceremony again. An offline revoked author cannot do this.

## 7. Conflict resolution and durable state

Each device journals operations with a monotonically increasing local sequence,
previous digest and explicit causal dependencies. Sequence reuse with different
content is a fork. Timestamps are for expiry/display only. Gaps trigger bounded
retrieval or quarantine, not guessed ordering. Incomparable branches remain
visible until resolved by the authorized rule below.

| Concurrent changes | Rule |
| --- | --- |
| Independent message appends | Union by authenticated logical event ID; retain per-source order. Same ID with different bytes is a conflict. |
| Duplicate delivery | Return prior ACK only for identical digest; no second application. |
| Read markers | Merge only authenticated observed event IDs; do not invent reads for unknown messages. |
| Contact rename/ordinary settings | Preserve both versions and require explicit selection; security defaults remain restrictive while unresolved. |
| Contact fingerprint/verification or block/unblock | Block wins pending explicit review; no automatic trust increase. Conflicting identity observations require existing re-verification. |
| Lifecycle epoch/list | Existing authority model only. Lower epoch rejects, same-epoch different commitment quarantines; no automatic merge. |
| Deletion versus stale imported content | Authorized deletion tombstone prevents resurrection; conflicting scope/authority requires review. Local hiding does not become global deletion. |

Record application, inbound replay claim, causal frontier, tombstone, and ACK
status commit atomically. Outbound session advancement and the exact encrypted
envelope need a crash-safe durable outbox boundary. If existing APIs cannot
guarantee this without changing primitives, the adapter must fail closed on
uncertainty; it cannot regenerate ciphertext under uncertain ratchet state.
Cross-instance writes use a real transactional compare-and-swap boundary with
uniqueness constraints, not a process mutex.

Compaction retains replay/high-water and deletion boundaries. Garbage collect a
tombstone only after every still-authorized device acknowledges its frontier;
otherwise retain a compact commitment or require a fresh complete snapshot.
Loss of all independent checkpoints is a rollback risk, not silently repaired
by accepting the server's oldest snapshot. Recovery remains out of scope.

## 8. Revocation

Revocation changes the lifecycle first. Stop issuing content admissions to the
target, cancel staged/pending transfers involving it, invalidate epoch-bound
operation handles, stop retries, and close affected session wrappers through
existing public APIs. New sessions must verify membership before activation.
All still-active devices acknowledge the new checkpoint before sync resumes.
The revoked target's ACK is not required; its authenticated notification is
best-effort and is not the enforcement mechanism.

Queued server ciphertext for that target is deleted/expired where possible.
Assume a malicious server retains it. A revoked device may retain its plaintext,
keys and already addressed ciphertext; remote erasure is not guaranteed. An
honest local client locks access and performs best-effort cleanup under the
existing storage policy, but this is not protection against a stolen unlocked
or modified client. Future content must not be encrypted to the removed device.

Old-epoch pending packages are discarded, never rewrapped automatically. A
retained device can create a fresh eligible transfer only after current trust
admission. Revoked devices have no readmission shortcut or recovery authority.

## 9. Metadata privacy

The delivery service necessarily sees destination routing handles, connections,
IP addresses, ciphertext sizes, timing, expiry and ACK traffic. It may infer
device count and shared-user/contact relationships from enrollment/routing and
fan-out, even with opaque IDs. It never receives contact names, conversation
labels, content, verification details, or plaintext sync manifests.

Use per-destination opaque queue handles, bounded retention, payload-free logs,
coarse byte metrics, and encrypted ACK/frontier data. Pad chunks into bounded
size buckets and batch small changes when latency permits; no anonymity claim
follows from padding. Reusing global content hashes or exposing plaintext
deduplication identifiers across users is forbidden. No analytics, external sync
provider, server-side thumbnails, or extra device permissions are introduced.

## 10. Design readiness

The architecture selects independent device sessions, recipient-specific copies,
explicit history transfer, provenance-aware contact import, causal conflict
rules, and strict admission when freshness is uncertain.

Implementation may proceed in isolated adapter milestones after the roadmap's
entry gates. **Production synchronization is NOT READY**: current distributed
freshness, shared atomic persistence, target bootstrap, stable scope mapping,
portable-authority limitations, and direct-contact compatibility must be proven.
No document-only milestone can close those runtime gaps.
