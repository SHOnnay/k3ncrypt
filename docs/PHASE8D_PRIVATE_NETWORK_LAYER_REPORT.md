# K3NCRYPT Phase 8D Private Network Layer Report

Date: 2026-09-22

## Architecture

Phase 8D provides a private-network foundation, not a general VPN or overlay replacement. It adds `service/src/privateNetwork`, which can model a user-owned network, its trusted devices, authorized membership changes, connectivity preferences, and opaque encrypted packet transport.

Each private network has an ID, account scope, monotonic epoch, prior-commitment link, canonical commitment, and active/removed device members. The owner device authorizes joins and removals; a bridge is a membership role for a future site-to-site adapter, not an automatic route injector. A site bridge must be an active trusted member and needs an explicit adapter before it can reach a LAN. This prevents the SDK from silently exposing `192.168.x.x` ranges.

For connectivity, consumers attempt LAN, then direct internet, then a relay. The mode selector is architecture only: direct dialers and route establishment are provided through adapters rather than a custom tunneling protocol. This lets self-hosted deployments choose a reviewed platform network adapter without duplicating WireGuard, Tailscale, or a new key system.

## Identity and authorization

`PrivateNetworkRuntime` accepts the existing `NetworkTrustBoundary`, which is implemented by the Phase 6 device trust enforcement path. Before every create, member listing, authorization, application, send, and receive path, the boundary must establish current trusted-device state. Owner authorization is accepted only when the issuer is both an active account device and an active network owner. Authorizations bind network, account, issuer device/identity, target device/identity, operation, previous epoch/commitment, and expiry. They are digest-verified, claimed once, and installed through compare-and-swap persistence.

Unknown, revoked, stale, or non-owner devices cannot create membership authority. Removing a member advances the network epoch and commitment. A removed device fails membership admission and should have its session adapter torn down by the application on the resulting trust/network update.

## Transport boundary

`AuthenticatedPrivateNetworkTransport` never implements cryptography. It requires a ready, encrypted existing `CryptoSession` and uses its approved signaling encryption channel to carry a bounded private-network packet. Packets bind network, both device IDs, both identity references, session ID, message ID, and expiry. The receiver validates every binding after decrypting, rejects a sender substitution, expires old packets, and rejects a duplicate session/message pair.

The transport has no storage authority and no plaintext server path. It can use a direct adapter or `PrivateNetworkRelay`. The included `/private-network/socket.io` relay endpoint routes opaque envelopes by network/device routing IDs, applies packet-size and token-bucket limits, and does not inspect, decrypt, log, or persist payloads. A compromised relay can observe connection and routing metadata but only ciphertext traffic.

## Self-hosting and deployment

The existing Phase 8 backend image now includes the blind private-network relay. A user can self-host it by deploying the backend from `docker/backend.Dockerfile` with the existing `docker/compose.production.yaml`, HTTPS termination, a persistent MongoDB service, explicit origins, and one backend instance. The private relay Socket.IO path is `/private-network/socket.io`.

No paid service is required. Direct LAN mode needs no relay. Internet connectivity needs a consumer-provided direct-dial adapter; restrictive NATs can use the self-hosted relay, and real media calls continue to use separately configured STUN/TURN. The relay does not grant access: network nodes must still construct an authenticated session and pass current trusted-device checks.

## Threat model and guarantees

| Attack | Result |
| --- | --- |
| Fake device join | Rejected: issuer must be a trusted active account device and active network owner. |
| Revoked device reconnect | Rejected by current device-trust assertion before admission or packet handling. |
| Replayed authorization or packet | Rejected through authorization claim and packet session/message replay memory. |
| Compromised relay | Sees only routing metadata and opaque encrypted envelopes. |
| Unauthorized site bridge | Rejected unless an owner authorizes an active bridge member; no LAN route is created automatically. |

## Remaining limitations

- This is a foundation API. It does not yet expose network creation/member controls in the client UI or ship a native packet/TUN adapter.
- Packet replay memory is session-local. A production adapter that persists private-network sessions across restart must back replay claims with durable encrypted storage, analogous to the existing sync/call replay adapters.
- Site-to-site routing requires a separately reviewed, platform-specific bridge adapter with explicit CIDR allowlists, route isolation, and operator consent.
- Direct NAT traversal is adapter-provided. Relay fallback is available as a blind transport endpoint, but no automatic IP tunneling is implemented.

## Validation results

| Gate | Result |
| --- | --- |
| Jest | Passed: 90 suites, 412 tests; 1 environment-gated test skipped |
| Service TypeScript | Passed |
| Backend TypeScript | Passed |
| ESLint | Passed |
| Client production build | Passed: 217 modules transformed |
| SDK build | Passed |
| npm audit | Passed: 0 vulnerabilities at high threshold |
| Docker builds | Passed: backend and frontend production images built locally |
| Diff check | Passed: no whitespace errors |
