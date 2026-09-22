# K3NCRYPT Phase 8D.2 Adaptive Node Network Report

Date: 2026-09-22

## Node architecture

The server remains K3NCRYPT's authoritative control plane for identity, trust, discovery, authorization, offline delivery, and relay fallback. Phase 8D.2 adds optional communication assistance through the private-network SDK:

- **Client node**: every installed device; can participate in authenticated private networks.
- **Active node**: an available trusted device that may temporarily relay opaque encrypted traffic.
- **Permanent node**: owner-operated, always-on infrastructure that may relay and later serve as a reviewed bridge endpoint.

`AdaptiveNodeRuntime` records node role, immutable device identity reference, declared capabilities, status, last seen time, and expiry. It does not create an identity or a new credential. Existing device trust gates every operation.

## Trust integration and routing

Node registration, removal, and capability updates require a trusted active issuer and a bounded, digest-verified, one-time authorization. A node heartbeat re-verifies current device trust, so revoked/stale devices cannot return as active nodes. Offline nodes are marked stale after expiration; their disappearance does not affect account trust or stored state.

Routing follows this order: direct connection, available trusted active/permanent node with relay capability, then the existing K3NCRYPT server relay. Failure of an optional node is therefore an availability event, never a trust transition or data mutation.

Large encrypted transfers can select an active node route while the server continues to coordinate discovery and fallback. Nodes receive opaque packets through the Phase 8D authenticated private-network transport and cannot inspect message, attachment, or session-key plaintext.

## Site-to-site preparation

Permanent nodes can declare `bridge: true`. The foundation validates private RFC1918 CIDR allowlists and requires a bridge-capable permanent node before accepting a route authorization object. It does not create operating-system routes, TUN devices, NAT rules, or automatic LAN access. A later bridge adapter must retain explicit per-CIDR authorization and isolation.

## Security guarantees

- Fake registration, altered authorization, replay, unauthorized capability change, node impersonation, and revoked-node heartbeat fail closed.
- Nodes and relays use existing encrypted session transport; a malicious assistance node sees ciphertext only.
- Node availability is advisory. No data is persisted on nodes and no server control-plane responsibility moves to a node.
- Private-network relay fallback remains available when direct and active-node paths fail.

## Self-hosting

Users can run a laptop/desktop active node or a permanent Raspberry Pi/VPS node using the existing self-hosted backend/private relay. No paid infrastructure is required. Permanent-node deployments should use the Phase 8 production Docker image, HTTPS, current trust refresh, stable power/network monitoring, and the existing Mongo backup policy.

## Remaining limitations

- Node management is SDK foundation work; no end-user UI or production discovery protocol is added in this phase.
- Active-node relay data plane requires a consumer-provided direct/relay adapter; the server fallback remains the deployed relay path.
- Node status persistence is adapter-owned; production deployments should supply durable encrypted persistence and a freshness signal.
- Site bridges and OS-level routing are deliberately not implemented.

## Validation

| Gate | Result |
| --- | --- |
| Jest | Passed: 91 suites, 414 tests; 1 environment-gated test skipped |
| TypeScript | Passed |
| ESLint | Passed |
| Client build | Passed: 218 modules transformed |
| SDK build | Passed |
| npm audit | Passed: 0 vulnerabilities |
| Docker builds | Passed: backend and frontend production images built locally |
| Diff check | Passed |
