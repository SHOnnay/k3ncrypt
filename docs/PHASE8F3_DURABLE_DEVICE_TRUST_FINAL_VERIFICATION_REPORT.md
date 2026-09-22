# Phase 8F-3 Durable Device Trust Final Verification

## Verification result

Phase 8F-3 durable persistence verification **PASSED** against MongoDB at `mongodb://localhost:27017/k3ncrypt`.

## Implemented verification coverage

`backend/security/durableDeviceTrust.mongo.integration.test.ts` exercises the production `MongoDeviceTrustStore` and `DurableDeviceTrustAuthority` when Mongo is available:

- existing trusted-device lifecycle bootstrap;
- signed enrollment into `pending` state;
- target-signed activation into `active` state;
- signed proof request and relay-scoped proof verification;
- fake issuer rejection;
- activation replay rejection;
- proof consumption surviving authority reconstruction.

The run also found and fixed a MongoDB production defect in `MongoDeviceTrustStore.upsert()`: `createdAt` was being written through both `$set` and `$setOnInsert`, producing a Mongo path-conflict error on every upsert. The store now writes the record once through `$set`.

The test uses Ed25519 key pairs and the same canonical JSON/signature verification boundary as production code. It does not use an in-memory substitute.

## Initial-device bootstrap

The first trusted device must be provisioned by an authenticated account-creation/bootstrap authority that writes its public verification key, account reference, active lifecycle state, and initial trust epoch into `device_lifecycle`. The current repository has no production account-creation endpoint that performs this durable bootstrap. The self-bootstrap branch in the authority is therefore not treated as a deployment authorization mechanism.

## Validation

- Backend TypeScript: passed.
- Service TypeScript: passed.
- ESLint: passed.
- Focused Jest suites: passed.
- Mongo integration suite: passed (2 tests) against the configured local MongoDB instance.
- Full client/build/Docker/npm-audit validation: not claimed; existing workspace dependency/configuration errors remain.

The Mongo-backed enrollment, activation, proof issuance, replay protection, and authority-restart persistence path is verified. The initial trusted-device record in this test is provisioned explicitly as an already-authorized lifecycle record; production account creation must provide the equivalent authenticated bootstrap authority before deployment.
