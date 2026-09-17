# Phase 1 completion record

Date: 2026-09-17.

## Completed

- Fork ownership protected: `origin` is K3ncrypt; historical upstream fetch remains available and upstream pushes are disabled.
- Legacy crypto wrapped behind `CryptoSession`.
- Socket.IO wrapped behind `Transport` and a used `TransportManager`.
- Inbound acknowledgements now follow authenticated protocol acceptance.
- Bounded replay window accepts legitimate reordering and rejects duplicates/old values.
- Browser and server security-sensitive identifiers use platform CSPRNG UUIDs.
- Runtime Google Fonts and hard-coded Google STUN were removed.
- Explicit ICE/TURN and relay-only configuration added.
- Production SDK logging defaults off; metadata/error logging was reduced and client debugging made opt-in.
- Dormant plaintext third-party upload clients were removed.
- Package license metadata now matches Apache-2.0.
- Production and full dependency audits are clean at the recorded date.
- Identity, public-preference, secure-storage, and attachment boundaries are distinct.
- K3ncrypt received a responsive light messenger redesign with honest future-feature states.

## Verification targets

Unit coverage includes legacy adapter lifecycle, transport routing, acknowledgement rejection, `1,3,2` ordering, duplicates, too-old sequences, CSPRNG UUIDs, runtime ICE defaults, and configured relay-only ICE.

The Playwright suite covers invitation creation/join, retry after backing out, two-browser encrypted message exchange, and rejection of a room ID without a secret.

## Deliberately deferred

Persistent identity, secure database, recovery, verification/safety numbers, attachments, offline queues, native clients, Tor, Bluetooth, Wi-Fi Direct, LAN, MLS, and production vodozemac are not implemented. WebRTC calling with no configured ICE server can have reduced reachability. The legacy shared-secret session still lacks forward secrecy and post-compromise recovery.

