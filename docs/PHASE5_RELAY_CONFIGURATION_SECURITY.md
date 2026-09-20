# Phase 5 relay configuration security

This document defines the deployment boundary for ICE, STUN, and TURN. No relay provider or credential is hardcoded in the client or repository.

## ICE configuration

The call transport accepts an injected, per-call ICE configuration. Configuration must be allowlisted by deployment, use `https:`/`turns:` endpoints where supported, and contain only short-lived, scoped TURN credentials. Never accept arbitrary ICE URLs from a remote peer or a call invitation. `iceTransportPolicy: relay` may be selected when hiding peer addresses is more important than direct-path latency; it does not hide metadata from the relay.

## TURN requirements

Production TURN requires ephemeral credentials, quotas, abuse/rate limits, health monitoring, regional capacity, and explicit expiry. Credentials must not be persisted in the vault, URLs, logs, signaling payloads, or analytics. TURN must forward encrypted WebRTC packets and must not terminate media unless a separately reviewed media architecture authorizes that visibility.

## Visibility and metadata

STUN/TURN operators can observe allocation requests, source/network addresses as applicable, timing, duration, volume, relay choice, connection failures, and availability. They cannot decrypt DTLS-SRTP media when acting only as a packet relay. Signaling and relay infrastructure can correlate call participants and timing; this is metadata leakage, not a claim of anonymity. Retention should be minimized and content, fingerprints, private keys, and media logs must be excluded.

## Failure and privacy policy

If relay configuration is missing, malformed, expired, or unauthorized, calls fail closed with a generic unavailable state. The client does not silently fall back to an unapproved public STUN provider. Relay-only mode is a privacy choice with connectivity and cost tradeoffs. A compromised endpoint, browser extension, remote recording, screenshots, and a media-terminating SFU remain outside the transport relay guarantee.

Before production enablement, review provider contracts, credential issuance, IP exposure, retention/deletion, abuse handling, regional routing, and browser interoperability. This boundary does not add group calls, recording, analytics, or background device access.
