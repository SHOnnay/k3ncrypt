# Phase 5 media transport security

This milestone adds the browser media boundary only. Media is requested after an explicit call action through `CallMediaController`; it is never requested during startup, stored, recorded, uploaded, or processed as plaintext by the service. Every captured track is stopped on release and the peer adapter closes on terminal failure.

## WebRTC boundary

`BrowserCallMediaConnection` owns a browser `RTCPeerConnection` and exposes only offer creation, answer handling, ICE-candidate forwarding, state changes, and close. It does not authenticate contacts, persist state, choose public STUN services, or send signaling. WebRTC DTLS-SRTP protects media in transit between negotiated endpoints; it does not by itself prove that the endpoint is the verified K3ncrypt contact, protect a compromised browser, prevent screenshots/recording, or hide metadata.

## Signaling boundary

Offer, answer, ICE, and control events must travel through the existing authenticated modern-conversation signaling boundary and `SecureCallSignaling`. Events are scoped to call ID, conversation ID, expiry, identity binding, participant authorization, and sequence. Duplicate/replayed events are ignored or rejected. This repository does not add an anonymous signaling route or public media URL.

Signaling can observe routing, timing, call state, packet sizes, and delivery failures. It must not receive plaintext media, media keys, private identity material, or unencrypted call content. The existing Vodozemac and conversation protocol remain unchanged.

## Relay visibility and deployment

STUN/TURN configuration is supplied through an injected `WebRtcConfigProvider`; no provider or hardcoded server is added. A relay can observe allocations, network addresses as applicable, timing, volume, and availability, while forwarding encrypted packets. A media-terminating SFU would see media and cannot be described as end-to-end private without a separate reviewed media design. Production requires short-lived scoped relay credentials, abuse/rate limits, retention controls, and an IP-exposure decision.

## Permission and privacy limitations

Microphone and camera permissions are explicit and independent. Denial produces a generic failure; no browser error is persisted. Tracks are stopped on release and peer closure. There is no background capture, recording, analytics, device fingerprinting, public storage, or plaintext media processing. A malicious or compromised endpoint and remote-party recording remain outside cryptographic protection.

## Remaining integration work

The adapter still needs a reviewed application binding for authenticated signaling events, browser UI controls, remote-track presentation, ICE event plumbing, reconnect policy, and production TURN/STUN deployment. These are not shortcuts around identity verification or the frozen Phase 3/4 security boundaries.
