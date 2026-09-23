# Phase 8M Security Hardening Report

## Findings addressed

- **Activated-device revocation:** Revocation now validates the issuer at its own current epoch and advances the target from its own current epoch. This lets an original active device revoke a later-activated enrolled device and invalidates every target proof immediately.
- **Private-network membership binding:** Membership updates now require an active target lifecycle record in the event account with the matching identity reference. Relay admission now compares membership account, device identity, and target lifecycle epoch against the durable proof.
- **Live private-network enforcement:** The private-network relay re-reads membership before forwarding every packet. A removed or mismatched member socket is disconnected and cannot continue forwarding opaque packets.
- **Lifecycle mutation ordering:** Lifecycle state is conditionally written before the replay marker. A crash after the state write leaves a state that rejects a replayed transition rather than burning a valid event before mutation. Conditional epochs retain conflict protection.
- **Global device identifiers:** Bootstrap and enrollment reserve device IDs in the existing unique `device_identity_registry` collection before creating lifecycle records.
- **Readiness:** Required-index readiness now checks lifecycle, device-ID registry, proof nonce, network membership, and membership-event indexes.

## Files changed

- `backend/security/durableDeviceTrust.ts`
- `backend/security/networkMembership.ts`
- `backend/privateNetwork/relay.ts`
- `backend/db/index.ts`
- `backend/security/durableDeviceTrust.mongo.integration.test.ts`

## Validation

- `npm run lint`: passed.
- `npm run client:build`: passed.
- `npm run build-service-sdk`: passed.
- Real Mongo lifecycle integration: passed, including enrollment, activation, revocation, post-revocation proof denial, replay rejection, restart behavior, and concurrent duplicate bootstrap rejection.
- `npx jest --runInBand --detectOpenHandles`: passed: 96 suites / 429 tests; 2 suites and 5 tests skipped by existing environment configuration.

## Remaining limitations

- The relay’s packet-time membership validation implements live removal enforcement, but a dedicated Socket.IO integration test for an already-connected member removal has not yet been added.
- A dedicated cross-account membership rejection integration test has not yet been added, though the target lifecycle/account checks now reject that condition in the authority.
- Mongo multi-document transactions are not used; the state-first conditional-write design prevents the audited "replay marker consumed but mutation absent" failure mode, but deployment recovery monitoring remains necessary.

This phase addresses the audited code paths but does not claim complete security closure until the outstanding private-network integration tests run against real MongoDB and Socket.IO.
