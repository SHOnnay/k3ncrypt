# Multiplexed Relay v1 Design

Status: Stage 1 proposal; review required before implementation. The Stage 0
security gate found that ordinary Olm messages do not have authenticated room
binding, so mux delivery must remain blocked until the versioned application
message design below is reviewed and adopted.

## Stage 0 findings and security boundary

The device authorization identity is device/account scoped. A device proof names
`accountIdentityReference`, `deviceId`, `deviceIdentityReference`, operation,
and trust epoch. Its optional `resource.conversationId` is signed into the
short-lived proof request and copied into the server-issued proof. The relay
currently checks that resource against the joined socket's room for message
and signal sends. At initial `chat-join`, the proof is device-verified but the
server does not compare its optional resource with the room being joined. The
device identity and trust epoch are therefore not room identities, and current
room scoping is not uniformly enforced across join and later operations. Stage
1 must close that gap with a dedicated room-subscription proof.

Modern routing addresses are room scoped. The pre-key store keys each
publication by `{ channel: conversationId, address }`; bundle renewal proofs
are checked against that same pair. A routing address is not an identity key.
Modern conversations also persist their local/remote routing addresses,
session record, outbox, and replay state under the conversation ID.

Room binding is partial and is not a cryptographic property of ordinary Olm
messages today. `VodozemacRuntime` creates/restores one session record under a
conversation ID and `ModernConversation` binds each instance to one immutable
room. This makes established sessions distinct in the intended application
path. The room ID is not an input to `createOutboundSession` or
`createInboundSession`, is not included in the Olm session transcript, and does
not appear in Vodozemac envelope associated data. The authenticated inner
frame is only `{ innerVersion, channelByte, payload }`; the ciphertext envelope
is `{ version, strategy, data: { version, olmMessage } }`. Neither carries a
general room ID.

The session-establishment APIs authenticate the sender Curve25519 identity,
the recipient Curve25519 identity, and the recipient one-time key through
Olm's pre-key exchange. The Olm session ID identifies the resulting session,
but it is not a room ID. Ed25519 identity pinning and the room-scoped routing
address are checked by application logic around the handshake, not committed
to the Olm cryptographic transcript as a room binding.

Consequences for a mux receiver:

- A room-A ciphertext sent through a room-B transport with room-A proof is
  rejected by the current message/signal relay handlers because the proof's
  `resource.conversationId` must equal the joined socket room. The initial
  `chat-join` handler currently verifies device authority but does **not**
  compare the optional proof resource with `channelID`; Stage 1 must add a
  dedicated room-subscription proof and enforce that equality.
- If the outer room, routing IDs, and proof are all independently valid for
  room B, an established room-B Olm session rejects ciphertext made under
  distinct room-A session state at Olm authentication/decryption. This is the
  expected normal case, not a universal invariant.
- A first Olm pre-key message has no room claim. If room B has no established
  session and its receiver uses the same peer identity and matching recipient
  pre-key state, Olm can decrypt that exact ciphertext. `receiveUnlocked`
  checks that the transport sender address is the expected room-B address and
  that the sender's pinned identity matches, but ordinary text has no inner
  room field to compare. `JoinIntroduction` is the exception: its signed
  plaintext carries `conversationId` and `acceptJoinIntroduction` rejects a
  room mismatch. Therefore transport proof and address checks alone do not
  establish cryptographic room ownership for all message payloads.
- Message replay IDs are room scoped (`envelopeIdForEnvelope(roomId, ...)`)
  and their durable seen records are keyed by room. The same ciphertext
  relocated to another room is not deduplicated as the same room event.

The real generated Vodozemac WASM probe (`node
scripts/probe-olm-room-binding.mjs`) confirms that the same first pre-key
ciphertext decrypts in two independent copies of the same recipient account
pre-key state, while an established independent room session rejects the
other ciphertext. This models a stale/concurrent pre-key snapshot and proves
the Olm primitive itself has no room binding. Once one inbound handshake is
committed, that recipient account consumes the one-time key, which helps
prevent a later sequential replay; it does not bind the ciphertext to a room
and is not a substitute for an authenticated room field.

### ROOM_MESSAGE_V1 pre-mux security milestone

`ROOM_MESSAGE_V1` is an authenticated application wrapper carried inside the
existing Olm plaintext. It does not change Olm, attachment encryption, identity
pinning, or explicit verification. Its canonical byte encoding is:

```text
ASCII "K3NCRYPT/ROOM-MESSAGE\0"   fixed domain separator
u8 version = 1                    fixed
u8 payloadKind                    1=text, 2=attachment-reference,
                                  3=join-introduction
16 bytes room UUID                RFC 4122 textual UUID decoded to bytes
u16be senderIdentityRefLength
UTF-8 senderIdentityReference    exact K3 fingerprint text
u16be recipientIdentityRefLength
UTF-8 recipientIdentityReference exact K3 fingerprint text
16 bytes sender event UUID        RFC 4122 textual UUID decoded to bytes
u32be payloadLength
payload                           exactly payloadLength bytes
```

There are no optional fields, maps, whitespace, or alternate UUID spellings.
UUID inputs use lowercase canonical `8-4-4-4-12` hex and become fixed 16-byte
fields. Each `K3 ` identity reference is exactly 56 UTF-8 bytes: `K3 ` plus
43 uppercase base64url digest characters grouped as ten groups of four and a
final group of three, separated by ten spaces. V1 rejects every noncanonical
length or spelling. The wrapper payload maximum is 61,440 bytes. The composer
and service enforce a smaller 16,384 UTF-8 byte message limit so encrypted
frames fit the existing 32 KiB relay JSON envelope cap with framing headroom.
Text must be valid UTF-8, and attachment references and introductions must match their
respective content markers. The parser requires exact lengths, supported
version/kind, valid identity references, and no trailing bytes. The payload is
exposed to application parsers only after the immutable room and both stable
identity references match. Event replay identity is SHA-256 over the separate
`K3NCRYPT/ROOM-MESSAGE-EVENT-ID\0` domain, room UUID bytes, sender reference
length and bytes, and event UUID bytes. Durable replay state remains keyed by
room. A second room-keyed marker stores a commitment to the complete canonical
wrapper; retransmission of the same event ID and same bytes is suppressed,
while reuse of an event ID for different content fails closed.

Participant references are the sender's local identity fingerprint and the
recipient's pinned identity fingerprint. They are stable through routing
address renewal. The routing address is a room-scoped mailbox key and the
current renewal flow updates the bundle at that same address; it is not a
cryptographic identity and is deliberately absent from the wrapper. This avoids
invalidating queued offline content when a routing address is renewed or
replaced. A genuine identity change continues through the existing reviewed
identity-change/reset flow.

The exact enforcement chain for future mux traffic is:

```text
outer mux room
== authorization/proof resource room
== immutable RoomTransportChannel room
== authenticated ROOM_MESSAGE_V1 room
```

The backend checks the outer frame against the active subscription and the
fresh room-scoped proof. The room-bound transport dispatches only to the
immutable room channel. `ModernConversation` checks the decrypted wrapper's
room and sender/recipient identity references before application parsing or
acceptance. The current one-room relay has no mux outer frame yet, so its
joined room is supplied by that immutable channel. A future mux transport MUST
set `requiresRoomMessageV1`; legacy payloads on that path fail closed. Both
peers must advertise `room-message-v1` before new sends use the wrapper.

### Identity binding and current capability limitation

`fingerprintVodozemacIdentity` hashes the canonical pair of public keys: the
exact Olm Curve25519 identity key and the account Ed25519 signing key. For
inbound first-prekey traffic, `ModernConversation` validates the fetched public
bundle, derives the K3 fingerprint from its identity tuple, and passes that
same bundle's Curve25519 key to `createInboundSession`. Vodozemac checks the
pre-key message against that remote key. The V1 wrapper sender reference must
then equal the fingerprint derived from the same tuple before application
acceptance. Existing contacts additionally require the presented fingerprint
to equal the pinned K3 fingerprint. A relay cannot replace the Curve25519 key
while preserving the wrapper's claimed K3 identity except by a hash collision.
The relay bundle itself is not a separately signed identity document;
first-contact authenticity still depends on explicit out-of-band verification
of the displayed K3 fingerprint.

Relay-advertised `peerProtocolFeatures`, including `room-message-v1`, are an
unauthenticated optimization hint only. They are not a security capability
statement and currently provide no downgrade resistance. V1 is therefore not
a universal hard transport invariant. A future mux implementation must use a
persisted, authenticated, monotonic minimum-wrapper-version latch. Relay
metadata may raise an optimization hint but must never lower that security
floor. Today a peer's features can be absent while it is offline; future
mailbox-based strict sending must not require a live peer merely to rediscover
support. That offline capability problem remains unsolved here.

Legacy one-room relationships remain compatible: new sends use the wrapper
only after peer feature negotiation, and non-strict receives continue to
accept already-queued legacy frames. No stored ciphertext, history, session, or
outbox is rewritten. New outbox records mark the wrapper version; on a future
strict mux transport, legacy entries without that marker are skipped and remain
queued for the legacy room transport. Strict sends fail if the peer did not
negotiate V1. A saved legacy join-introduction ciphertext is likewise not
submitted on a strict transport. Future mux subscriptions require V1 and
cannot carry legacy outbox payloads; migration/re-establishment and old-outbox
handling must be reviewed before mux implementation.

New queued envelopes also pin the intended recipient K3 identity reference.
Every retry requires the current contact to remain unchanged at that same
reference immediately before dispatch. Pre-existing queued entries without a
recipient reference stay pending because their original identity target cannot
be established safely.

The wrapper covers all application payloads sent through the generic
ModernConversation message channel: text (including encrypted profile
metadata), attachment references, and signed join introductions. Call
signaling/device-control events on their separate authenticated signaling
channel are not rewritten here. Attachment V2 already binds its conversation,
participants, transfer, and chunk metadata independently; its content crypto
is unchanged. A moved attachment reference is rejected by the message room
check before the file-reference consumer or retrieval path.

For first inbound pre-key messages, the current runtime creates a candidate
in-memory Olm session and candidate mutated account (including one-time-key
consumption), decrypts, and calls the acceptance builder before serializing or
persisting either candidate. The wrapper check occurs in that builder. Only a
successful wrapper/application validation is followed by one CAS that commits
the account, session, and accepted message/replay records together. On a
wrong-room or otherwise rejected wrapper, the candidate is discarded and the
runtime reloads durable identity state; durable OTK state is not consumed, no
session/message is committed, and no recipient-acceptance ACK is returned.
Established sessions similarly decrypt and validate before the session
ratchet and application acceptance updates share their atomic commit.

The relay's storage ACK remains distinct from recipient acceptance. The
recipient app acceptance signal occurs only after decrypt, wrapper validation,
application validation, and durable commit; a rejected room binding cannot
produce the sender-visible accepted state.

Stage 0 observed that ordinary 20-round room switching generated many
legitimate pre-key and device-proof 429 responses (including 65 pre-key GET,
one pre-key POST, and repeated device-proof responses across three profiles).
Do not weaken freshness or authentication to address this. Stage 1 should
avoid unnecessary pre-key lookup on ordinary UI selection when a valid
established encrypted session is already present.

Current UI delivery wording is confirmed by `securityVisibility.ts` and the
relay flow: `Sending…` is a durable local outbox item awaiting recipient-app
acceptance. `Sent` for ModernConversation appears after the recipient accepts
and commits the decrypted event and the relay reports that acceptance to the
sender. It is not a signed peer receipt, display receipt, or read receipt. The
relay's immediate `chat-message` ACK only establishes relay acceptance or
mailbox persistence; it does not by itself change a modern message to `Sent`.

## Current ambient-room inventory

| Area | Current assumption | Stage 0 classification |
| --- | --- | --- |
| `ChatContext.channelHash` | Selects the visible room and several legacy/current-room operations. | UI-only selector; correctness must move to bound room state before mux. Modern messages/history now resolve through `RoomState`; new file operations take an explicit room ID. Remaining active-room projections are **must become room-scoped before mux**. |
| Message history | Previously a separate room-keyed map with a global selected projection. | `RoomState` now owns the room key and history; active-room selection is only a projection. |
| `ModernConversation.roomId` | A per-instance mutable field selected during `connect`. | Safe as instance-owned session context, now bound once; reconnecting that instance to another room rejects. Session, outbox, and replay records are room-keyed. |
| Service transport manager and relay join | Join APIs previously accepted a room ID while later send used the transport's remembered desired room. | `RoomTransportChannel` now binds one immutable room and owns connect/send/close. Stage 0 still uses the current one-room socket. |
| Relay `desiredConversation`, `activeConversationId`, `joinedConversationId`, socket `channelID`/`userID` | One connection remembers one joined room and routing participant. | Safe for legacy one-room Stage 0. These become a backend subscription table and room-keyed event dispatch in Stage 1. |
| Backend `socket.channelID` and `socket.userID` | Messages, peer lookup, mailbox replay, and ACK deletion use one room bound to one socket. | **Backend Stage 1 change**; a mux socket cannot use these as ambient mutable ownership. |
| Relay `received` / `delivered` ACKs | Current events use bare message IDs; server deletion additionally reads the socket's room and user. | Safe only under one-room sockets; Stage 1 requires room, event, device, and generation correlation. |
| Call composition and call ID | One global local call slot; authenticated signals already bind a conversation ID. | The global call slot is safe to keep. Room/call identity must remain room-owned; call display now follows `activeCallRoomId`, not the changing current room. |
| FileContext workflow | Workflow was recreated from selected-room bindings; the eventual send callback referenced a mutable latest-send function. | Stage 0 captures the room ID and uses room-explicit binding/header/send APIs. A transfer cannot resolve its recipient from a later selection. The single visible transfer slot is UI-only. |
| Profile sharing and call support | Some per-contact work can run outside the visible selection. | Room-local ModernConversation is safe to keep; shared relay multiplexing and ACK routing are backend Stage 1 changes. |
| Active/pending navigation | UI selection may differ from a transactional room candidate while connecting. | Active room remains UI-only; pending target and open error are now scoped by room and operation. Newer open requests fence stale candidates. |

## Target architecture

One authenticated device connection is a transport multiplexing boundary. It
does not authenticate a person for a room, grant room membership, establish
identity, or establish explicit contact verification. Each room keeps its
current independent crypto session, pinned identity, explicit verification,
room control capability, member routing identities, and message/file
encryption. The server routes opaque envelopes and sees routing metadata; it
does not process message plaintext. K3NCRYPT does not claim anonymity.

## 1. Device connection and generations

Authenticate the socket using the existing device authorization authority and
the device proof fields already used by the relay. Bind exactly one active
socket generation to `(accountIdentityReference, deviceId)`. The account and
device identifiers select the lifecycle record and quotas; they do not grant
any room subscription. Replacing a device socket increments a server-owned
generation, fences the old socket, and invalidates its subscriptions and
pending ACK authority. Reconnect requires fresh device authentication and
resubscription proofs; never reuse a proof from the prior connection. A
connection that cannot prove an active current device epoch remains
unauthorized.

## 2. Room subscription authorization

Each `subscribe` request is independently authorized. It must carry:

- the room's existing control capability;
- the room-scoped routing address and its current renewal proof;
- a fresh, server-verifiable device authorization proof whose operation and
  resource identify this subscription and conversation;
- a connection generation, operation ID, nonce, and short expiration.

The current proof protocol has operations such as `relay:message` and
`relay:signal`, but no `relay:subscribe` operation. Stage 1 must add and review a
dedicated operation or explicitly approve reuse of a current operation; do not
silently reinterpret one. The server must validate the proof's device/account
binding and epoch, room control capability, current room membership/routing
record, and replay protection together. A successful subscription is a scoped
transport fact only; it is not explicit contact verification. Identity-change
and message/call trust checks remain client-side and room-local.

## 3. Multiplex frame

Use a strict versioned outer frame with a minimal field set:

```text
protocolVersion
eventType
roomId
senderRoutingId
recipientRoutingId (when a target is required)
senderEventId
serverEventId (relay assigned for accepted storage/delivery)
connectionGeneration
ttlClass (only for expiring event classes)
opaquePayload
proofCarrier (only when required by the operation)
```

Do not include plaintext, display names, plaintext contact identity, crypto
keys, or secrets. `roomId`, routing IDs, event timing, and subscription state
are metadata visible to the relay. Exact-key validation, size limits, and
event-specific schemas are mandatory. Event ACKs carry the same room and event
correlation tuple; the server derives the authenticated sender from the bound
subscription rather than trusting a frame-supplied sender.

## 4. Three-way authorization and room isolation

Before accepting a room event, Stage 1 checks:

1. the active device connection generation is authorized and has an active
   subscription for the exact room;
2. the operation proof is fresh, unconsumed, and bound to that same room and
   operation;
3. sender and recipient routing records are current members of that same room,
   and sender identity is derived from the authorized subscription;
4. once a separately reviewed encrypted room-binding wrapper exists, its
   authenticated room and participant fields equal the outer room and routing
   fields.

The subscription table is keyed by the server-authenticated device connection
and room. No dispatch, mailbox operation, or ACK may look up a room from a
mutable UI selection. A wrong-room proof, routing record, connection
generation, event ID, or inner room binding rejects the operation. Call events
use the exact same room binding and additional existing call ID, identity
binding, replay, and sequence checks.

## 5. ACK layers and UI meaning

- **L0 — sender local durable outbox:** encrypted envelope and sender history
  are committed atomically before network submission. `Sending…` may remain at
  this state.
- **L1 — relay durable acceptance:** relay has persisted the opaque event in
  the recipient mailbox. This is a relay storage outcome, not recipient
  delivery.
- **L2 — live push:** relay attempted a live push of the accepted event. This
  is transport telemetry and is not recipient acceptance.
- **L3 — recipient application acceptance:** recipient decrypted and
  atomically committed the event to its room history/replay state; the relay
  reports this result to the sender. Current modern `Sent` means this relay
  report, not a signed peer receipt.
- **L4 — optional future read receipt:** separate, explicit, authenticated
  receipt with user-facing privacy controls. It is not inferred from L3.

Do not change Stage 0 UI semantics. Any later `Delivered` label must name its
precise layer. Never collapse L1 and L3.

ACK correlation is at least
`(roomId, serverEventId, claimId, recipientDeviceId)` for mailbox events and is
validated against the active subscription and current mailbox claim. Each
lease claim gets a fresh opaque claim ID; stale acceptance or rejection from a
previous generation cannot mutate a reclaimed row. Sender IDs are
namespaced by `(roomId, senderDeviceId, senderEventId)`; server IDs are unique
within a room and recipient mailbox. Never acknowledge by bare ID.

## 6. Delivery, replay, and ordering

Delivery is at least once. Client acceptance is idempotent and atomically
commits decrypted room history and replay identity. Maintain ordering within a
room where current relay/session behavior requires it; there is no global
ordering promise across rooms. Mailbox replay is room scoped, bounded, and
fairly scheduled across subscribed rooms. A mailbox item is removed only after
the intended recipient device reports L3 for the matching room, event, and
claim. A separately authenticated recipient terminal-rejection decision can
also leave the active queue, but it is never L3 and never produces `Delivered`.
Reconnect obtains fresh proofs, creates a new generation, restores authorized
subscriptions, and replays from per-room cursors. Duplicates are suppressed by
durable per-room acceptance state. Old claims cannot ACK, reject, delete, or
advance the replay cursor for a replacement claim.

### Current mailbox terminal decisions

The current room relay stores opaque mailbox rows with a 7-day TTL and a
64-active-row per-room recipient quota. A recipient decision has three
outcomes: accepted (durable local commit), retryable (no acceptance/rejection;
lease expiry permits retry), and terminal rejection (authenticated content is
deterministically unusable under the recipient's current policy). Only the
last outcome sends `recipient-rejected {id, roomId, claimId, reasonClass}`.
The server derives recipient ownership from the joined socket, checks the
active device epoch and room, and conditionally updates the exact current
claim. Reason classes are coarse: `authenticated-invalid`,
`unsupported-message`, or `identity-changed`.

Terminal rows retain only dedupe/routing/timestamp/expiry and bounded reason
accounting; the opaque envelope, claim generation, and active quota slot are
removed. `claimedUntil` is retained at the original `expiresAt` as a rollback
barrier: old relays, which do not filter `state`, will not claim an empty
tombstone before TTL cleanup. New relays exclude `state: rejected`; the
tombstone is not replayed or counted against active quota. Unversioned legacy
ACKs can remove only rows that have no claim generation, so they cannot ACK a
newer claim. The tombstone prevents retry of the same ciphertext from silently
recreating a poison row. The sender keeps its durable outbox item marked
terminal and does not auto-retry it; the existing safe failure/retry UI starts
a new encrypted event when the user retries.

Authenticated ROOM_MESSAGE_V1 room/participant mismatch, event-content
conflict, malformed authenticated application payload, and forbidden legacy
payload are terminal. Unsupported wrapper versions/kinds are also removed
from active replay as `unsupported-message`, while the sender retains its
local event for a deliberate new send after compatible software is available.
No plaintext reason is returned to the sender. Identity-change rejection
keeps old ciphertext blocked and never repins. Failures before Olm
authentication, device-trust/database uncertainty, and network interruption
remain retryable and do not disclose a rejection class; this intentionally
avoids an unauthenticated crypto-failure oracle. Such undecided entries remain
subject to the existing 64-row quota and seven-day expiry.

#### Deployment and mixed-version behavior

Production does not apply schema changes during server startup. Run
`npm run migrate` successfully before routing traffic to this version. The
migration backfills rows without `state` to `active`, preserves their opaque
envelopes, then replaces the old unconditional slot index with a unique partial
index for active rows. Existing active rows without `claimId` remain readable;
the next new claim adds a fresh generation. A new client receiving a
claim-less live event uses the legacy `received` ACK path; it does not submit a
terminal mailbox event without a claim. A legacy client can still ACK a
mailbox callback as accepted; the relay itself conditionally commits that ACK
against its server-held claim generation.

Deploy the backend before terminal-aware clients. New clients talking to an
old backend cannot commit `recipient-rejected`; the old backend will treat the
negative callback as unaccepted and retry under its legacy lease behavior.
Rolling back the backend is safe for stored tombstones: their legacy lease
field keeps old relays from replaying them until the original TTL removes them.
During rollback, terminal notices are not understood by old code, so sender
outbox UI may remain pending until the client reconnects to a terminal-aware
backend; this does not represent acceptance or `Delivered`. Mixed backend
versions should not serve the same mailbox concurrently during the migration
window.

## 7. Calls (Stage 2)

Use an encrypted, room-bound, short-lived call-invite event with a target TTL
around 30–60 seconds, finalized from product timing and implementation tests.
Deliver live and retain briefly in a bounded mailbox so a short disconnect or
room-open race does not lose an invitation. Expired invitations do not ring;
a local missed-call item may be created only if the product's existing call
state supports that conclusion. A cancel event with the same room and call ID
supersedes a pending invite. Do not durably mailbox full SDP/ICE. Once accepted,
the normal authenticated live signaling protocol continues and stays scoped to
the immutable room and call identity. A generic wake may accelerate delivery,
but cannot replace the durable invite or room authorization.

## 8. Starting resource policies

Initial configurable policy for personal/family use and roughly 100 contacts:

- one multiplexed relay socket per device, with server replacement/fencing;
- at most 128 logical room subscriptions per device initially, with batched
  subscribe/unsubscribe and a hard server limit;
- per-socket and per-room event rate limits, bounded event size, and bounded
  in-flight ACK windows;
- replay batches capped per room, fair round-robin service across rooms, and
  bounded concurrent mailbox claims;
- per-room and per-device mailbox event and byte ceilings plus expiry;
- call-invite rate limits, at most one active local call, and strict invitation
  TTL;
- exponential reconnect backoff with jitter and a cap;
- lazy room crypto/session runtimes; a subscription does not require 128 active
  WebRTC negotiators or 128 unbounded replay tasks.

These are starting values to load-test, not immutable wire constants. Exceeding
a limit produces a scoped, retryable error without changing trust state.

## 9. Metadata and privacy

The current one-room transport mainly exposes the room currently joined to the
relay. A multiplexed connection lets the relay link one live device connection
to all rooms subscribed on it and observe per-room timing/activity. This is a
privacy cost even though content remains encrypted. A wake-only design may
reduce continuous room-subscription visibility, but if a wake names a room the
relay still learns that routing association; opaque handles do not make it
anonymous. Document this plainly in product privacy materials before rollout.

## 10. Capability negotiation and migration

Keep legacy one-room transport and introduce `mux-v1` as a negotiated
capability. A device uses mux only after both the authenticated server and
client explicitly confirm support and the room subscription succeeds. Otherwise
it may use the existing one-room transport with its existing room capability,
routing proof, and device proof checks. Never fall back after an authorization
failure by dropping a proof or reusing another room's authorization. During
migration, deduplicate events across transports using the room-scoped durable
event identity. Add observability that reports protocol version and safe
failure category only.

## 11. Component responsibilities

- **Backend:** device socket lifecycle/generation, per-room subscription map,
  per-subscription proof and membership checks, multiplex routing, room-keyed
  mailbox/ACK/replay, quotas, backpressure, and later expiring call invites.
- **Service SDK:** authenticated device connection, room-channel handles,
  proof acquisition per operation/resource, frame validation/demultiplexing,
  room-local reconnect/replay, and preservation of the current crypto/trust
  boundaries.
- **Web:** account transport lifecycle plus a room-state registry; route each
  event/ACK to the bound room object; keep display selection separate from
  crypto/security state; later add background acceptance and unread policy.
- **Android:** implement the same protocol/frame/proof and ACK behavior only
  after Web/SDK protocol review, with shared positive and adversarial fixtures.

The Olm primitive, attachment AEAD primitive, pinned identity, explicit
verification authority, and room membership/control authority remain separate
from transport multiplexing. However, ordinary message encoding needs a
versioned authenticated room wrapper before mux. Attachment V2 has its own
stronger object-level binding: its AES-GCM associated data includes conversation
ID, sender and recipient participant IDs, sender and recipient pinned identity
references, transfer ID, object type, and chunk parameters. Relocating a V2
manifest/chunk to another room or changing any bound field fails GCM
authentication; the attachment AEAD itself needs no additional room field.
The file-reference message is ordinary Olm message content and shares the
general room-wrapper gap, but `FileTransferWorkflow` compares its complete
reference binding to the selected room before retrieving or exposing output.
Call signals already authenticate conversation, call ID, participant identity,
event digest, and replay state. Those checks must remain in place.

## 12. Future Stage 1 adversarial test matrix

Reject or safely ignore each case without mutating another room's state:

1. Bob event injected with Carol's outer room ID.
2. Proof room differs from outer room.
3. Authenticated crypto-wrapper room differs from outer room (required before
   mux can be enabled; exact test fixture is part of the protocol review).
4. ACK arrives from a different room.
5. ACK arrives on a stale connection generation.
6. Subscribe proof is replayed.
7. Device attempts an unauthorized room subscription.
8. Device is revoked after connection or during a subscription.
9. Routing proof/address is stale, expired, or belongs to another room.
10. Duplicate mailbox event is replayed.
11. Sender reuses an idempotency ID with different event content.
12. Mailbox replay resumes after reconnect with no lost or cross-room ACK.
13. Expired call invite is replayed and does not ring.
14. Canceled call invite is replayed and does not ring.
15. Event is dispatched to a `RoomChannel` other than its bound room.
16. Active UI room changes while background receipt is committed.
17. Stale operation completion cannot replace the selected room or its error.
18. Per-room and per-socket quotas/backpressure do not starve other rooms.

Stage 0 keeps the current behavior: only the opened room is live and mailbox
replay happens on opening that room. It does not implement background delivery,
notifications, unread state, or background calling.

## Stage 0 final gate evidence

The former 20-round test appeared stalled because its candidate-isolation step
selected Carol while Alice was already viewing Carol, then awaited a pre-key
request that a same-room selection correctly never issues. The wait had no
timeout. The test now first makes Bob active, injects a bounded wait on Carol's
new device-proof request, and verifies that a newer Bob selection remains
active after the delayed Carol candidate completes.

The corrected Chromium scenario completed 20 Bob/Carol switch rounds, refreshed
and unlocked Alice, sent after refresh, transferred four 20 KiB JPEGs with
matching downloaded SHA-256 hashes, and completed three declined-call cleanup
cycles. Timed switch operations ranged from sub-second to about 9 seconds. Safe
response counts during the pre-refresh interval included 58 HTTP 429 responses
on pre-key endpoints and 10 on Alice's device-proof endpoint (Bob and Carol
also saw 2 and 1 device-proof 429s respectively). A focused call run confirmed
`Retry-After: 1` on these categories. That identifies the broad API limiter as
the limiter reached in these runs: capacity 120, refill 2 requests per second
per client IP. All three browser profiles share one IP bucket. The pre-key and
room-control routes also have a stricter per-route/IP limiter (capacity 20,
refill 0.25 requests per second, which returns `Retry-After: 4`) but the
recorded responses did not identify that stricter limiter as the source. The
client retried the observed 429s and the scenario completed. Reopening a saved
room currently fetches the peer bundle and checks the local bundle on every
connection, so repeated switching consumes pre-key GET quota despite an
existing persisted Olm session. This is an availability/policy mismatch to
review separately; do not weaken identity freshness or authorization as a
test workaround.

Alice opened 41 relay sockets and closed 40 before refresh, leaving one active
socket as expected. No leaked socket or wrong-room message was observed in the
20 rounds. This regression covers transport/room-state isolation and declined
call cleanup. A separate call-after-switch run connected Alice and Bob, ended
the call remotely, opened Carol, then completed a Carol call and subsequent
Bob/Carol declines. The full-screen call overlay intercepts navigation, so a
user cannot change the visible room while the live call overlay is open. The
existing `CallOverlay` unit test confirms the call contact remains tied to its
room if selected-room state changes. The room-binding finding above remains a
blocker for mux-v1 regardless of these Stage 0 results.

An instrumented rerun after that investigation completed both Playwright tests
in 9.3 minutes. The 20 switch rounds again passed, followed by refresh/unlock,
the four 20 KiB transfers with matching SHA-256 hashes, and three decline
cleanup cycles. The exact status endpoint was identified as room eligibility:
41 requests returned 200, with a 26 ms maximum observed response. Device-proof
requests reached 47 ms maximum; pre-key GETs reached 73 ms maximum. Mailbox
replay acknowledgements completed 41 times in 326 ms total, with a 16 ms maximum.
The measured candidate-connect interval including replay reached 8.2 seconds;
the old-socket close interval reached 8.24 seconds. The measured connected
Alice/Bob call setup was 1.135 seconds. File preparation took 4.9–8.9 seconds,
upload took 15.9–20.0 seconds, and download plus verification took 5.0–9.0
seconds. Switches varied from sub-second to about 9.1 seconds.

The rerun refined the earlier 429 diagnosis. Alice's pre-key GETs returned 65
429 responses: 59 with `Retry-After: 4`, identifying the stricter
pre-key/room-control route limiter (capacity 20, refill 0.25 requests/second
per IP), and 6 with `Retry-After: 1`, identifying the broad API limiter
(capacity 120, refill 2 requests/second per IP). A pre-key POST also returned
one broad-limiter 429. Alice's device-proof POSTs returned 13 broad-limiter
429s; Bob and Carol returned 2 and 15 respectively. The three browser profiles
share the test IP. This confirms two independent quota pressures: opening
saved rooms repeatedly re-fetches pre-keys despite an existing session, and
every new relay connection obtains a fresh device proof. Do not weaken proof
freshness or authorization to reduce the counts; review request policy and
limit budgets before background multiplexing.

## Stage 1A implementation boundary

The implementation branch adds an opt-in, subscription-only protocol. It is
not enabled by the UI and does not carry messages, signaling, ACKs, or mailbox
replay. Existing one-room transport remains the only application delivery path.
This is a reviewable Stage 1A checkpoint, not production readiness.

The socket generation is the server-issued Socket.IO `socket.id`; the client
cannot select or reuse it across reconnects. `mux-authenticate` accepts only a
`relay:connect` device proof whose exact resource is
`{ connectionGeneration }`. The proof binds account, device identity, trust
epoch, operation, nonce, and generation. A process-local current-socket table
allows only the newest authenticated socket for an account/device pair; a
superseded socket cannot subscribe and is disconnected.

Each `mux-subscribe` carries one version-1 room ID, local and peer routing
addresses, that room's control capability, local pre-key routing-renewal proof,
the current generation, negotiated known feature names, and one
`relay:subscribe` device proof. Its exact resource is
`{ conversationId, routingAddress, peerRoutingAddress, connectionGeneration }`
where `conversationId` equals the outer `roomId`. The room control capability
proves access to that room; the routing-renewal proof proves possession of the
local route; the device proof proves the active device. None of these asserts
contact verification or substitutes for client-side pinned identity. The
subscription record is immutable per room and contains the same route context,
generation, proof nonce, protocol feature set, and server-enforced expiration.

The server serializes authenticate/subscribe/unsubscribe operations per socket.
Subscription and unsubscription must match the current generation and active
device trust epoch. A newly authenticated socket supersedes the old one; old
socket disconnect cleanup uses expected socket IDs so it cannot erase a newer
route. A subscription expires with its proof (at most five minutes), is removed
from the room's live route map at expiry, and is renewed with a fresh proof one
minute before expiry. The client and server both cap room subscriptions at
128. Reconnect uses a new socket ID, fresh connect proof, and serial fresh
subscribe proofs; failed subscriptions are not treated as active. No raw
proofs, capabilities, routes, or room contents are logged.

Proof request IDs and nonces, then issued proof IDs, are each consumed once in
the existing `device_proof_nonces` collection. Its existing unique
`proofId_1_deviceId_1` and `expiresAt_1` TTL indexes cover these records. Stage
1A therefore requires no Mongo collection/index migration. The in-memory
socket/subscription table is intentionally process-local; it provides no
multi-node coordination or durable subscription state. A restart drops all
subscriptions and requires reconnect/resubscribe.

At this checkpoint the relay still has no mux event dispatcher and the client
room adapter deliberately rejects `sendEnvelope`. Do not advertise mux message
delivery or use these subscriptions for production traffic. Before Stage 1B,
the server needs a room-keyed envelope/mailbox dispatch contract with
generation-scoped ACK correlation; the client needs persistent per-room
`ModernConversation` ownership, authenticated room-frame validation, durable
mailbox acceptance, and ACK only after the existing transactional commit.
Those paths must pass the full adversarial and three-profile acceptance matrix
before the protocol can carry messages.

The remaining pre-traffic gates are still open and must be closed before that
dispatcher is enabled:

- Join introductions sign `createdAt` and persist a once-per-room accepted
  event ID, but acceptance currently has no future-skew or admission-window
  rule. Define bounded future skew and replay behavior while preserving old
  legitimate offline invitations; do not add an arbitrary maximum age.
- First-prekey accept/commit is transactional in one conversation instance,
  but that mutex is not a device-wide scheduler. Bound concurrent first-prekey
  work across all live room conversations while retaining fresh-snapshot retry
  and ACK-after-commit.
- `modern-seen-room-message-v1` is a version-1 persistent room record and does
  not prune authenticated event IDs. Keep that retention. Before expanding
  replay volume, specify a versioned crash-safe migration/rollback and bounded
  development resource budget; do not introduce a time-based TTL.
- Message delivery must use the immutable room handler and remove any implicit
  selected-room/current-room attribution in every mux receive, rejection, and
  ACK path. Permanent authenticated rejection must remain distinct from
  transient decrypt/storage/unsupported-version failure.
- Revalidate current pinned identity and unchanged status at each protected
  action that can send or accept identity-sensitive control/call content. This
  Stage 1A branch has not changed call signaling or call admission.

No Stage 1A code writes the replay store, creates Olm state, or routes an
application envelope, so these blockers remain isolated for the next security
review instead of being hidden behind subscription success.
