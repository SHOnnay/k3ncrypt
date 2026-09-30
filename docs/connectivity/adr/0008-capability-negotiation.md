# ADR 0008: Capability negotiation

Status: Capability model and downgrade requirements specified in Phase 1I. No protocol/wire migration or runtime behavior change is authorized by this ADR.

## Context and current implementation audit

The current feature negotiation is a small Socket.IO relay-join hint, not a general protocol/version negotiation:

- `SocketIoRelayTransport` supports only the exact feature ID `join-introduction-v1`. `ModernConversation.installModernCallSupport()` advertises it through `setProtocolFeatures()` without a connectivity flag. `peerSupportsFeature()` is exact membership in an in-memory set and gates the join-introduction send path.
- The client places its optional `protocolFeatures` list in `chat-join`. The relay allowlist accepts only `join-introduction-v1`; absence maps to an empty list, while malformed, duplicated, oversized, or unknown IDs reject the whole join request. The relay stores the list transiently on that socket and returns the peer's list in the join acknowledgement; it forwards the joining socket's list in `on-alice-join` to the other participant.
- Client feature parsing is also exact allowlist membership. An absent or malformed/unknown peer list results in no recognized features; peer features are cleared on disconnect and conversation change. These are session-scoped caches, not persistent device capabilities.
- The device authorization proof authenticates/binds a socket to device/account/trust-epoch state. The `protocolFeatures` list is not included in the signed proof or its resource context. The feature claim itself is therefore not cryptographically bound to the device identity, conversation transcript, connection nonce, or selected feature set. A relay forwarding it does not turn it into an end-to-end authenticated claim. A current socket unit test calls it “authenticated presence metadata”; that label overstates what is authenticated: presence is relay-associated, while the feature list is peer-asserted metadata.
- No protocol-version range or selected protocol version is negotiated. Feature IDs happen to contain `v1`; this is exact ID matching, not general version negotiation. Persistent device lifecycle records do not store protocol features. Android's current device metadata likewise does not supply this Socket.IO feature list.
- The backend's generic envelope validator accepts outer envelope integer versions 1–16; the current Vodozemac conversation validators require their exact envelope version/strategy. Those envelope-format checks are independent from feature negotiation and must not be treated as negotiated capability.

Consequently, current `join-introduction-v1` presence is useful for compatibility gating among cooperating clients but is not proof that a peer really implements the feature. A malicious or buggy authenticated peer can overclaim; a relay can alter, suppress, replay, or misassociate the transient list. The claim must never authorize identity, trust, relay operations, receipt validity, or a network route.

## Decision: capability model

Treat capabilities as declarations of implementation support, separate from authorization, trust, policy, and current path availability. A future negotiation has five distinct inputs/results:

1. **Local implementation support:** exact capabilities and versions the local binary implements.
2. **Peer offer:** a bounded, untrusted claim for one authenticated peer device and conversation.
3. **Authenticated negotiation transcript:** the offer, fresh connection context, and selected intersection bound to the existing authenticated conversation session (or another separately reviewed transcript-bound mechanism). It prevents a relay from silently stripping or rewriting negotiated values.
4. **Local policy/eligibility:** user/feature flags, explicit verified-contact requirement where the path policy requires it, trust freshness, platform permissions, and privacy choices. A negotiated capability cannot override these gates.
5. **Runtime path health:** whether an eligible adapter is presently usable. Capability support does not prove that a path can connect.

Capability records must be scoped to a conversation and expected peer device, short-lived, and refreshed after reconnect/session replacement or identity/trust lifecycle changes. Do not persist them as contact identity, fingerprint, device trust, or account profile data. Do not include IP addresses, discovery candidates, keys, or display names.

### Capability classes

| Class | Future model | Non-claim |
|---|---|---|
| Relay envelope | Existing authorized relay envelope delivery is the mandatory compatibility baseline. Relay protocol/server capabilities, if needed, are advertised by the relay under a separate server identity and are never inferred from the peer's feature list. | A peer capability claim does not authorize relay room membership, a mailbox operation, or bypass current device proof checks. |
| Authenticated receipt/control | A versioned control capability (HANDOFF `transport-control-v1`) is required before sending any receipt/control frame. A narrower receipt feature/version may be negotiated beneath it. Both peers must support the exact control format and the feature must be enabled. | Control support is not proof of peer persistence, identity verification, or receipt authenticity. Those are established only by validating the authenticated receipt at the defined boundary. |
| LAN path | A future LAN-adapter capability may declare supported adapter/protocol versions. Discovery and address hints remain separate, untrusted inputs. Selection also requires the approved admission, verified-contact, freshness, privacy, and user-policy gates. | Discovery, a capability claim, or LAN reachability is not authentication or trust. No LAN capability is enabled here. |
| WebRTC/direct path | A future direct-data-channel capability may declare support for an exact encrypted-envelope carrier/version. Connectivity, ICE success, permissions, and path health are measured separately. | Existing voice-call/WebRTC support is not evidence that a WebRTC data-channel transport exists or that direct connectivity will succeed. No direct path is enabled here. |

Provisional names such as `receipt-v1`, `lan-envelope-v1`, and `direct-datachannel-v1` are design labels only, not registered wire IDs. Only `transport-control-v1` is already named by HANDOFF M3, and the current runtime does not advertise it.

## Negotiation and downgrade requirements

- Compute selection as the intersection of local implemented support and the peer's authenticated offer, then apply local policy and actual path health. The peer never selects a capability unilaterally.
- Where a capability has multiple compatible versions, select the highest mutually supported version only when both sides' complete offers and the selection are authenticated in the same fresh transcript. Do not silently fall back because a relay or unauthenticated intermediary removed a newer offer.
- The mandatory relay baseline remains available under existing authorization if an optional feature is missing, unsupported, disabled, stale, or cannot be authenticated. Optional negotiation failure disables that optional feature; it does not silently weaken trust, crypto, identity, or delivery guarantees.
- Old clients that omit the optional feature list are treated as relay-baseline-only. Never send receipt/control or path-specific data they did not explicitly negotiate. Existing message/call behavior remains unchanged.
- Unknown capability IDs are rejected from the negotiation and never selected. A malformed capability document, unsupported document version, duplicate/conflicting entry, invalid binding, or transcript mismatch invalidates the optional negotiation and falls back to the authorized relay baseline. This is a fail-closed rejection of optional negotiation, not acceptance of an unknown feature. If a future operation marks a capability mandatory, inability to negotiate it rejects that operation, not the user's identity or trust state.
- A lower version may be selected only if it was explicitly present in both authenticated offers and the fresh transcript confirms that exact selection. A locally supported old version is not a justification for accepting a stripped offer.
- Capability claims cannot authorize another device, create a contact, verify a fingerprint, authorize relay access, accept an envelope, or establish a receipt. A malicious authenticated peer may still lie about implementation support; treat protocol errors as optional-feature failure, fail closed before mutating session/trust state, and preserve relay fallback.
- Rate-limit parsing, bound document size/count/IDs/versions, reject duplicate identifiers, and log only bounded reason codes. Do not log capability documents if they contain connection context or path data.

## Current mixed-version deployment constraint

The current server rejects a join if `protocolFeatures` contains an unknown ID; the current client maps an unknown peer ID to no supported features. Thus a future client that simply adds an ID to its list can fail to join an older relay. Before adding any identifier, define a server-first compatible rollout or an explicitly versioned negotiation envelope and verify both old-client/new-server and new-client/old-server behavior. This ADR does not select or introduce that wire migration.

## Security and compatibility consequences

- Capabilities are hints until transcript-authenticated; even after authentication, they prove only that the authenticated peer claimed support.
- Transcript binding makes relay stripping/modification detectable; without it, an attacker may force fallback (availability loss) or induce incompatible control traffic. Fallback must not become trust or crypto downgrade.
- Distinguish the peer device's claims from relay service support. Never allow peer-provided relay capability data to change relay authorization.
- Keep capability negotiation ephemeral and tied to current identity/session/trust freshness. Revocation, identity mismatch, reconnect, or session replacement invalidates the selection until it is refreshed.
- No persisted schema or existing envelope changes are defined. Older clients retain relay-only behavior; unknown control frames remain subject to strict HANDOFF M3 parsing rules.

## Unresolved decisions

1. Exact bounded capability-document encoding, canonicalization, list limits, and whether offers are sets of exact versions or version ranges.
2. Exact authentication point: existing Olm conversation session versus a separately reviewed authenticated admission transcript for a future path. Bind both offers and the selected result without changing current identity or cryptographic primitives.
3. Relay-server capability discovery and rollout order for the current server's strict unknown-ID rejection.
4. Required-versus-optional semantics, dependency rules (for example control base versus receipt subtype), and behavior when a required optional capability is unavailable.
5. Capability lifetime/cache invalidation, reconnect races, multiple peer devices, platform/browser support reporting, and storage-pressure behavior.
6. Whether local user opt-in is required before advertising privacy-sensitive optional capabilities, and how capability changes are reflected without exposing network addresses.
7. Exact provisional IDs and selected versions for receipts, LAN envelope carrying, and direct data-channel carrying. No ID or version is registered by Phase 1I.

## Required validation

See `../capability-test-plan-v1.md` and `../test-matrix.md`. Test old/new clients and relays in both rollout directions, authenticated highest-common-version selection, omission/unknown/malformed/duplicate claims, relay stripping, malicious overclaim, stale/replayed negotiation, identity/session change invalidation, and proof that optional negotiation failure preserves relay behavior without changing trust, identity, or cryptographic session state.
