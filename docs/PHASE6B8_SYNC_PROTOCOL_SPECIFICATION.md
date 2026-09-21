# Phase 6B.8 sync protocol specification

Status: normative design for the bounded v1 profile; **READY for implementation**
with the explicitly blocking conflict authority decision in §10. No implementation
or production-readiness claim. Unavailable old devices can prevent sync resumption.
Reviewed baseline: `520bc32df45859ee9350d0236a9ac6101523b659`.

Companion contracts:
[state machine](PHASE6B8_SYNC_STATE_MACHINE.md),
[conflicts](PHASE6B8_SYNC_CONFLICT_MODEL.md),
[permissions](PHASE6B8_SYNC_RECORD_PERMISSION_MODEL.md).
These documents refine the earlier architecture for v1. They do not introduce
new keys, change lifecycle authority, or authorize changing frozen primitives.
The [review gate](PHASE6B8_SYNC_ARCHITECTURE_REVIEW_GATE.md) records overall status.

## 1. Scope and selected policy

V1 transfers selected retained text history, conversation/contact records,
appearance preferences, read markers, deletion evidence and secret-free attachment
placeholders between independently keyed devices in one pinned user scope.
It does not grant direct external-contact sending, attachment download, call
handoff, recovery, legacy migration or mobile implementation. Such operations
remain unavailable until their own existing authorization succeeds.

Use independent pairwise CryptoSessions and separate destination ciphertext.
No common sync key, vault clone, session pickle transfer or server plaintext.
All active devices must participate in fixed-membership batch admission. A
missing device blocks sync; ordinary offline use must not automatically revoke it.
A compromised authorized issuer plus malicious target may enroll under the
existing authority policy. This is an explicit retained limitation, not a
claimed defense supplied by target confirmation.

## 2. Identifiers, encoding and bounds

Types used below:

| Type | Exact rule |
| --- | --- |
| `U` | JSON integer 0 through 9007199254740991, no exponent, fraction or negative zero. Increment at maximum fails closed. |
| `ID` | 32 lower-case hexadecimal characters representing 16 CSPRNG bytes. Not a bearer secret or proof. |
| `H` | 64 lower-case hexadecimal characters, SHA-256 digest. |
| `Ref` | NFC string, 1–256 UTF-8 bytes; no control characters, surrogate code points or implicit normalization. Existing identity representation retained. |
| `Text(n)` | NFC string up to n UTF-8 bytes; reject unpaired surrogates. Display strings cannot become filenames, HTML or authority. |
| `Bytes` | Unpadded canonical base64url; decoding and re-encoding must reproduce the input. |
| `Nullable(T)` | Explicit JSON null or T; never omitted. |

All schemas list every key in canonical order. Reject missing, unknown and
duplicate keys at parsing; input objects with reordered keys may normalize to
the listed order before hashing, but the accepted wire bytes MUST equal that
canonical serialization. UTF-8 without BOM; compact JSON; no trailing bytes.
Strings use literal Unicode except quote/backslash and control escapes; use
`\b`, `\t`, `\n`, `\f`, `\r`, and lower-case `\u00xx` for other controls.
ASCII ID/H arrays sort lexicographically, remove no duplicates silently. Ref
arrays sort by UTF-8 bytes. Record arrays preserve schema-defined order.
DeviceList bytes remain under the existing lifecycle codec, never this codec.

The plaintext frame is ASCII `k3ncrypt-sync-v1:` followed immediately by canonical
JSON, not JSON serialization of the combined string. Maximum frame size 65536
bytes including prefix. Maximum decoded chunk 32768 bytes; base64 expansion and
header must also fit. Raw transport envelope limit 196608 bytes; oversize rejects.
No compression in v1. Deterministic padding is not part of v1 framing; the earlier
padding recommendation remains future work. Do not claim size hiding.

Maximum 8 active devices, 1 active outbound batch per scope per source, 2 staged
batches per receiver, 16 MiB decoded batch, 512 chunks, 256 operations per batch,
65536 decoded bytes per operation, 256 dependencies per operation, dependency
depth 256. A delta uses this same fragmented batch format, not a separate 1 MiB
frame. Stage at most 32 MiB decoded data per receiver scope. Exceeding a bound
rejects the batch; never silently exclude a device from admission.

Queue retention is at most 24 hours from server receipt, for availability only.
Freshness never depends on server time. Monotonic local admission deadlines are
60000 ms from each member's own PREPARE acceptance; suspend, monotonic-clock
uncertainty, process restart or connection rebootstrap invalidates admission.
Wall timestamps are display/audit information only. No live admission can be
extended by retransmitting its ID.

## 3. Common frame and bodies

Common frame, in this exact order:

`version:1, purpose:"device-sync", type:Enum, scope:Ref, sender:Ref,
senderIdentity:Ref, receiver:Ref, receiverIdentity:Ref, epoch:U,
commitment:H, stream:ID, sequence:U, message:ID, admission:Nullable(ID),
transfer:Nullable(ID), body:Object`.

`sender`/`receiver` are stable device IDs from validated lifecycle entries,
not routing handles. Before dispatch require decrypted session peer/local identity,
pinned scope, device references and expected stream to match these fields.
All types below use the same fully authenticated frame. A router cannot supply
an identity proof. Unknown types reject without protocol downgrade.

| Type | Body keys in order | Admission / transfer |
| --- | --- | --- |
| `reconcile.request` | `challenge:ID` | null / null |
| `reconcile.reply` | `challenge:ID, checkpoint:H, status:"matching"\|"uncertain"\|"revoked"` | null / null |
| `manifest` | `manifest:Manifest` | null / ID |
| `prepare` | `manifestDigest:H, checkpoint:H, challenge:ID` | ID / ID |
| `prepared` | `manifestDigest:H, challenge:ID, decision:"allow"\|"deny"` | ID / ID |
| `ready` | `manifestDigest:H` | ID / ID |
| `chunk` | `manifestDigest:H, index:U, data:Bytes` | ID / ID |
| `receipt` | `manifestDigest:H, chunks:U[]` (ascending unique indices) | ID / ID |
| `complete` | `manifestDigest:H, frontier:H, application:H` | ID / ID |
| `abort` | `manifestDigest:H, reason:"unavailable"\|"expired"\|"conflict"\|"invalid"` | ID / ID |

`reconcile.reply` only acknowledges a matching already authenticated checkpoint;
it cannot install a new lifecycle list. Different epoch/commitment persists
uncertainty and invokes lifecycle reconciliation. A server hint never has this
effect by itself. No private diagnostic errors go on wire.

Manifest fields, in order:

`version:1, transfer:ID, scope:Ref, source:Ref, sourceIdentity:Ref,
target:Ref, targetIdentity:Ref, epoch:U, commitment:H,
members:Ref[], consent:ID, mode:"snapshot"|"delta", frontier:Frontier[],
deletionFrontier:H, recordCount:U, byteLength:U, chunkDigests:H[],
payloadDigest:H`.

`Frontier = {author:Ref, sequence:U, digest:H}`, ordered by author UTF-8 bytes.
It describes the source's retained application snapshot, not an assertion that
all history exists. Payload is canonical JSON array of records defined in the
permission document, sorted by record ID then version ID. Empty transfers reject.
Chunk by contiguous 32768-byte slices; last slice may be shorter. No empty chunks.
`chunkDigests` preserve index order; count equals ceiling(byteLength/32768).
Digest the complete canonical Manifest as `SHA-256(UTF8("k3ncrypt-sync-manifest-v1:")
|| canonicalManifestBytes)`. Hash payload/chunks directly as bytes. Consent is a
local durable selection binding target, scope, record classes and frontier; a
received ID alone never creates consent. Target separately consents to import.

`checkpoint` is the existing authenticated lifecycle commitment at the stated
epoch. `frontier` in COMPLETE is the digest of the canonical manifest frontier;
`application` is SHA-256 of the canonical array of committed record-version IDs
in sorted order. Completion is not proof against a malicious recipient lying.

## 4. Sequence, duplicate and replay rules

There are three separate namespaces; none is substituted for another:

1. Logical operation ID is `(authorDevice, authorSequence)`, starting at 1,
   persisted before export. Operations bind prior author digest and causal parents.
   Failed transfers do not renumber operations. Filtered snapshots may omit other
   author operations: they do not claim a contiguous author's complete history.
2. Delivery stream is `(scope, sender, receiver, streamID)` pinned to one dedicated
   authenticated session. Sequence starts at 1; reserve durably before encrypting.
   Permit out-of-order delivery in a 1024-sequence window. Outside window block
   this transfer and reconcile; do not unboundedly allocate gaps. Never reuse a
   sequence after uncertain encryption. New session uses a new stream.
3. Admission IDs and transfer IDs are never reused. Admission has one immutable
   manifest digest and checkpoint. Any content/range/epoch change requires a new
   manifest and fresh consent/admission validation.

Identical persisted envelope digest may return the previously committed receipt
without a second decrypt. This is a bounded response on the already authenticated
stream and never grants trust. Same stream/sequence or message ID with different
bytes is conflict: suspend that stream. After decryption, same logical version
and same canonical record digest is idempotent; conflicting digest quarantines
the affected record and blocks its application.

Persist replay ledger, tombstones and checkpoints independent of queue TTL.
Restart does not clear them. No garbage collection of replay or tombstones in v1;
limit retained replay/tombstone entries to 100000 and their combined canonical
bytes to 64 MiB per scope. At either limit pause sync and report unavailable.
A later
compaction protocol requires its own specification, not an ad hoc eviction.

## 5. Bootstrap authority

User scope is the existing explicitly verified origin scope; it remains constant
when devices change. If that scope has not been established outside a routing
address, bootstrap refuses. Sync never generates replacement account ownership.
Bind stable lifecycle device IDs to their independent public identity references.

Bootstrap uses existing public bundles and explicit mutual fingerprint comparison
in a dedicated restricted session. Only existing enrollment/confirmation controls
are allowed before activation; no `manifest`, `prepare` or `chunk` is accepted.
The approved-state adapter is reached only after existing target confirmation
and committed lifecycle activation. It is not a generic active-device bypass.

A directly verifies B's public identity, A authorizes B, and B confirms the exact
scope/author/target/epoch/commitment/ceremony. Other active C devices must receive
the author assertion directly over their verified relationship with A and verify
B directly before acknowledging the new checkpoint. C cannot accept B merely
because B forwards A's digest. If A is unavailable before ratification, suspend;
an existing explicit re-verification ceremony is required, not server recovery.
All participants retain local ceremony replay/commit records. Nonce reuse with
different target/scope rejects even if both objects have valid digests.

Enrollment does not authorize history export. Default selection is none. Export
only explicit selected classes/ranges, retaining original expiry and provenance.
A re-export from C authenticates C as historical source, never impersonates A or
the original remote sender. Import cannot mark contact verification as locally
confirmed or create direct-contact sending credentials.

## 6. Fixed-membership admission protocol

This section applies to a checkpoint already agreed by every active participant.
Unknown/new checkpoints enter it only after the installed barrier in §10's
conflict-authority decision. Fixed-membership readiness alone cannot reconfigure
membership. No implementation may omit the old-member fencing barrier.

1. Source builds and durably freezes the manifest/payload under explicit consent.
   All active members must be directly authenticated and report the identical
   checkpoint in a fresh reconciliation exchange. Incomplete exchange suspends.
2. Source sends PREPARE, and the same manifest, separately to every member; the
   source creates its equivalent local record. Target is an active member, never
   an enrollment-pending device. Each member rechecks identities, checkpoint,
   manifest scope/limits and consent where applicable. Reserve one active batch
   per scope locally before emitting PREPARED. A competing batch is denied;
   no deterministic winner changes existing reservations.
3. Each member sends its own PREPARED decision directly to every other member
   over its pairwise session. Match the source challenge and exact manifest.
   Missing/deny/conflicting responses abort or suspend, never counted as approval.
4. Once a member has all matching PREPARED responses it durably records READY
   and sends READY directly to all. Source may encrypt/release content only after
   its own READY and every member's matching READY. Target may import only after
   independently collecting that same evidence. Forwarded evidence cannot count.
5. Source checks admission before every chunk encryption and release; target
   checks before import and final commit. A lifecycle uncertainty, changed local
   checkpoint, deadline, suspend or restart invalidates admission immediately.
   Prepared/ready reservations remain until terminal state is durably known;
   do not release a safety lock merely because a remote wall clock expired.
6. Receipts acknowledge durable staging only. Target validates complete payload,
   permission/causal/deletion rules and commits all record changes plus replay
   and COMPLETE record atomically. It sends COMPLETE after this transaction.
   Source records completion only on directly authenticated matching COMPLETE.
7. Other members release reservations after directly authenticated terminal
   evidence from source and target. Missing evidence keeps the scope suspended;
   this conservative v1 has no automatic lock recovery or coordinator election.

The source is a messenger, not a membership authority. Peer readiness proves only
participation in this exact batch; it is not transferable approval of another
batch. All-to-all acknowledgments deliberately cost bandwidth and availability.

## 7. Encryption and receive procedure

Use the existing runtime's persistence-aware encrypt/decrypt methods through a
dedicated sync-session adapter. Do not call a raw session path that skips existing
ratchet persistence. Same-user frames use the existing encrypted signaling
channel on dedicated sessions; existing call/chat sessions are not shared.

Send: validate permissions -> freeze manifest -> admit -> reserve envelope record
-> runtime encrypt -> durable exact ciphertext outbox -> recheck admission ->
transport. Only ciphertext crosses transport/server boundaries.

Receive: bound input size -> bind known routing candidate to authenticated session
-> check exact durable ciphertext duplicate -> persist receive intent -> runtime
decrypt -> validate frame/session identity and schema -> persist vault staging ->
recheck admission/permissions -> stage receipt or atomic final application.
Plaintext only in memory or destination encrypted vault. Zero transient buffers
where supported. No filenames, keys, tokens or bodies in logs.

The runtime persists ratchet progress before returning plaintext/ciphertext.
It does NOT transact with the sync database. The state-machine crash table defines
uncertainty handling; no restoration of an older session snapshot is permitted.

## 8. ACK, expiry and catch-up

RECEIPT includes exact staged chunk indices. It never means application completed.
COMPLETE means the receiver durably applied the entire approved batch. If COMPLETE
is lost, resend only the cached terminal response after current peer validation;
do not reapply or re-encrypt a completed logical operation. After revocation no
response is required to that peer, including old ACKs.

An admission that expires before commit fails. Exact bytes in the outbox remain
for evidence, but are not released under a new admission. Retained eligible
application data may be freshly exported after revalidation with new transfer ID;
existing logical IDs permit idempotent import. Source data that was deleted or
expired cannot be recreated from retained transport artifacts.

If offline longer than queue retention, request a new selected snapshot from an
active source. If unavailable, expose a history gap. Never claim a master backup
exists. Re-exported records from a revoked original author are historical facts
asserted by the current exporter, not live operations authorized by that author.
Lifecycle, verification, unblock and deletion authority cannot be re-exported as
fresh authorizations. Their existing authenticated paths must establish them.

## 9. Normative parser examples

Canonical small body: `{"challenge":"00000000000000000000000000000000"}`.
Its UTF-8 representation has no newline. This all-zero ID is permitted only in
test vectors; generators must use the existing CSPRNG, never counters.
Reject `{"challenge":null}`, duplicate `challenge`, unknown `extra`, escaped
equivalent field names on the wire, uppercase hex, omitted fields and trailing
whitespace. Reject noncanonical number `1e0` where integer `1` is required.

Fixed complete-frame encoding fixture, 483 UTF-8 bytes, no newline:

```text
k3ncrypt-sync-v1:{"version":1,"purpose":"device-sync","type":"reconcile.request","scope":"user-a","sender":"device-a","senderIdentity":"identity-a","receiver":"device-b","receiverIdentity":"identity-b","epoch":0,"commitment":"0000000000000000000000000000000000000000000000000000000000000000","stream":"00000000000000000000000000000000","sequence":1,"message":"00000000000000000000000000000000","admission":null,"transfer":null,"body":{"challenge":"00000000000000000000000000000000"}}
```

SHA-256 of those bytes:
`3beebd9de5adbadb955c3c58eba32b6d9c1b2668fd702708e52db70eb5447711`.
This is a parser fixture, not a valid live trust proof: its placeholder commitment
does not attest a lifecycle list. A syntactically valid fixture still fails runtime
authorization without a matching authenticated context.

Before implementation merge, additional manifest/record positive and negative
fixtures must be independently reviewed. Tests must not compute their expected
output with the implementation under test. This is test evidence work, not
permission to vary the schema.

## 10. Membership ordering: final authority decision

G1 is closed for the bounded blocking profile by the normative
[conflict authority decision](PHASE6B8_CONFLICT_AUTHORITY_DECISION_RECORD.md).
Use its exact resolution schema, durable one-choice locks, old-member participant
set, explicit user selection and installed barrier. Resolution is not a hash
winner, server decision, primary-device rule or implicit quorum.

Local verified revocation immediately rejects the target and suspends sync.
Resumption requires every previously active member's authenticated fencing and
resolution evidence, including the removed member, plus target confirmation for
new members. Missing evidence keeps sync suspended indefinitely. Local blocking
does not require the target's consent; cross-device resumption can be prevented
by that target's absence or refusal. This explicitly narrows the earlier desired
availability guarantee and must be disclosed in the product.

The decision record's `resolution` frame is the only addition to the type table
in §3. It uses the same dedicated authenticated channel and never authorizes old
content or resets a lifecycle commitment. Existing divergent committed branches
are not repaired by rollback. No override or hidden recovery path is allowed.
