# Phase 8F-3 Protocol Contract Report

## Added contracts

`EnrollmentEvent` binds the account, trusted issuer, issuer epoch, target device identity, target Ed25519 verification key, fingerprint, nonce, timestamp, and expiry. Its canonical unsigned JSON is signed only through `signControlEvent` on the existing Vodozemac account boundary.

`DeviceProofRequest` binds the existing device identity, account, requested operation, nonce, current epoch, timestamp, and expiry. It is signed through the same boundary. The backend helper verifies either contract against the stored raw Ed25519 public key; no private key, message, or room capability is involved.

## Remaining wiring

The durable Mongo authority must next apply verified enrollment/activation/revocation events atomically, store replay claims, and issue proofs only after verifying a signed `DeviceProofRequest`. Relay, attachment, bridge, and device-control paths must then consume those durable proofs. This report does not claim Phase 8F-3 completion.
