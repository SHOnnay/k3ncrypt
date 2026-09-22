# K3NCRYPT Phase 8D.3 Site-to-Site Private Bridge Report

## Implemented architecture

`SiteToSiteBridgeRuntime` adds a control-plane authorization boundary for narrowly scoped, site-to-site routes. A route names two private-network IDs, one permanent bridge device in each network, a single private IPv4 host on each side, and the exact TCP or UDP services permitted between them. The application server remains the control plane; bridge nodes only carry packets through the existing encrypted private-network transport boundary.

The bridge runtime does not configure operating-system routes or expose LANs. `PlatformBridgeAdapter` is a deliberately isolated interface for a future Linux TUN, Windows Wintun, macOS Network Extension, or Android VPNService implementation.

## Bridge model and authorization

Both bridge devices must already be registered in their respective network as online, permanent nodes with the bridge capability. The runtime checks the current trusted-device boundary before authorizing, installing, receiving, or using a route. It also verifies that the route issuer is the owner of the source network.

Each route contains the issuing device and identity reference, source and destination epochs and commitments, an expiry, and a SHA-256 commitment over the complete authorization. Installation rejects malformed, expired, altered, cross-network-invalid, replayed, or stale authorizations. Route records are inserted through a claim plus compare-and-swap boundary.

## Routing security

Only `/32` addresses from RFC 1918 ranges are accepted. A route is usable only when the requested source host, destination host, transport protocol, and port exactly match the authorization. There is no CIDR-wide access, service wildcard, implicit LAN discovery, or automatic private-range exposure.

Every use rechecks the route commitment, ownership, network epoch and commitment, current trust state, and bridge liveness. A revoked, offline, downgraded, or stale bridge therefore makes the route unavailable. Expiry also makes the route unavailable without weakening account trust.

`EncryptedBridgeTransport` is an adapter boundary for the authenticated and encrypted Phase 8D private-network transport. The bridge layer introduces no cryptographic primitive and has no plaintext storage interface. A relay or packet-forwarding bridge can observe encrypted transport metadata required for forwarding, but it does not receive application plaintext from this layer.

## Attack resistance verified

The test coverage verifies owner-authorized route installation, exact host and service isolation, CIDR-expansion rejection, replay rejection, and fail-closed behavior when trust has been revoked. The runtime enforces the same bridge eligibility checks during authorization and later route use, which blocks a bridge that returns without a fresh trusted online state.

## Self-hosting and operations

Supported deployment targets are a permanently available home desktop, Raspberry Pi, private server, or other user-owned permanent node. Operators must keep the node patched, protect the device identity and secure storage, restrict local firewall exposure to explicitly authorized services, and arrange reliable power and network connectivity. An offline bridge removes route availability but does not remove account or network trust.

## Remaining limitations

This phase supplies the authorization, lifecycle, encrypted-transport adapter, and platform-routing boundary. It intentionally does not install TUN interfaces, alter OS routing tables, discover LAN services, or provide a general-purpose VPN. Platform adapters must be implemented and independently reviewed before any operating-system packet forwarding is enabled.

## Validation

- Jest: 92 passing suites, 416 passing tests, 1 skipped suite.
- TypeScript: service and backend no-emit compilation passed.
- ESLint passed.
- Client production build and service SDK production build passed.
- `npm audit --audit-level=high` found zero vulnerabilities.
- Backend and frontend production Docker builds passed.
- `git diff --check` passed.
