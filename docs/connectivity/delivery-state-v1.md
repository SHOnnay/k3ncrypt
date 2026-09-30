# Delivery evidence and receipt lifecycle

Status: specification. Current beta behavior is unchanged. The evidence model is defined in ADR 0006; Phase 1H receipt requirements are in ADR 0007. Evidence labels below are not UI copy and are not a promise that the current client can observe every state.

## Capability negotiation boundary (Phase 1I)

Capability negotiation describes possible protocol operations; it is not delivery evidence. A peer advertising receipt support does not prove that any envelope was submitted, stored, accepted, or persisted. A selected receipt capability only permits a separately specified receipt exchange; `peer-persisted` still requires successful validation of an authenticated, conversation- and envelope-bound receipt after durable acceptance (ADR 0002 and ADR 0007).

Likewise, advertised LAN or direct/WebRTC data-channel support does not mean that a path is reachable, selected, authorized, or healthy. Path eligibility still depends on local policy, current trust/freshness requirements, platform support, and the approved admission procedure. The relay remains the compatibility baseline; missing or unusable optional capabilities leave existing relay delivery and its current ACK meanings unchanged.

Current `join-introduction-v1` metadata is only a transient, exact-match compatibility hint. It is not a negotiated authenticated capability, delivery receipt, contact identity, or trust fact. The existing relay `delivered` event and mailbox storage response remain exactly as described below, regardless of any future peer capability claims.

## Lifecycle/evidence model

These are independent observations associated with an envelope and one or more attempts. They are not a guaranteed linear state machine: relay mailbox storage can happen without a live receiver, and live receiver acceptance can happen without mailbox storage. A timeout means unknown outcome, never rejection.

| Evidence | What it proves | What it does not prove | Sender observability today |
|---|---|---|---|
| `submitted` | A local encrypted outbox record exists and the selected adapter reports a successful submission attempt. Record adapter and attempt ID separately. | Relay persistence, recipient handling, decryption, peer persistence, or reading. | Local outbox and adapter result; timeout leaves result unknown. |
| `relay-stored` (also called mailbox-stored) | The authorized relay explicitly returned `stored:true` after inserting/reusing an opaque offline mailbox row. Preserve relay ID and expiry as relay metadata. | Recipient online, decryption, acceptance, durable peer storage, or indefinite retention. | Relay `chat-message` response with `stored:true`. |
| `receiver-accepted` | The receiver's application handler returned success for this attempt after its platform acceptance path completed. | End-to-end authenticated proof to the sender, human display/read, or future retention. | Immediate live `{id,timestamp}` response and/or later relay `delivered` event. Both are relay-mediated observations. |
| `peer-persisted` | The expected peer device produced a valid authenticated receipt after durable acceptance of that envelope at the receiver. | Human reading, every other peer device's state, or retention forever. | Not available in the current beta; future receipt requirements are specified by ADR 0007. |

Do not promote an observation based on its name. `submitted` cannot infer `relay-stored`; `relay-stored` cannot infer `receiver-accepted`; neither relay reports nor receiver handler callbacks can establish `peer-persisted`. Keep envelope identity, relay mailbox ID, and per-attempt ID in separate fields.

## Current beta mapping

`chat-message` live `{id,timestamp}` is a relay-mediated report that the recipient Socket.IO delivery callback returned `accepted:true`. `{id,timestamp,stored:true}` is the relay's report that it stored/reused a mailbox row. After the recipient handler succeeds, the client emits `received` with a relay ID; the server checks active socket/device binding, deletes a matching mailbox row when present, then forwards `delivered` to the sender. The sender currently uses that relay ID to remove matching outbox work.

These events do not qualify as authenticated peer receipts: they are relay-controlled, use relay IDs rather than the v1 envelope identity, and do not cryptographically bind the sender, receiver, conversation, envelope, and fresh receipt instance together. Active device binding is relay authorization, not end-to-end receipt authentication. Full event semantics are in `current-behavior.md`; do not rename or change them in this specification phase.

## Future authenticated receipt requirements

Only a separately approved, version-gated receipt meeting ADR 0007 may establish `peer-persisted`. It must authenticate the expected peer device through the conversation session, bind the canonical conversation and stable v1 envelope ID, bind sender/receiver device identities and roles, include freshness/replay protection, and be emitted after ADR 0002 durable acceptance. Receipt duplicates are idempotent; unknown/mismatched/expired receipts have no state effect. A sender needs a durable completion/correlation record that outlives current relay outbox cleanup for the defined receipt horizon.

Existing relay outbox and UI status behavior stays unchanged. No receipt frame, protocol change, or transport is enabled by this document.

## Identity, retry and retention constraints

ADR 0001 selects the v1 conversation-scoped digest over exact validated `olmMessage` bytes as a design; it is not yet used by beta runtime. All future paths must carry the exact same encrypted envelope after a single encryption. Retry must resend the saved ciphertext and keep the same envelope ID; adapter attempt and relay mailbox identifiers remain separate.

Existing Web `SHA-256(JSON.stringify(envelope))`, its 1,024-entry `modern-seen` limit, and Android's raw serialized-envelope digest remain the current platform-local behavior. The seven-day mailbox expiry does not by itself set a safe dedupe horizon; measure retry, offline, replay, and delayed-receipt lifetimes before choosing retention. Legacy records must remain readable during migration as specified in `envelope-identity-migration-v1.md`.

Multipath and `peer-persisted` remain blocked until stable ID parity/migration, receipt authentication, crash recovery, retention, replay, and mixed-version tests pass.
