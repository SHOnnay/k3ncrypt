# Phase 5 call security model

Status: architecture and threat model only. This document does not implement calls, signaling, WebRTC, permissions, TURN/STUN, or media processing.

Phase 3 identity, Vodozemac sessions, encrypted persistence, mailbox and transport security remain frozen. Phase 4 attachment, media-message, authorization, and verification boundaries also remain frozen. A call must be an authenticated extension of an existing modern conversation, never a replacement for its identity or verification model.

## Target architecture

```text
User action
    ↓
Call invitation in an authenticated modern conversation
    ↓
Authenticated, bounded signaling
    ↓
WebRTC offer/answer and ICE negotiation
    ↓
Authenticated peer connection / encrypted media transport
    ↓
Explicit microphone and/or camera tracks
```

The call invitation and negotiation transcript must be bound to the conversation, verified contact identity, call identifier, participant identities, and expiry. A relay may transport opaque signaling and media packets, but it must not become an authority for identity or call permission.

## Threat model

### Signaling attacks

An attacker may inject, reorder, replay, delay, truncate, substitute, or suppress offers, answers, ICE candidates, hang-ups, and capability messages. Signaling must authenticate the sender through the existing E2EE conversation, bind every message to one call and conversation, enforce freshness and state transitions, and fail closed on malformed, duplicated, stale, or cross-conversation messages. DoS and delay cannot be eliminated; they must not produce silent peer substitution or a false connected state.

### Relay and network attacks

Signaling relays, TURN servers, SFUs, proxies, and network observers may be malicious, compromised, or curious. They may drop, replay, correlate, or selectively forward traffic. WebRTC transport encryption protects media in transit between negotiated endpoints, but it does not make an SFU or media-terminating service blind to media. Relay-only operation can hide peer IP addresses from each other while exposing connectivity metadata to the relay. Credentials must be short-lived and scoped; no public unauthenticated relay or hardcoded TURN secret is acceptable.

### Metadata leakage

Even when content is protected, servers and network observers may learn that a call exists, participant routing identifiers, timing, duration, packet sizes, connection failures, approximate network addresses, relay choice, and availability. Product copy must not promise metadata anonymity. Minimize retention, avoid analytics and call-content logs, and make any operational telemetry aggregate and privacy-reviewed.

### Identity impersonation and call hijacking

A malicious peer may present a lookalike account, replay an old invitation, race a legitimate answer, steal a signaling route, or attempt to continue after an identity change. A call is permitted only for the expected conversation participant and current verified identity state. The call transcript must bind the authenticated conversation identity to the negotiated peer identity and call lifecycle. Identity changes, revoked sessions, verification loss, protocol mismatch, and unexpected fingerprints must block or require explicit re-verification; never auto-trust a replacement identity.

### Malicious peers and compromised endpoints

The remote participant can record, screenshot, replay what they hear or see, send abusive media, or intentionally exhaust resources. A compromised browser, extension, operating system, microphone, camera, or device can observe media after decryption; cryptography cannot repair an endpoint compromise. Validate bounds and state transitions, expose mute/stop controls, isolate device access, and document that remote recording cannot be technically prevented.

## Security boundaries

### What Vodozemac and the existing E2EE conversation protect

The existing modern session authenticates and encrypts the call invitation and negotiation messages as application data. It provides participant/session identity, replay and downgrade boundaries already defined by Phase 3, and protection against a relay reading or modifying the protected signaling payload undetected. It does not authenticate a human contact who has not been independently verified, hide traffic metadata, protect an unlocked endpoint, or encrypt media automatically.

### What WebRTC protects

WebRTC with DTLS-SRTP provides authenticated transport encryption for negotiated media packets between endpoints, subject to correct peer authentication and browser implementation. It helps protect media from passive network observers and ordinary transport relays. It does not by itself bind a peer to the verified K3ncrypt contact, prevent a malicious signaling service from substituting endpoints, protect media from an SFU/transcoder that terminates the connection, prevent endpoint recording, or provide group-call semantics.

### What signaling can see

An authenticated signaling service may need opaque routing identifiers, call state, bounded negotiation envelopes, timestamps, delivery status, and failure information. It must not see plaintext call content, media keys, private identity material, or unencrypted contact fingerprints. Its metadata retention, authorization, rate limits, and replay behavior require a separate review.

### What relay infrastructure can see

TURN/STUN infrastructure can observe connection attempts, relay allocation, network addresses as applicable, timing, volume, and availability. A TURN relay forwards encrypted packets and must not receive long-lived credentials. An SFU or other media intermediary sees whatever media it terminates; it cannot be described as end-to-end private without a separate media-layer design and review.

## Privacy and permission requirements

No call feature may add recording, background microphone capture, background camera capture, advertising, analytics, tracking, or unnecessary permissions. Microphone and camera access must be requested only after an explicit user action, with visible active-state indicators and immediate release on stop, hang-up, failure, navigation, or permission revocation.

Permission state machines:

```text
Microphone: idle → requested → active → released
Camera:     idle → requested → active → released
```

Invalid transitions, denied permissions, device removal, and browser suspension must fail closed and release tracks. Incoming-call notification or onboarding must not request either device. Camera access requires a separate explicit video action even during an audio call.

## Identity binding and verification

1. The user starts a call from an existing conversation addressed to a specific contact.
2. The invitation is encrypted and authenticated by that conversation and includes a fresh call ID, participant binding, protocol version, expiry, and transcript-binding material.
3. The callee accepts only if the conversation is active, the sender identity is the expected verified/current identity, and no identity-change review or revocation is pending.
4. Offer, answer, ICE, and terminal events are authenticated, scoped to that call ID, and bound to the negotiated peer identity. A mismatch, replay, stale event, or cross-conversation message aborts the call.
5. A changed identity removes trust and blocks calling until the user completes the existing explicit verification/recovery flow. No call action silently verifies or migrates an identity.

## Future implementation plan

### Signaling

Specify a versioned call-state protocol, bounded payloads, replay protection, expiry, authorization, glare resolution, cancellation, timeout, reconnect, and revocation behavior. Add negative tests before implementation for substitution, replay, stale events, downgrade, cross-conversation routing, and identity change.

### WebRTC

Define browser compatibility, peer authentication, DTLS fingerprint/transcript binding, track lifecycle, renegotiation, mute/hold, device changes, teardown, and failure handling. Validate that the chosen architecture does not mistake DTLS transport security for contact verification.

### TURN/STUN and NAT traversal

Choose STUN/TURN deployment, short-lived scoped credentials, relay-only privacy options, quotas, abuse controls, regional routing, IP exposure policy, and failure behavior. Measure connectivity without logging media or unnecessary identifiers.

### Call quality

Define user-visible quality states and bounded operational metrics (jitter, loss, reconnects) with no content capture or unnecessary tracking. Quality adaptation must not weaken authentication, encryption, or permission boundaries.

### Group calls

Treat groups as a separate design. Define participant authorization, membership changes, per-participant key/transport binding, join/leave races, revocation, resource limits, and metadata leakage. Do not generalize the one-to-one model by assumption.

## Preconditions for implementation

Before code, complete an independent protocol/security review, browser and permission test plan, relay deployment review, abuse/DoS model, identity-change acceptance criteria, and endpoint/privacy disclosures. Implementation must preserve Phase 3/4 defaults and boundaries and must not introduce a parallel identity or authentication system.
