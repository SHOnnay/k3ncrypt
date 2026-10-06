# Call deployment guide

## STUN and TURN

K3NCRYPT uses WebRTC DTLS-SRTP for media transport and the existing encrypted signaling channel for offer, answer, candidate, and call-control messages. Direct connections may work on compatible networks, but production deployments should provide TURN for users behind restrictive NATs or firewalls.

Configure ICE through `CHATE2EE_ICE_SERVERS` and `CHATE2EE_ICE_TRANSPORT_POLICY`. Keep ICE server credentials in deployment-managed configuration, not source control. Use relay-only policy only when a tested TURN service is configured.

The repository defaults to no configured ICE servers and `iceTransportPolicy: all`. Web deployments can override those values with the environment variables above. The Android call entry points currently pass an empty ICE server list and use WebRTC's default `ALL` policy; Android has no runtime ICE configuration UI. No STUN or TURN server is bundled or selected by the current call UI.

With the default `all` policy, direct host-candidate connectivity is allowed. Browser host candidates may use mDNS names, depending on browser behavior; Android may expose host network addresses to the peer. Configured STUN can add server-reflexive candidates. The v2 signaling payload, including ICE candidates, travels inside the existing end-to-end encrypted conversation. Call diagnostics retain candidate types only; they do not log raw candidate strings or addresses. The relay-only Web setting is deployment configuration, not a user-facing Hide-my-IP control. K3NCRYPT currently makes no call IP-hiding promise or relay-only guarantee.

No STUN or TURN server is configured by the checked-in defaults. Without TURN, calls can fail on restrictive NATs or firewalls. If TURN is enabled later, video relay traffic can consume substantial bandwidth and should be capacity- and cost-tested before rollout.

## Production considerations

- Serve the client and signaling endpoint over HTTPS/WSS.
- Operate TURN with authenticated, short-lived credentials where possible.
- Monitor connection failures and relay capacity without logging SDP, candidates, media, keys, or message content.
- Test browser permissions, direct connectivity, TURN fallback, reconnection, cancellation, and media cleanup before enabling calls for a beta cohort.

## Current limitations

Calls are limited to verified 1:1 audio or video. An audio invitation remains audio; a video invitation requires camera and microphone capture and is not silently downgraded. Camera or microphone permission is requested only after the relevant user action. Video readiness still depends on platform/device interoperability testing and an operational TURN deployment for restrictive networks.
