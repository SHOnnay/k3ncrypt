# Call deployment guide

## STUN and TURN

K3NCRYPT uses WebRTC DTLS-SRTP for media transport and the existing encrypted signaling channel for offer, answer, candidate, and call-control messages. Direct connections may work on compatible networks, but production deployments should provide TURN for users behind restrictive NATs or firewalls.

Configure ICE through `CHATE2EE_ICE_SERVERS` and `CHATE2EE_ICE_TRANSPORT_POLICY`. Keep ICE server credentials in deployment-managed configuration, not source control. Use relay-only policy only when a tested TURN service is configured.

## Production considerations

- Serve the client and signaling endpoint over HTTPS/WSS.
- Operate TURN with authenticated, short-lived credentials where possible.
- Monitor connection failures and relay capacity without logging SDP, candidates, media, keys, or message content.
- Test browser permissions, direct connectivity, TURN fallback, reconnection, cancellation, and media cleanup before enabling calls for a beta cohort.

## Current limitations

The current browser implementation supports voice calling. Video capture primitives exist, but remote video rendering, incoming-video negotiation selection, and beta UI controls are not complete. Do not advertise video calling until those paths are completed and tested.
