# Pre-Mux Gate 3: Encrypted Event Binding

Status: Gate 3 correction implementation and validation in progress on `security/mux-encrypted-event-binding`.

This gate hardens event ownership before any shared device connection exists. A future transport must enforce:

```text
outer mux room == authorized proof room == immutable RoomChannel room == authenticated event room
```

Any mismatch must fail closed before durable application acceptance. Socket state, the selected UI room, and relay routing are not cryptographic ownership.

## Event inventory

| Event class | Protection and bindings | One-room transport / future mux | Action |
| --- | --- | --- | --- |
| Text/application message | Olm/Vodozemac-authenticated plaintext is decoded as `ROOM_MESSAGE_V1`, which binds room UUID, sender and recipient pinned identity references, event UUID, and kind. The persisted version floor prevents downgrade after V1 is established. | V1 is mux-safe after the channel independently checks the same room. Legacy Olm messages have no authenticated room field and remain one-room-transport-only. | Keep V1 mandatory after the floor; mux must reject legacy room messages. |
| File reference | Encrypted reference is an `attachment-reference` application message and inherits the V1 room/identity/event binding. Attachment AES-GCM AAD separately binds transfer ID, conversation, participants, pinned identities, sizes, and chunk/index context. | V1 reference and authenticated attachment context are mux-safe; legacy reference transport is one-room-only. No alternate reference/control bypass was found. | No attachment crypto change. |
| Profile/display metadata | Profile metadata uses the ordinary application-message path and therefore V1 when supported/required. Its claim fingerprint is compared with the pinned identity; display name/avatar remain presentation data. | Mux-safe only inside the V1 wrapper and authenticated room channel. Profile content is never verification, repinning, or trust authority. | No change. |
| Join/introduction | Canonical Ed25519 signature covers event ID, conversation ID, sender address, identity commitment, and creation time. Where negotiated or required, the enclosing V1 event is kind `join-introduction`. Receiver checks room, sender route, signature, commitment/fingerprint, and per-room replay state. | The signed conversation ID prevents a valid signed object from being transplanted into another room even on legacy transport; V1 adds outer event binding. A mux still must verify the immutable channel room. Exact replay is idempotent; another event ID for the same room is rejected. No explicit maximum-age check was found. | Keep admission and explicit trust unchanged; do not treat transport as trust. Freshness policy remains a product/security follow-up. |
| Session / key renewal | There is no separate encrypted renewal event. Renewal bookkeeping is local and room-keyed. New sessions are established by the ordinary encrypted message path. Public prekey publish/fetch/claim/renewal REST operations are control-plane APIs, not encrypted peer events; Olm authenticates the first-prekey message. | Inbound session creation is room-specific and transactional. Public prekey metadata is not a room message. Control capability and REST routing do not replace event authentication. | No alternate first-event class found. Preserve room-keyed session state and transactional acceptance. |
| WebRTC call signaling | Version 2 call signal digest is domain-separated and authenticates conversation ID, call ID, sender participant/identity, receiver identity, event/kind/payload, media mode, nonce, sequence, timestamp, expiry, and identity binding. It is then carried through an authenticated signaling crypto channel. Admission checks room membership, local explicit verification, pinned identity, and signal semantics. | Authenticated room and participant context make the signal itself mux-safe when the mux room is checked against the immutable call channel. UI room changes do not choose the active call context. | Keep call wire binding. Replay key now includes conversation ID to prevent cross-room namespace collision. |
| Call control | Invite/accept/reject/cancel/end/expire/fail use the same v2 call envelope and control-kind semantics as signaling. | Same as call signaling. Calls still have no durable invitation mailbox/replay path; this is a separate future-delivery requirement. | No signaling redesign or durable-call feature in this gate. |
| Receipts / ACK | No encrypted peer receipt class exists. Backend relay ACKs and mailbox operations are transport outcomes over opaque envelopes, routed by authenticated channel/device proof and relay mailbox identity; they are not encrypted peer events. | Relay ACKs are not room content or app-delivery receipts. A future peer Delivered/Read/typing/call invitation must include authenticated room and event/call identity and be accepted only on the matching immutable channel. | No new receipts, read state, typing, notifications, or call mailbox. |
| Device-control / system | Device lifecycle messages were encrypted in the signaling channel but their v1 packet carried only type/payload and depended on ambient room/session state. New v2 packet adds conversation UUID, sender/recipient pinned identity references, unique event UUID, version, and message. Parser checks exact keys and inverse local/remote context. | V1 is allowed only while the exact room+remote-pin message floor is 0 and local transport policy does not require binding. A persisted message floor ≥1 or strict local transport policy requires v2 on send and receive. Floor is reread per operation, so relay feature stripping, peer offline, reconnect, and refresh cannot lower it. Changed/missing contact pins reject old channels. | Require room-bound v2 using the captured room and pinned remote identity; do not change verification authority. |
| Account/device sync | Authenticated sync binds package scope, account/device ID, pinned identities, checkpoint/stream, and message ID. It is account-scoped rather than conversation-scoped. | It must remain on a distinct account-scoped lane and must not be remapped to a room event by a future mux. | No change. |
| Private-network packet | Separate authenticated packet binds network ID, session ID, sender/receiver device IDs and identities, message ID, and expiry. | Separate private-network lane; not a room message. | No change. |
| Future reserved events | No other encrypted peer event class was found. | Future room-scoped event kinds must have authenticated room, participant/context, event/call identity, and domain/type before mux delivery. | Add a reviewed event kind/version and downgrade rule before use. |

## Protocol separation and first event

Vodozemac message and signaling channels have separate envelope channel framing. `ROOM_MESSAGE_V1` has its own domain/version/kind, fixed room/identity fields, and parser dispatch. Call v2 has its own digest domain/version and call parser. Device control has distinct v1/v2 prefixes. Sync and private-network packets use separate protocol prefixes. Parser dispatch and authenticated context must reject cross-class reinterpretation.

Only the application `message` path can initiate an inbound Olm session: text, profile metadata, file references, and introductions share the same first-prekey receive flow. Calls and device-control messages require an established session. A room-bound first message is checked before account/session/application records or ACK can commit. Account, room session, replay state, and receiver acceptance are committed in one CAS. If another room wins the device-wide account CAS, the loser retries from a newly loaded durable account only when every room-specific acceptance/session record still matches its expected value. Changed room state, ambiguous writes, and exhausted retries fail closed.

## Compatibility and mux requirements

- Legacy one-room messages and device-control v1 continue only on transports whose local policy does not require room binding.
- A persisted V1 message floor cannot be lowered by relay feature claims or selected-room changes.
- For a relationship with `minimumWrapperVersion >= 1`, local policy also requires room-bound device-control v2. This is deliberately one-way: V1 floor implies a stricter control requirement, but accepting/sending device-control v2 does not raise or establish the application-message floor. The two versions describe different wire classes. Older peers that only understand control v1 may lose control functionality on a V1-latched room; the client fails closed instead of downgrading.
- If Stage 1 later needs independent control-version negotiation/latching, introduce a separately versioned `minimumControlVersion` keyed by room and exact pinned remote identity, and raise it only from authenticated control-version evidence. Do not encode control support by changing `minimumWrapperVersion`.
- Room-bound device-control v2 is required when the local transport policy requires room binding; v1 is rejected in that mode.
- Call v2 is independently room authenticated; it is not redundantly wrapped in `ROOM_MESSAGE_V1`.
- Any event that lacks authenticated room ownership stays off a future shared connection.
- This gate adds no mux socket, subscriptions, background unread, notifications, presence, typing, Android mux, or durable call invitations.

## Stage 1 entry requirements

Stage 1 mux work must not begin until its design and tests address each item below. These are prerequisites, not implemented by Gate 3:

1. Authenticate the current pinned contact identity at control and call send/receive. A changed or unresolved pin must fence an existing channel; no automatic repinning.
2. Define and enforce a signed introduction freshness/admission window, including clock-skew policy and replay behavior.
3. Add device-level first-prekey scheduling with bounded contention/liveness, while retaining fresh-account revalidation and transactional room acceptance.
4. Remove ambient `joinedConversationId` / `desiredConversation` attribution from mux paths; handlers must use immutable authorized room contexts.
5. Review permanent versus retryable rejection classification. Undecryptable ciphertext and apparent old duplicates remain retryable absent authenticated durable acceptance/irreversible-invalid evidence; unsupported wrapper versions fail closed without tombstoning potentially recoverable legitimate messages absent an explicit upgrade policy.
6. Define a versioned replay-store schema and crash-safe migration/rollback strategy before compaction or retention changes.
7. Specify room-scoped authenticated subscription proofs, replay protection, renewal, and revocation, including stale proof fencing.
8. Check outer mux room, subscription-proof room, immutable channel room, then decrypt and check authenticated inner room. Inner content cannot be authenticated before decryption; outer/proof/channel checks must happen first.

Stage 2 remains separate: durable call invitations, persistent call replay, typing, presence, and notifications are out of scope.

## Inbound rejection classification

- An exact ciphertext digest or authenticated V1 event ID/commitment already persisted by the atomic acceptance transaction is durable evidence of prior acceptance; that exact replay is idempotently accepted. A decrypt failure or a merely apparent duplicate without such a matching record stays retryable.
- Malformed/unauthenticated Olm ciphertext stays retryable because sender authenticity and message validity have not been established.
- An authenticated future wrapper version or unsupported future kind stays retryable and creates no durable acceptance/tombstone, allowing a later software upgrade to process it.
- A legacy frame rejected by an already persisted V1 floor is terminally classified as `unsupported-message` under the existing explicit downgrade policy. It is not treated as an unknown future wrapper; the floor itself is authenticated durable policy evidence.
- Authenticated event-ID reuse with a different content commitment and authenticated structural/content violations are terminal invalid events. This gate does not redesign mailbox retention or retry lifetime.

## Replay storage observations

The current vault has three message-related seen records: `modern-seen` stores 64-hex hashes in a ring capped at 1,024; `modern-seen-m1-v1` stores `v1:` plus 64-hex envelope IDs without a cap; `modern-seen-room-message-v1` stores `{id, commitment}` pairs, both `v1:` plus 64-hex values, without a cap. The first two can overlap for M1 ciphertext; authenticated V1 event ID/commitment adds anti-equivocation information. `conversation-join-introduction-seen` stores one event ID per room. At 1,000 accepted V1 events, the two unbounded V1-related JSON records are roughly 220 KB combined; at 10,000, roughly 2.2 MB, before vault/database overhead. Legacy ring storage is bounded at about 70 KB at its cap. Lookup is linear for array-backed records (O(n)); no retention or compaction change is made here.

The relay offline mailbox TTL is seven days, but sender outbox retry lifetime has no proven upper bound. Therefore mailbox TTL alone cannot justify pruning authenticated replay IDs: an old sender retry could arrive after local pruning. Define a product-approved maximum sender retry lifetime and coordinate it with mailbox retention before bounding these records.

## Security regression coverage added in this gate

- Call replay keys include conversation ID, call ID, sender participant, and sequence; identical call IDs/sequences in different rooms occupy independent replay slots.
- Device-control v2 carries and validates room plus sender/recipient pinned identities; persisted message floor and strict local transport policy require v2 on send/receive; reconnect, missing relay features, changed pins, and cross-room delivery do not downgrade or authorize a stale channel. Old v1 lifecycle, revocation, and trust packets reject before application dispatch on a latched room.
- Future authenticated message-wrapper versions remain retryable without durable acceptance; undecryptable ciphertext remains retryable, while an exact previously accepted envelope is idempotent only with its persisted acceptance marker.
- Concurrent first-prekey regression races Bob→Alice and Carol→Alice against one device account CAS; the loser reloads the durable account, repeats decryption/validation, and both room-specific acceptance transactions complete before their callers observe success.
