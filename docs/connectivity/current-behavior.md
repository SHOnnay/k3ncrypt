# Current connectivity behavior at the Phase 0 baseline

Baseline: `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f` (`main`, clean at start). The baseline is an ancestor of this branch. This is a source trace, not a claim that production infrastructure was exercised during this task.

## Send state machine (Web / TypeScript)

`ModernConversation.sendWithReceipt()` takes the per-conversation browser tab lock and calls `sendUnlocked()` (`service/src/crypto/modernConversation.ts:680`). The send path checks local device lifecycle trust at the observed epoch, rejects an identity-change state, and ensures an outbound session. When none exists, it fetches a public bundle, observes/pins the identity without verifying it, claims a one-time key, and persists the session/mode (`:706`). It encrypts once, appends the opaque envelope to `modern-outbox`, then attempts relay delivery (`:694–704`). `retryPending()` rechecks local trust and sends the same saved envelope; a thrown send is swallowed and leaves retry to a later timer/reconnect (`:775–794`).

The browser callback currently calls this status `pending`; that accurately reflects the send API. A successful transport call records relay ID/time in the outbox. `acceptDelivery(relayId)` removes the matching pending record after the relay's `delivered` event (`:797–811`). It does not validate a new cryptographic peer receipt: the server emits that event after its `received` handler deletes any matching mailbox row.

## Receive, persistence, replay and ACK state machine

The relay adapter receives an envelope and awaits the injected handler. It emits `received` and acknowledges the Socket.IO delivery callback with `{accepted:true}` only when that handler resolves true; errors and false results return `{accepted:false}` (`service/src/transports/socketIoRelayTransport.ts:281–297`). `ModernConversation.receive()` checks local lifecycle trust, conversation and sender route, validates the envelope, computes `SHA-256(JSON.stringify(envelope))`, and checks the 1,024-entry `modern-seen` list (`modernConversation.ts:1090–1114`). A seen envelope returns true without decrypting again.

For a new session, receive fetches and validates the sender bundle, checks pinned identity state, establishes an inbound session, parses the message frame, then observes identity as unverified and saves route/session metadata. For an existing session it decrypts, handles authenticated introduction controls internally or strictly decodes text, and repairs missing contact metadata only after authentication. For a normal message it awaits `onMessage`, writes the replay marker, then resolves true (`:1115–1189`). The Web callback writes the message to the encrypted vault before updating React state (`client/src/context/ChatContext.tsx:224–234`). Thus a React render is not the acceptance boundary; the vault write is.

Android follows a stronger transactional path. `InboundMessageProcessor.receive()` serializes work with a mutex, checks dedupe, authenticates sender identity/trust, decrypts, and calls `CryptoStateStore.commitInbound()` with account/session state, stored message and digest. It publishes the live session only after `STORED` (`android/messaging/.../InboundMessageProcessor.kt:31–111,118–125`). The repository returns `true` to Socket.IO only on accepted or duplicate durable state (`AndroidMessagingRepository.kt:495–516`).

## Exact meaning of existing acknowledgements

| Event/response | Exact meaning at baseline | It does not mean |
|---|---|---|
| `chat-join` `{status:"accepted"}` | Relay authorized and registered this socket in the conversation; response may include the other socket's protocol features (`backend/socket.io/listeners.ts:230–240`) | Contact verification or message delivery |
| `chat-message` live `{id,timestamp}` | Receiver callback returned `accepted:true` before the relay's live ACK deadline (`listeners.ts:291–307`) | A separate signed/session-encrypted peer receipt; nor an independently verified human read receipt |
| `chat-message` `{id,timestamp,stored:true}` | Relay successfully inserted/reused the opaque envelope in offline mailbox storage (`listeners.ts:267–277, 314–319`) | Recipient online, decrypted, or persisted message |
| Socket.IO delivery callback `{accepted:true}` | Receiver application handler returned true. Web returns true after durable consumer callback and seen-marker write; Android returns true after atomic crypto/message/dedupe commit (`SocketIoRelayTransport.ts:281–297`; Android path above) | User saw/read the message |
| Client `received` event | Client reports its handler accepted the envelope; server rechecks bound active device and deletes mailbox row by `(id, mailbox, channel)` (`SocketIoRelayTransport.ts:290–292`; `listeners.ts:358–369`) | Independent proof from the recipient's cryptographic session |
| Server `delivered` event | Relay forwards the `received` report to the sender socket (`listeners.ts:365–369`) | A standalone authenticated receipt or read status |
| `mailbox-replay` `{status:"accepted"}` | The authenticated replay request handler completed its loop (`listeners.ts:242–249`) | Every queued message was accepted: loop can stop on no item, refusal, timeout, or device state change |
| `webrtc-signal` `{status:"ok"}` | Relay authorized and emitted signaling payload to the current peer socket (`listeners.ts:322–355`) | Peer decrypted, accepted, persisted, or applied SDP/ICE |
| Android call `signal-ack` | Relay ACK callback returned for the signaling send (`AndroidMessagingRepository.kt:187–235`) | Remote call-state transition or connected media |

**Compatibility rule:** retain these meanings during the Phase 0/1 boundary work. The existing `accepted` delivery callback must not be renamed to “delivered.” Any future `persisted by peer` state requires a separately specified authenticated receipt.

## Mailbox state machine

When no live peer is registered (or live delivery is declined/times out), the relay calls `retainUndeliveredEnvelope()`. It uses a seven-day expiry and a server dedupe key over channel, mailbox, sender and envelope. A successful insert/reuse returns `stored:true` (`backend/socket.io/listeners.ts:108–133, 267–277, 309–319`). Replay claims a row with a 30-second lease, emits it to the client, waits up to ten seconds for its callback, then rechecks active device state and deletes it (`:135–154`). The sender's outbox is removed later through the `delivered` event when its socket is connected.

`storeOfflineMessage()` retries 64 Mongo slot inserts and treats every insert exception as a possible collision before ultimately returning quota (`backend/db/index.ts:117–138`). This is recorded as a known hardening gap; it is outside the connectivity Phase 0 behavior scope.

## Calls

Call invite/accept/end state changes pass through `CallService` and its repository; `CallEventProcessor` saves the transitioned state (`service/src/calls/eventProcessor.ts:4–6`). Authenticated signaling validates conversation, sender/receiver identities, verification, membership, nonce and digest before invoking the listener (`service/src/calls/authenticatedTransport.ts:29–58`). The resulting envelope is encrypted through the existing conversation session and sent on the relay's `signaling` channel. Relay `{status:"ok"}` only confirms forwarding. Media negotiation is a separate WebRTC operation (`service/src/calls/negotiation.ts`). Local end commits/notifies the terminal state, attempts the existing authenticated terminal signal for a bounded interval, and returns (`service/src/calls/composition.ts:175–201`).

## Device lifecycle and revocation

Protected conversation operations read the local device lifecycle snapshot, validate its commitment, require the exact epoch, and require configured authenticated freshness evidence (`service/src/crypto/modernConversation.ts:442–446, 1450–1464`; `service/src/devices/trust.ts:41–70`; `service/src/devices/freshness.ts`). Local lifecycle transitions use atomic compare-and-swap storage, including a high-water epoch (`service/src/devices/runtime.ts:135–161`). A verified peer may carry encrypted trust-state control; the receiver accepts only events matching its authoritative local list and commitment. Conflicts/future epochs suspend trust (`modernConversation.ts:1316–1368`; `devices/trust.ts:74–97`). Relay sockets are also checked against their bound device ID and trust epoch before protected operations (`backend/socket.io/listeners.ts:95–103`). Offline peers cannot learn about a later revocation until authenticated state reaches them; signatures do not prove freshness.

## Known behavior gaps recorded, not fixed

1. **CP1/CP2:** TypeScript decrypt advances session state before the consumer's durable write. Consumer failure leaves no seen marker, but no transaction rolls back the ratchet. Redelivery may fail or require session recovery. Android's inbound transaction has a different ordering and must be characterized separately.
2. **CP3:** TypeScript persists the message before writing the seen marker. If that write fails, redelivery may call the consumer again; whether a duplicate is suppressed depends on the consumer's own idempotency. No cross-record transaction spans message, ratchet and replay state.
3. **CP4:** If receiver acceptance succeeds but the relay's sender response or later `received` report is lost, the same envelope may be delivered/replayed. Server dedupe limits mailbox copies; the separate peer ACK semantics remain weaker than a session-authenticated receipt.
4. **CP5:** TypeScript encrypts (advancing the session) before writing the outbox. If that write fails, the plaintext send has no durable retry record. Android send persistence needs independent fault characterization; do not infer parity.
5. **CP6:** A persisted outbox entry is retried after submission failure/restart. This is the intended safe case and must stay covered.
6. Seen-set capacity is 1,024. Retry lifetimes beyond that window are not guaranteed deduplicated by this client record.
7. TypeScript envelope identity currently hashes `JSON.stringify(envelope)`. Cross-language key ordering/escaping can make that digest non-canonical.
8. Current `Transport` includes relay-specific join capability/proof fields; `DefaultTransportManager` wraps one transport. There is no multipath coordinator.
9. Current trust freshness blocks when configured evidence is absent/stale. An offline LAN route does not justify relaxing it.
10. The current TypeScript inbound parser recognizes the existing join-introduction binary magic. Other malformed binary payloads fail strict UTF-8 decoding, but an unknown **printable UTF-8** control candidate is delivered as ordinary chat text. Future control namespaces need explicit framing and capability gating before they are enabled. Android rejects unknown frame version/channel bytes.
