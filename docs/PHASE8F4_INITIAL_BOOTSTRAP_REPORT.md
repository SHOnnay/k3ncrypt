# Phase 8F-4 Initial Device Bootstrap

## Implemented

- Added a signed `BootstrapRequest` contract.
- Added client `bootstrapFirstDevice()` using the existing Vodozemac signing boundary.
- Added `POST /api/device-trust/bootstrap`.
- Backend generates the account reference and initial trust epoch; callers cannot select either value.
- Backend verifies the device-generated UUID, public Ed25519 verification key, identity reference/fingerprint binding, timestamp, expiry, nonce, and signature.
- Private keys never enter the request or backend.
- Durable replay consumption uses the existing Mongo nonce collection.
- Existing device identity records are checked before bootstrap; capability-only registration remains disabled.

## Mongo verification

With `MONGO_URI=mongodb://localhost:27017` and `MONGO_DB_NAME=k3ncrypt`:

- `backend/security/durableDeviceTrust.mongo.integration.test.ts`: 3 passed.
- `backend/db/mongo.integration.test.ts`: 1 passed.
- First-device bootstrap created an active epoch-1 record.
- Duplicate request replay was rejected.
- A proof request signed by the bootstrapped device was issued and verified for `relay:message`.

## Initial authority boundary

The bootstrap endpoint authenticates possession of the device’s private signing key, but account creation policy still belongs at the account onboarding boundary. The backend generates the account reference and must deploy this endpoint behind the product’s account-creation policy/rate limits. It does not accept a caller-selected trusted state, account reference, or server-generated identity key.

## Status

The first-device durable bootstrap path is implemented and verified against real MongoDB. This report does not claim full Phase 8 security closure; protected transport and operational validation remain separate concerns.
