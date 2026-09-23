# Phase 8M-1.5 Membership Security Validation

## Scope

This validation adds integration coverage only. It does not change the private-network authorization model, proof format, lifecycle state model, or encrypted payload handling.

## Coverage added

`backend/privateNetwork/membershipSecurity.mongo.integration.test.ts` exercises the production Mongo-backed authority and the Socket.IO private-network relay.

- A member with an active lifecycle record, active durable membership, and resource-bound `private-network:relay` proof connects to the relay and forwards an opaque packet to the owner.
- After the durable membership record changes to `removed`, the relay rechecks membership on the next packet, disconnects the existing socket, and does not forward that packet.
- An owner in Account A attempts a signed `add-member` event for an active device belonging to Account B. The membership authority rejects the event before recording a membership for the foreign device.

The tests use separate random account, device, and network identifiers and clean up only those records.

## Validation results

| Command | Result |
| --- | --- |
| `MONGO_URI=mongodb://127.0.0.1:27017 MONGO_DB_NAME=k3ncrypt K3NCRYPT_DEVICE_TRUST_PROOF_SECRET=… npx jest backend/privateNetwork/membershipSecurity.mongo.integration.test.ts --runInBand --detectOpenHandles --coverage=false` | Passed: 1 suite, 2 tests |
| `npm run lint` | Passed |
| `npm run client:build` | Passed |
| `npm run build-service-sdk` | Passed |
| `npx jest --runInBand --detectOpenHandles --coverage=false` | Passed: 96 suites, 429 tests; 3 Mongo-gated suites skipped and 7 tests skipped |

## Environment note

The normal full Jest command intentionally runs the legacy unit suites without Mongo environment variables, so their in-memory persistence mode remains active. Running the entire suite with `MONGO_URI` set changes that mode and causes legacy unit-test assumptions to fail. The new Mongo-backed Socket.IO suite was therefore executed separately with real MongoDB, as shown above.

## Remaining limitations

This verifies authorization removal on the next outbound private-network packet and confirms the relay disconnects the existing socket. It does not simulate multi-process relay fan-out or network partitions; those require deployment-level testing with a shared Socket.IO adapter.
