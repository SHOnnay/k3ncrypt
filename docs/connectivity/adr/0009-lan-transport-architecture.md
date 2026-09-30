# ADR 0009: LAN transport architecture

**Status:** Architecture direction selected for further validation; production LAN remains **NO-GO**. This ADR does not close HANDOFF decisions D13 (final live carrier), D14 (advertising default), or M6 (offline trust freshness) on the evidence available today.

## Context

The isolated spike exchanged dummy TCP frames and observed a same-host multicast beacon. Its Android probe used an emulator and a manually supplied desktop address. It did not test Android NSD, a WebRTC data channel, real-device Wi-Fi, cold start without internet, browser discovery, or authenticated admission. See [spike-report.md](../spike-report.md). The existing production Delivery Coordinator remains relay-only.

The handoff requires a verified, unchanged contact, current device/freshness eligibility, mutually authenticated PeerAdmission, and a transport-bound connection before any non-relay envelope. Discovery cannot supply identity or trust. The relay mailbox remains essential for offline recipients.

## Decision

Use a **hybrid discovery/carrier architecture**, with separate platform discovery and opaque-envelope carrier interfaces:

1. For the first planned Android-to-Android LAN experiment, use Android NSD/DNS-SD (mDNS) only to discover an ephemeral, untrusted local rendezvous endpoint. Advertising remains off by default and foreground-scoped pending D14. Do not put names, stable device IDs, fingerprints, invitation data, or contact inventory in service names/TXT records.
2. Prefer a WebRTC DataChannel as the **candidate** common live carrier for Android, browser, and future desktop. On a local path, first test host-only ICE and a local offer/answer exchange that works from a cold start with no internet. The discovered endpoint carries only bounded, untrusted rendezvous bytes until a reviewed PeerAdmission binds the expected devices, conversation, fresh transcript, and both DTLS certificate fingerprints. No encrypted envelope is accepted before admission. Existing voice WebRTC is not evidence that this data carrier is implemented.
3. Keep TCP as a **spike-tested alternative**, not an authorized production envelope carrier. Plain TCP has no channel binding on its own. A future TCP design needs a separately reviewed authenticated channel and binding that satisfies PeerAdmission M5, plus real-device measurements, before it can replace the DataChannel candidate. Do not treat a signed endpoint hint or TCP connect as sufficient.
4. Ordinary Web clients get no promised offline LAN discovery in this phase. Browser DataChannel support does not grant raw NSD discovery or an incoming TCP listener. Browser rendezvous may use the existing authenticated relay when available; offline browser rendezvous needs separate evidence and design. A future desktop wrapper may provide native NSD, but is not in scope now.
5. Regardless of carrier, the Conversation Owner retains trust, Olm session, encrypted outbox, inbound acceptance, dedupe, and receipt authority. One coordinator attempt uses one selected path. Adapter write proves only `submitted`; it never proves peer persistence. Relay remains the default and fallback under existing authorization.

This selects module boundaries and an evaluation order, **not** a production carrier approval. D13 stays open until the DataChannel and reviewed TCP alternative are compared on real hardware, including offline cold start. If DataChannel fails those tests, revisit this ADR; do not silently ship plain TCP.

## Why this direction

Android NSD is a native fit for same-network discovery, while WebRTC DataChannel offers a browser API and a DTLS association that the existing PeerAdmission specification can bind. Reusing the DataChannel carrier for a future internet-direct candidate avoids making Android LAN's socket protocol the required browser protocol. The price is a larger Android/WebRTC integration and harder offline rendezvous/ICE testing. A pure NSD+TCP solution is simpler for native devices but needs a new reviewed channel-binding design and cannot serve ordinary browsers directly. A pure DataChannel solution does not solve local discovery or offline signaling by itself.

## Consequences and gates

- No new production path, protocol, dependency, permission, UI, or default setting is authorized here.
- M5 transcript/fixtures need security approval. In particular, the local rendezvous must not become a route-substitution or downgrade authority.
- M6 must be decided by the owner; unavailable required freshness blocks LAN. Do not infer absence of remote revocation from a signature or cached record.
- Phase 1 multipath gates (stable envelope ID, atomic/recoverable acceptance, authenticated receipts, capability negotiation and mixed-version tests) must pass before LAN-to-relay fallback after an ambiguous send.
- Discovery/ICE begins only after privacy preference and verified-contact eligibility checks. `relay-only` and `hide-network-address` must not gather optional candidates.
- Real Android devices must prove cold-start offline discovery, channel establishment, restart, background/Doze behavior, Wi-Fi isolation, and teardown. The spike's emulator numbers are not a performance target.
- IP addresses and local-network presence can be exposed to peers or observers. Limit advertising and candidate sharing, do not log addresses, and do not claim anonymity.

## Revisit when

Revisit D13 after the [LAN decision test plan](../lan-decision-test-plan.md) has real-device and browser results; revisit D14 after privacy, permission and battery evidence; revisit M6 through ADR 0005 and owner/security approval. A failure of host-only offline DataChannel setup, inability to bind admission to its DTLS channel, or unacceptable resource cost is a stop condition, not a reason to weaken the existing trust model.
