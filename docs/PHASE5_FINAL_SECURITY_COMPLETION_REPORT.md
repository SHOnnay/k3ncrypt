# Phase 5 final security completion report

## Phase 5 overview

Phase 5 call control, authenticated signaling composition, WebRTC lifecycle adapters, explicit permission handling, replay boundaries, and relay security documentation are complete at the code boundary. No Phase 6 work is included.

## Architecture

```text
Call UI
  ↓
ModernConversation
  ↓
createAuthenticatedCallComposition
  ↓
CallService + CallAuthorization
  ↓
AuthenticatedCallSignalTransport
  ↓
existing CryptoSession (signaling channel)
  ↓
TransportManager / relay
  ↓
WebRTC peer transport
```

`createAuthenticatedCallComposition` remains the sole supported constructor: it refuses a session that is not encrypted and ready and returns the call service together with the authenticated signaling transport. `ModernConversation.createAuthenticatedCallComposition()` is now the runtime boundary. It requires an active Vodozemac session, the conversation's authenticated `TransportManager`, stable routing identities, and an explicitly verified contact, then delegates to the factory. Raw transport objects and the legacy `ChatE2EE` path cannot create an authenticated modern call.

## Security guarantees

Signaling is confidential through the existing CryptoSession. Signals are bound to call/conversation, sender identity, event, SDP/ICE payload, sequence, timestamp, expiry, and identity binding. The receiver checks expected origin and verified membership. Replay outcomes are explicit and bounded. Permission controllers request capture only after explicit actions and release tracks on failure/close. Relay infrastructure sees routing and metadata, not plaintext signaling or media when it only forwards packets.

## Audit findings closure

F-01 — signaling digest without authenticated context  
Before: a relay could recompute a digest after modifying payload content.  
After: the complete signal is encrypted through the existing authenticated conversation session and origin-checked by `AuthenticatedCallSignalTransport`; digest remains tamper detection.  
Status: remediated at code boundary; deployed wiring requires the composition factory.

F-02 — process-local replay state  
Before: restart erased replay claims.  
After: `ReplayProtectionStore` exposes TTL, atomic-claim, shared persistence requirements and explicit outcomes; memory remains test-only.  
Status: remediated at interface boundary; production adapter and retry/outbox deployment remain required.

N-01 — authenticated transport not composed  
Before: transport class was exportable but not enforced by composition; the application bootstrap did not expose the modern session/transport pair.
After: modern runtime creation flows through `ModernConversation.createAuthenticatedCallComposition()`, which fails closed until the Vodozemac session is ready and the contact is verified, and then delegates to `createAuthenticatedCallComposition`. The client uses that composition for modern call invitation; legacy call methods are not used in modern mode.
Evidence: modern conversation integration tests cover pre-verification rejection, authenticated transport selection, and secure call invitation; the composition factory retains missing-session rejection coverage.
Status: closed at runtime composition boundary. Incoming/media call signaling still requires the separately documented transport/WebRTC deployment work.

## Remaining production requirements

Completed: call-domain validation, authenticated transport boundary, modern runtime composition, identity binding, replay interface, WebRTC/permission adapters, regression tests, and security documentation.

Requires deployment: durable atomic replay store, relay/TURN credentials and retention review, supported Firefox/CI browser evidence, production log/database inspection, and completion of incoming-call/media negotiation over the authenticated signaling channel.

Future work: group calls, multi-device call identity, media-terminating SFU review, and any Phase 6 functionality. None is enabled here.
