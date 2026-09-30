# Capability negotiation test plan v1

Status: specification only. No capability wire format, protocol migration, or production behavior is introduced by this plan. The future wire format and authentication boundary require the unresolved decisions in ADR 0008 to be approved first.

## Invariants under test

1. A capability claim is not identity, trust, authorization, delivery evidence, or path health.
2. The current authorized relay path and ACK meanings remain the compatibility baseline.
3. Optional negotiation failure cannot change contact verification, identity records, ratchet/session state, message acceptance, or relay authorization.
4. A control frame is sent only when the exact relevant capability and version are supported by both peers, selected in a fresh authenticated transcript, and allowed by local policy.
5. Voice-call/WebRTC support does not imply a WebRTC data-channel carrier.
6. Current relay feature-list behavior is characterized separately from any future authenticated negotiation.

## Current implementation characterization

| Case | Input | Expected current behavior to preserve/document |
|---|---|---|
| C0-1 | `chat-join` omits `protocolFeatures` | Relay treats it as an empty feature set; client recognizes no peer optional features. |
| C0-2 | Client advertises the currently allowlisted `join-introduction-v1` | Relay associates the transient list with the socket and returns/forwards it as peer metadata. This is not end-to-end authentication. |
| C0-3 | Client advertises an unknown, duplicated, malformed, or oversized ID/list | Current relay rejects the join. This compatibility constraint must be considered before adding IDs. |
| C0-4 | Peer metadata absent, malformed, or contains unknown IDs | Current client recognizes no optional feature; disconnect/conversation change clears the in-memory set. |
| C0-5 | Device authorization proof succeeds | It authenticates the device/socket binding under existing relay checks; it does not sign or bind the `protocolFeatures` list. |

These characterization cases must not be “fixed” as part of Phase 1I. A future wire rollout needs its own approved plan and mixed-version tests.

## Future negotiation cases

| ID | Scenario | Required result |
|---|---|---|
N1 | Peer offer absent (old client) | Select no optional capability; keep authorized relay baseline. Send no receipt/control, LAN, or direct-path-specific control to that peer. |
N2 | Local optional feature flag disabled | Do not advertise/select/use the optional feature; normal relay behavior and ACK interpretation remain unchanged. |
N3 | Capability present in only one offer | No selection. Do not treat omission as implicit support or silently infer another version. |
N4 | Unknown capability identifier | Reject the optional negotiation under fail-closed parsing; retain only the already-authorized relay baseline. Do not fail identity/session state. |
N5 | Malformed document, unsupported document version, duplicate/conflicting entries, invalid version, or bounds exceeded | Invalidate optional negotiation; no state mutation outside optional negotiation; use relay baseline. Reject a specifically required operation if that future operation declares the capability mandatory. |
N6 | Complete authenticated offers contain multiple common versions | Select the highest mutually supported version only if the exact selection is bound in the fresh authenticated transcript. |
N7 | Relay strips or alters one offer or the selection | Transcript authentication fails; disable optional capability and fall back to relay. Never accept a weaker selection omitted from the authenticated offer. |
N8 | Authenticated peer falsely claims it implements a capability | Safe protocol failure disables the optional feature; no trust, verification, crypto, delivery-completion, or authorization change. |
N9 | Old/replayed transcript or selection | Reject as stale/replayed; no optional capability is active. Current relay baseline is unaffected. |
N10 | Reconnect, conversation/session replacement, revocation, identity change, or trust-freshness failure | Invalidate cached selection; renegotiate before optional use. |
N11 | Relay server does not recognize a newly advertised ID | Verify rollout-specific expected behavior for old/new client × old/new relay. Do not deploy a client-only ID addition that causes current strict relay join rejection. |
N12 | Relay capability differs from peer capability | Keep service capabilities separately authenticated/identified; peer claim never changes relay room, mailbox, or proof authorization. |
N13 | `transport-control-v1` selected but receipt subtype absent | Do not send receipt frames; a generic control capability does not imply every control subtype. |
N14 | Receipt subtype selected but message not durably accepted | No receipt is emitted; negotiation never substitutes for ADR 0002 acceptance. |
N15 | LAN capability claimed but local opt-in/admission/verification/freshness gate fails | Do not select/use LAN; discovery hints remain untrusted; relay baseline remains available. |
N16 | Direct-data-channel capability claimed but no implemented data-channel adapter or ICE path health | Do not select/use direct delivery. Voice call support alone is insufficient. |
N17 | Capability offer contains addresses, candidates, keys, names, or unbounded device inventory | Reject fields outside the approved minimal schema; do not log values; verify privacy review before any future advertising. |

## Mixed-version rollout matrix

Test each row against the explicitly approved server-first or versioned-envelope rollout before registering new wire IDs:

| Client | Relay | Peer | Expected property |
|---|---|---|---|
| Current | Current | Current | Existing join, introduction, relay messaging, and ACK behavior unchanged. |
| Current | Updated | Current | Omitted/legacy feature data still behaves as today. |
| Updated | Updated | Current old peer | Old peer is relay-only; no unadvertised control/path frame is sent. |
| Current | Updated | Updated | Current client continues relay behavior; unknown peer features are not trusted or selected. |
| Updated | Current old relay | Updated | Compatibility must be demonstrated; if current strict allowlist rejects the new advertisement, rollout is blocked until a server-compatible negotiation envelope or server-first release is approved. |
| Updated | Updated | Updated, optional features disabled | Relay-only behavior, same ACK semantics and security state. |
| Updated | Updated | Updated, feature enabled | Only authenticated selected capability plus policy/health gates enable the specific optional operation. |

## Regression assertions

For every negative or downgrade case, assert unchanged:

- contact identity and explicit verification state;
- device authorization and relay/mailbox authorization decisions;
- Olm/Vodozemac session and ratchet state;
- encrypted envelope bytes, outbox records, and current relay ACK mapping;
- message persistence and acceptance behavior;
- call behavior unless a later, separately approved capability explicitly concerns calls.

Do not add runtime tests or modify production behavior until the exact encoding, binding mechanism, relay rollout, cache lifetime, and required/optional dependency rules are approved. Future tests need shared TypeScript/Kotlin vectors if the capability document is cross-platform, plus relay integration tests for old/new deployment combinations.
