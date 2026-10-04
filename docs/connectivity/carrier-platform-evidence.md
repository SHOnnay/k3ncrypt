# Carrier platform evidence and limits

Date consulted: 2026-10-05. Exact base a588d1bff66dd552fd71f20110ae358565a6bccc. Read-only source/API review, not execution on devices or browsers.

## Repository source evidence

| Source | Observation | Consequence |
|---|---|---|
| service/src/webrtc/peer.ts | New PC, ICE callbacks, immediate media acquisition, signaling sender, call-owned dispose | No direct reuse as data-only messaging owner |
| service/src/calls/media.ts and negotiation.ts | CallId maps, candidate callbacks, selected-pair/health diagnostics, media capture and automatic ICE restart | Lifecycle/config concepts reusable only after refactoring review; replacement cannot preserve LAN admission implicitly |
| service/src/calls/authenticatedTransport.ts / composition.ts | Existing encrypted conversation signaling with participant/context checks | Useful authenticated online carrier precedent; call frame parser is not new A1 bootstrap |
| backend/socket.io/listeners.ts | webrtc-signal bounded/authorized opaque forwarding to connected peer | No offline LAN signaling, capability or peer lifecycle authority |
| android/calls/AndroidWebRtcEngine.kt | Existing native library, continual gathering, audio/video objects, incoming DataChannel immediately closed/disposed | Existing voice success is not messaging support; no current certificate/admission adapter |
| android/app/AndroidCallController.kt | Call lifetime, ICE queues/restart, call status/diagnostics | Messaging must not depend on active call, camera/microphone or call end |
| android/network | HTTPS backend validator, SocketRelay/proofs, pure optional checklist and envelope seam | No NSD/LAN/discovery/carrier implementation |
| android/app/build.gradle.kts and manifest | compile/target35, min26; INTERNET/audio/camera/biometric; no network FGS or new LAN permissions | No additions here; exact future platform matrix required |
| client/config/runtimeConfig.ts and service/configContext.ts | ICE config defaults empty servers/all; configurable call servers | Do not infer strict local-only/gathering privacy from empty server list |

## Pinned Android Java API inspection

Existing dependency io.github.webrtc-sdk:android:150.7871.01 in android/calls/build.gradle.kts.
Cached AAR SHA-256: 0a1627b1a48c2bc17d9a40d62fc47bd45166f44a311e95917f147c402de379b0.
Read-only javap of its cached classes inspected PeerConnection, RTCConfiguration,
RtcCertificatePem, DataChannel, DataChannel.Init and RTCStats. This is artifact/API
inspection, not proof that native code returns complete/correct evidence at runtime.

- PeerConnection exposes getCertificate(), createDataChannel(), getStats(callback), close(), dispose() and connection states. No public getRemoteCertificates, DTLS exporter or SCTP transport wrapper appeared in the inspected Java signatures.
- RTCConfiguration accepts certificate; RtcCertificatePem has generateCertificate overloads. Its public fields include certificate AND privateKey. Inspection printed signatures only, no key values. Later adapter must avoid extracting/logging/serializing privateKey; fingerprint the public certificate only under reviewed encoding.
- DataChannel exposes label(), id(), state(), bufferedAmount(), observer, send(), close(), dispose(). Runtime getters for protocol/ordered/reliability/negotiated were absent; Init records these at creation. Remote-created channels therefore need retained validated creation/DCEP evidence or a different reviewed approach; label/id alone cannot verify all properties.
- RTCStats exposes type/id/member maps. Possible transport/localCertificateId/remoteCertificateId and certificate fingerprints/base64 evidence need actual associated native reports and source validation. A public map API does not guarantee every required field exists or is tied to the current data transport. Missing/ambiguous evidence blocks optional admission.
- Per-attempt cert generation/no sharing and sole channel might narrow binding scope. It does not prove remote nonreuse, exact live association or policy without security and device evidence.

## Official sources and sharply limited claims

The main review cites official sources adjacent to each factual claim. These are
standards/guidance, not deployed K3NCRYPT results. The W3C WebRTC API enables local
certificate fingerprints and observed remote cert retrieval; no such generic
browser adapter is implemented here. Stats defines transport-to-certificate IDs
and certificate fields, but these are not portable cryptographic association IDs.
[WebRTC statistics](https://www.w3.org/TR/webrtc-stats/).

[WebTransport](https://www.w3.org/TR/webtransport/) describes client sessions,
streams/datagrams and transport options; it supplies no audited K3NCRYPT Android
QUIC server, browser peer listener, device trust or approved cert-binding design.
Its presence does not make QUIC practical with current dependencies.

The Android local-network page last updated 2026-10-02 distinguishes target37
mandatory protection from lower targets and Android16 opt-in. Some lower sections
still describe future permission work; the explicit Android17/target table is the
current interpretation. Recheck at implementation time. Do not generalize the
Android16 NSD exception to all native WebRTC UDP traffic or Android17 behavior.

The Chrome LNA article is feature-specific and documents gaps/rollout plans.
Supported browser versions and actual prompt/gathering behavior must be captured
in the later matrix; no cross-browser assertion is inferred from that article.
Ordinary Web versus IWA is an explicit deployment distinction; no IWA migration.

## Measurements still absent

No live native/browser certificate values or mappings inspected; no DataChannel
created; no ICE gathered; no permission prompt or FGS exercised; no real NSD,
Internet-off signaling, AP-isolation, Wi-Fi, IPv6, Doze or battery measurement.
Read-only source/javap inspection is all this branch adds as platform evidence.
Two physical Android devices are the minimum first spike; historical wider plan
requires at least three physical Android devices plus desktop/browser coverage
before a broad carrier/platform conclusion. No emulator substitutes for that.
