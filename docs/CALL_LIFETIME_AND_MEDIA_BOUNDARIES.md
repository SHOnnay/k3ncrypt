# Call lifetime and media boundaries

K3NCRYPT calls move through invitation, acceptance, negotiation, established media, and termination. An invitation is not a call, and an accepted invitation is not a connected call.

## State and timing

Web stores `inviting`, `ringing`, `accepted`, `connecting`, `connected`, and `reconnecting` states, followed by a terminal state. Android owns one active call attempt in its controller. Both use the existing UUID `callId` as the attempt identity and bind signaling to that ID, conversation, peer identities, media mode, and per-attempt sequence/replay state.

An unanswered invitation and any setup that has not reached connected media expires after 60 seconds. Each signaling message also has its own `expiresAt`, capped at 60 seconds from its timestamp. This preserves the existing wire schema while allowing an established call to outlive its invitation. Expired setup, terminal calls, and duplicate or old call IDs cannot start media or replace a newer active call.

If both participants initiate while their outgoing attempts overlap, the lexicographically lower UUID wins. A later second invitation is rejected as busy. The rule uses only the stable call IDs; it does not compare device clocks.

## Acceptance and media

Incoming calls do not request microphone or camera access before the user accepts. Android also waits for remote acceptance before creating the outgoing PeerConnection or starting capture. Web requests media only after the remote accepts an outgoing invitation; an incoming Web call requests media after the local user accepts.

`Connected` means the WebRTC PeerConnection reports `connected` (or Android ICE reports `connected`/`completed`). Accept, a relay acknowledgement, a PeerConnection object, or SDP offer/answer application alone is insufficient. The endpoint with the lower stable routing ID owns the single ICE restart attempt, with a 30-second reconnect window; failure closes media and ends the active attempt.

## Termination and process lifetime

Cleanup is fenced by call ID/generation, idempotently closes the PeerConnection, stops local capture, clears queued ICE and timers, unregisters Web listeners, and rejects callbacks from an old connection. Android renderer sinks are detached by the Compose surface when its call track leaves UI state.

Call state is in memory and is never restored as active after process restart. A newly created Web composition or Android call controller ignores invitation messages created before its own lifetime. Web terminates modern calls on `pagehide` and peer disconnect. Android has no foreground call service: its application-scoped controller can continue while the process is alive, but Android process death ends the call; no signaling or media session is reconstructed after restart. Relay reconnection rejoins the existing authenticated conversation and does not create a new call attempt or replay old ICE.

Local verification remains independent of connectivity. Web rechecks device trust and contact verification before signaling and validates the peer identity on received signals; a detected change blocks later signaling and fails setup closed. The Web call composition has no live trust-change subscription, so an already-connected media stream is not proactively revoked until another signal is attempted or the peer disconnects. Android observes verification revisions and terminates an active attempt when the verified conversation changes. Remote verification fields remain compatibility metadata and cannot establish local verification.
