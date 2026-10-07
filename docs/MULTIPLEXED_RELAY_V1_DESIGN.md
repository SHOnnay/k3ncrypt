# Multiplexed Relay v1 Design

Status: Stage 1 proposal; review required before implementation.

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

Room binding is only partial today. The signed join-introduction plaintext
contains `conversationId`, and call-signal authentication binds the call ID,
conversation ID, participants, and signal payload. Ordinary Olm message
ciphertext has no explicit conversation ID in authenticated associated data or
in a signed per-message outer transcript. The Olm session is created/restored
from per-conversation storage, which makes accidental cross-room decryption
fail in the intended client path, but is not an explicit wire-level
`cryptoBoundRoomId`. Attachment content encryption likewise does not establish
a general room AAD contract. Stage 1 must not claim the crypto-bound-room check
until a separate crypto-adjacent protocol change is reviewed. Do not modify
crypto in Stage 0.

The smallest future crypto-adjacent change to review is a versioned,
domain-separated encrypted plaintext wrapper carrying the conversation ID,
sender and recipient routing IDs, and message/event kind. The receiver checks
those fields against its immutable room context before applying the plaintext
or committing state. This would be authenticated by the existing Olm message
authentication, without assuming unsupported Olm AAD. It needs compatibility,
first-message/session-establishment, call-control, and attachment-reference
analysis before adoption; it is not approved by this document.

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
`(roomId, serverEventId, connectionGeneration, recipientDeviceId)` and is
validated against the active subscription and mailbox claim. Sender IDs are
namespaced by `(roomId, senderDeviceId, senderEventId)`; server IDs are unique
within a room and recipient mailbox. Never acknowledge by bare ID.

## 6. Delivery, replay, and ordering

Delivery is at least once. Client acceptance is idempotent and atomically
commits decrypted room history and replay identity. Maintain ordering within a
room where current relay/session behavior requires it; there is no global
ordering promise across rooms. Mailbox replay is room scoped, bounded, and
fairly scheduled across subscribed rooms. A mailbox item is removed only after
the intended recipient device reports L3 for the matching room, event, and
generation. Reconnect obtains fresh proofs, creates a new generation, restores
authorized subscriptions, and replays from per-room cursors. Duplicates are
suppressed by durable per-room acceptance state. Old generations cannot ACK,
delete, or advance the replay cursor for the replacement connection.

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

Message crypto, attachment crypto, pinned identity, explicit verification, and
room membership/control authority remain independent and unchanged by transport
multiplexing. Current file references already carry a conversation and
recipient-identity binding in the encrypted message reference; transfer
operations separately bind to conversation, participant, and capability.
Call signals already authenticate conversation, call ID, participant identity,
event digest, and replay state. Those checks must remain in place.

## 12. Future Stage 1 adversarial test matrix

Reject or safely ignore each case without mutating another room's state:

1. Bob event injected with Carol's outer room ID.
2. Proof room differs from outer room.
3. Authenticated crypto-wrapper room differs from outer room (after its
   separate review).
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
