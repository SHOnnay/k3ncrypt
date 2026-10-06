# Call lifetime and media boundaries

K3NCRYPT calls move through invitation, acceptance, negotiation, established media, and termination. An invitation is not a call, and an accepted invitation is not a connected call.

## State and timing

Web stores `inviting`, `ringing`, `accepted`, `connecting`, `connected`, and `reconnecting` states, followed by a terminal state. Android owns one active call attempt in its controller. Both use the existing UUID `callId` as the attempt identity and bind signaling to that ID, conversation, peer identities, media mode, and per-attempt sequence/replay state.

An unanswered invitation and any setup that has not reached connected media expires after 60 seconds. Each signaling message also has its own `expiresAt`, capped at 60 seconds from its timestamp. This preserves the existing wire schema while allowing an established call to outlive its invitation. Expired setup, terminal calls, and duplicate or old call IDs cannot start media or replace a newer active call.

If both participants initiate while their outgoing attempts overlap, the lexicographically lower UUID wins. A later second invitation is rejected as busy. The rule uses only the stable call IDs; it does not compare device clocks.

## Acceptance and media

Incoming calls do not request microphone or camera access before the user accepts. Android also waits for remote acceptance before creating the outgoing PeerConnection or starting capture. Web requests media only after the remote accepts an outgoing invitation; an incoming Web call requests media after the local user accepts.

Audio and video intent is fixed on the call attempt. Audio uses microphone capture only. Video requires microphone and camera capture; a failed video request ends that setup rather than changing the authenticated media mode. A camera failure during an established call turns video off while preserving audio when possible. A microphone track failure ends the call. Mute disables the existing audio track. Turning the camera off stops/releases capture; turning it on reuses the existing sender/capturer lifecycle without changing the call ID or PeerConnection.

`Connected` means the WebRTC PeerConnection reports `connected` (or Android ICE reports `connected`/`completed`). Accept, a relay acknowledgement, a PeerConnection object, or SDP offer/answer application alone is insufficient. The endpoint with the lower stable routing ID owns the single ICE restart attempt, with a 30-second reconnect window; failure closes media and ends the active attempt.

## Termination and process lifetime

Cleanup is fenced by call ID/generation, idempotently closes the PeerConnection, stops local capture, clears queued ICE and timers, unregisters Web listeners, and rejects callbacks from an old connection. Web removes ended remote tracks and drops callbacks from closed connections. Android renderer sinks are detached by the Compose surface when its call track leaves UI state.

Call state is in memory and is never restored as active after process restart. A newly created Web composition or Android call controller ignores invitation messages created before its own lifetime. Web terminates modern calls on `pagehide` and peer disconnect, releasing local capture and remote media. Android has no foreground call service: configuration recreation preserves the controller and renderer track, while leaving the foreground closes active media and ends the attempt. An unanswered invitation has no active media and expires at its normal setup deadline. Android process death ends the call; no signaling or media session is reconstructed after restart. Relay reconnection rejoins the existing authenticated conversation and does not create a new call attempt or replay old ICE.

Local verification remains independent of connectivity. Web rechecks device trust and contact verification before signaling and polls only the pinned peer identity while a call is active; loss, identity change, or unavailable authority terminates the call locally and releases media. Android observes verification revisions and terminates an active attempt when the verified conversation changes. Remote verification fields remain compatibility metadata and cannot establish local verification.
