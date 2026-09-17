# Network privacy

## Opening the application

A normal initial page load is expected to contact only:

1. the origin serving the client assets; and
2. the configured K3ncrypt relay in `CHATE2EE_API_URL` for Socket.IO and room REST calls.

There are no runtime Google Fonts, analytics, advertising, third-party avatars, tracking pixels, imgbb, or imgur requests. The dormant plaintext image-upload clients and their HTTP dependencies were removed.

## Calls

The default `CHATE2EE_ICE_SERVERS=[]` makes no public STUN or TURN request. This can prevent calls across NAT boundaries; that is an explicit privacy/availability trade-off, not a hidden fallback.

Operators may configure:

```dotenv
CHATE2EE_ICE_SERVERS=[{"urls":["turns:turn.example.org:5349"],"username":"user","credential":"secret"}]
CHATE2EE_ICE_TRANSPORT_POLICY=relay
```

`relay` prevents direct host/server-reflexive candidates from being used, but the chosen TURN operator can observe call timing, IP addresses, and traffic volume. `all` may expose network candidates to the peer and configured ICE services. WebRTC media remains protected by DTLS-SRTP, but traffic metadata is not hidden.

## Server-side endpoints

When configured, the server contacts its MongoDB endpoint. Package installation, tests, and documentation browsing may contact package registries or documentation hosts; those are development operations, not application runtime behavior.

## Relay-visible metadata

The relay can observe source IP, connection and room timing, room UUID, temporary routing UUID, Socket.IO connection, event class, encrypted-envelope size, order, and delivery acknowledgement. It can drop, delay, duplicate, or reorder traffic. K3ncrypt does not currently provide traffic padding, anonymous routing, durable private mailboxes, or resistance to relay traffic analysis.

## Invitation privacy

The secret is in the URL fragment, which is normally excluded from HTTP requests. It can still be exposed through browser history/sync, clipboard managers, screenshots, extensions, screen sharing, or accidental link handling. Invitations should be shared only over a trusted channel.

