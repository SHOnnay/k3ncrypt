# Transport Selection Policy v1

**Status:** specification only; production remains relay-only

**Scope:** policy inputs, ordering, fallback, and coordinator contract tests. No non-relay transport is implemented or enabled.

## 1. Purpose and boundary

The delivery coordinator may eventually choose among adapters that carry the same already-encrypted envelope. Selection is a delivery decision only. It does not create or identify a conversation, authorize a peer, establish trust, encrypt or decrypt data, accept a message, or prove persistence.

The conversation owner remains responsible for trust/session checks, encrypted outbox persistence, authenticated receive acceptance, receipts, and user-visible message state. The coordinator receives opaque ciphertext and may report only adapter submission results and errors. Relay authorization remains the existing relay adapter's responsibility.

Today, `DeliveryCoordinator` selects the encrypted message-capable relay adapter only. Passing fake LAN/direct adapters does not select or invoke them. This is the production policy until a separately reviewed implementation gate is satisfied.

## 2. Candidate model and gates

A future candidate is eligible only when every applicable gate below passes. Evaluate gates before ranking; ranking cannot override a failed gate.

1. **Local implementation:** the local build contains the exact adapter and protocol version. A peer claim cannot make an unimplemented adapter available.
2. **Local capability:** the adapter supports opaque encrypted message envelopes. Required protocol/control capabilities must be mutually supported and transcript-authenticated as specified by ADR 0008. Missing, unknown, stale, malformed, or unauthenticated optional capability data excludes that optional path and leaves relay fallback.
3. **Peer/session binding:** the candidate is bound to the current expected peer device and conversation. Session replacement, reconnect, peer identity change, revocation, or stale trust evidence invalidates it pending fresh checks.
4. **Trust and lifecycle:** every non-relay path requires explicit user enablement globally and for that contact, a verified unchanged contact, and all applicable lifecycle/freshness admission checks. Discovery or reachability is never trust. Existing relay behavior for unverified text conversations remains unchanged.
5. **Privacy policy:** enforce the user's privacy setting before discovery, address gathering, or adapter startup, not just at final selection. `relay-only` and `hide-network-address` prohibit LAN/direct setup and use relay only. If local privacy policy cannot be established, fail closed to relay without gathering non-relay addresses.
6. **Path health:** the adapter is currently healthy and available. A capability claim or prior success is not path health.

Relay is the compatibility baseline and remains eligible under existing authorization unless the existing relay path itself is unavailable. No peer-provided capability changes relay authorization.

## 3. Ranking and privacy preferences

After eligibility filtering, order candidates deterministically:

| Local preference | Order |
|---|---|
| `relay-only` or `hide-network-address` | Relay only; do not initialize optional paths |
| `prefer-nearby` | Healthy eligible LAN, then healthy eligible direct, then relay |
| `prefer-direct` | Healthy eligible direct, then healthy eligible LAN, then relay |
| unset / legacy client / invalid preference | Relay only |

The preference is local policy, never a peer instruction. Ranking changes neither trust nor delivery evidence. Optional path setup must be bounded and must not delay an available relay submission. The implementation must define a concrete timeout before enabling a path.

No path fan-out is allowed by default. One candidate is selected for an attempt. A separate, reviewed overlap mode may be considered only after stable envelope identity and receiver deduplication are implemented and proven cross-platform.

## 4. Failure and retry behavior

- A candidate known unavailable before submission is skipped; continue down the already-filtered ranking.
- A definite pre-acceptance submission failure may fall through to the next candidate with the exact same persisted encrypted envelope. It must never trigger re-encryption or session mutation.
- A timeout, disconnect after bytes may have been written, or any ambiguous result is **unknown outcome**, not rejection. The coordinator may retry the same envelope through the next permitted candidate only after the stable envelope identity/deduplication and authenticated receipt gates below are implemented. Until then, retain the outbox and use existing relay retry behavior.
- A successful adapter submission means only `submitted` for that attempt. It does not mean relay storage, receiver acceptance, or peer persistence (ADR 0006).
- Failed optional selection must preserve the pending outbox item and fall back to authorized relay when policy permits. If no candidate is eligible, keep the item pending; do not drop it or claim delivery.
- Recompute eligibility before every new attempt and invalidate cached selections on privacy preference, trust/lifecycle, capability transcript, peer identity, or path-health changes.

## 5. Duplicate-path prevention and implementation gates

Production fallback across multiple paths is blocked until all of these exist:

1. Stable conversation-scoped envelope identity and legacy migration per ADR 0001.
2. Receiver deduplication that runs before session decryption for copies arriving through different paths.
3. Authenticated, conversation/envelope/peer-bound receipts per ADR 0007; relay events remain relay observations only.
4. Crash-consistent acceptance and restart/replay tests per ADR 0002.
5. Mixed-version capability negotiation and downgrade tests per ADR 0008.

The coordinator must serialize attempts for one logical conversation owner. It must not submit the same envelope concurrently over multiple paths by default. If a future timeout fallback can overlap with an in-flight attempt, receiver deduplication must collapse the duplicate and receipts must be idempotent. The coordinator must retain separate per-attempt transport IDs; these are not envelope IDs or authenticated receipts.

## 6. Future candidate rules

### Relay

Current and default path. Preserve authorization arguments, mailbox behavior, retry timing, outbox ownership, and ACK meaning exactly. Old clients and absent optional capabilities remain relay-only.

### LAN

Future candidate only. Require explicit global and per-contact opt-in, verified unchanged identity, fresh admission, authenticated peer binding, privacy permission before discovery, supported authenticated capability negotiation, and healthy path. LAN discovery is only an untrusted endpoint hint. If any check is unavailable or fails, skip LAN and continue to relay. Do not persist discovered addresses as identity data.

### Direct internet

Future candidate only. Existing voice WebRTC support is not a data transport. Require a separately implemented encrypted-envelope carrier, authenticated rendezvous, explicit eligibility and opt-in, and privacy permission before ICE/address gathering. If direct setup fails or is disallowed, use relay without changing session or trust state. TURN is a connectivity aid, not E2EE or peer-persistence evidence.

## 7. Coordinator test contract

Tests for the current coordinator must prove relay-only production behavior, including that fake LAN/direct adapters are never invoked, missing relay fails closed, and existing retry/error semantics remain unchanged.

Future-policy contract tests may use fake adapters to exercise candidate ordering, unavailable/capability-incompatible candidates, privacy exclusion, and definite-failure fallback. They are specification tests only; they must not be presented as evidence that a non-relay adapter is wired, enabled, or production-ready. Fallback tests must assert reuse of the exact same envelope object/bytes and must not assert stronger delivery evidence than `submitted`.

## 8. Unresolved decisions

- Concrete preference UI and whether per-contact preference can override global policy.
- Exact health signal, path setup timeout, cancellation, and failure taxonomy distinguishing definite failure from ambiguous outcome.
- Capability transcript format, versioning and rollout order with older relays/clients (ADR 0008).
- Receipt wire format, key/signature binding, retention, and sender-observable state (ADR 0007).
- Stable envelope identity rollout and legacy retention window (ADR 0001).
- Whether a user may explicitly choose temporary relay fallback when privacy mode forbids optional paths; relay-only remains the safe default.
