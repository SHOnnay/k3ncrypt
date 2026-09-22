# K3NCRYPT Final Security Review

## Scope and method

This review inspected the current authorization, authentication, lifecycle, proof, replay, and data-exposure code paths. It does not rely on prior reports or test results. No production code was changed.

## Critical — Lifecycle updates can restore revoked devices

**Affected files:** `backend/security/durableDeviceTrust.ts:68-72`, `backend/api/deviceTrust.ts:19`.

**Description:** The lifecycle `update` path validates the issuer's epoch against `event.previousEpoch`, but does not validate that the target device is at that epoch. It also maps every operation other than `revoke` to `active`. Consequently, a valid active issuer can submit an otherwise valid non-revocation lifecycle update for a target record and cause a revoked target to become active, while assigning its epoch from an issuer-controlled event value. The endpoint also does not require a durable `device-control` proof.

**Impact:** Revocation cannot be treated as permanent. A revoked device can be returned to an active state and may subsequently obtain proofs for protected operations. Lifecycle state can also become inconsistent with the intended epoch model.

**Remediation:** Split lifecycle operations into explicit, allow-listed state transitions. Require the target's current epoch to equal the event's previous epoch; require the next epoch to be exactly one greater; prohibit transitions out of `revoked` except through a separately designed recovery process. Require and consume a current `device-control` proof for every issuer-driven lifecycle mutation, and authorize the issuer for the specific target/account action.

## Critical — Mongo lifecycle records are a mutable root of device authority

**Affected files:** `backend/security/durableDeviceTrust.ts:74-86`, `backend/db/migrations.ts:18-20`.

**Description:** Proof issuance trusts the mutable Mongo lifecycle record for the active state, epoch, account reference, and public verification key. The collection has ordinary indexes but no record-level integrity protection, append-only lifecycle log, or independently verifiable event chain. A database writer can alter a record's public verification key and lifecycle fields, after which the authority accepts signatures made with that replacement key and issues server-authenticated proofs.

**Impact:** A compromise of database write access can become device-trust compromise, enabling authorization for relay, attachment, private-network, bridge, and device-control operations. This exceeds a control-plane verifier role.

**Remediation:** Make lifecycle state derived from a verified, append-only chain of signed lifecycle events and protect that chain from database-only modification (for example, through externally held integrity keys and signed event hashes). Validate record state against the signed chain before proof issuance. Restrict database credentials to the application, use separate migration credentials, and monitor/alert on lifecycle writes; these operational controls supplement but do not replace cryptographic integrity.

## High — Enrollment retains a self-signed path for arbitrary account references

**Affected files:** `backend/security/durableDeviceTrust.ts:46-59`, `backend/api/deviceTrust.ts:17`.

**Description:** `enroll` treats an event as bootstrap when no issuer record exists and the issuer and target identifiers match. In that branch, it verifies with the target's supplied public key, skips durable proof verification, and writes an active record under the event-supplied `accountIdentityReference`. The HTTP handler only checks that a proof-shaped object is present and that its nonce matches the separately supplied value; the bootstrap branch does not verify that proof.

**Impact:** Account/device membership can be created without authorization by an existing trusted device. Any use or disclosure of an account reference turns this into a cross-account trust-boundary failure.

**Remediation:** Remove the self-signed branch from enrollment. Permit first-device creation only through the dedicated bootstrap endpoint that generates the account reference server-side. Require every enrollment to include a consumed durable `device-control` proof from an active issuer in the same account, and enforce an explicit issuer role or owner authorization policy.

## High — Private-network relay authentication does not verify network membership

**Affected files:** `backend/privateNetwork/relay.ts:20-36`.

**Description:** Relay admission verifies that a proof belongs to the claimed device and has the `private-network:relay` operation scope. It does not verify that the device is an authorized member of `networkId`, nor that the proof is bound to that network. The relay immediately places the connection in the per-network routing map.

**Impact:** The private-network boundary does not enforce membership. Unauthorized active devices can be admitted to network relay namespaces, increasing metadata exposure and creating an unauthorized path to deliver opaque traffic to participating devices.

**Remediation:** Persist authoritative network membership and verify it during admission. Bind the network identifier, membership version/epoch, and intended relay operation into the signed authorization or server-issued proof. Revalidate membership after revocation or membership changes and disconnect affected peers.

## High — Message-relay device proofs are not bound to a routing identity or room

**Affected files:** `backend/socket.io/listeners.ts:26-30`, `backend/socket.io/listeners.ts:107-148`, `backend/security/durableDeviceTrust.ts:74-78`.

**Description:** A relay proof binds a device, account reference, operation, epoch, nonce, and expiry, but does not bind a chat channel, routing identity, recipient, or room-control capability. In addition, `authorizeRoutingAddress` accepts an address when no pre-key ownership record exists. The relay therefore treats a current device proof as independent of the claimed routing identity and relies on a bearer room capability plus the permissive legacy routing fallback.

**Impact:** The relay cannot consistently establish that the device proof authorizes the specific messaging identity and room being claimed. This weakens sender identity integrity and can lead to unauthorized room participation or delivery misrouting where legacy identities are present.

**Remediation:** Bind the device identity to the authorized routing identity and account membership in durable state. Require proof claims to include and authenticate the channel and intended action, or verify a separately signed room-membership assertion. Remove the `!record` allow path; legacy identifiers should be migrated to an ownership record or rejected.

## Medium — Enrollment replay identifiers are consumed before issuer authorization completes

**Affected files:** `backend/security/durableDeviceTrust.ts:51-56`.

**Description:** Enrollment consumes the event identifier before validating the issuer's durable proof. A rejected request can therefore leave the event identifier marked as used even though the lifecycle mutation did not occur.

**Impact:** Legitimate enrollment approvals can become unavailable until recreated. This is an authorization-availability and reliability weakness rather than a confidentiality failure.

**Remediation:** Validate the issuer proof and all authorization predicates before consuming the event identifier, then perform nonce consumption and record insertion in one transaction. Preserve unique indexes as a final concurrency guard and return a retry-safe error for transient conflicts.

## Medium — Durable bootstrap has a cross-account device-identity race

**Affected files:** `backend/security/durableDeviceTrust.ts:37-43`, `backend/db/migrations.ts:18`.

**Description:** Bootstrap checks `readAnyDevice(deviceId)` and later performs an upsert keyed only by `(accountIdentityReference, deviceId)`. There is no global unique index on `deviceId` and no transaction joining the existence check, nonce claim, and lifecycle insert. Concurrent bootstrap requests can produce inconsistent records for the same device identifier across account references.

**Impact:** Device identity uniqueness and account/device separation can become ambiguous. Later proof and lifecycle decisions may depend on which account-scoped record is queried.

**Remediation:** Use a transaction and enforce a globally unique device identity constraint, or introduce a dedicated immutable device-identity collection with a unique device identifier. Before migration, reconcile existing duplicates under an explicit, audited policy rather than silently choosing one.

## Medium — Attachment authorization keeps two unrelated identity systems

**Affected files:** `backend/api/attachments/production.ts:48-75`.

**Description:** Attachment access verifies a durable device proof, but it separately authorizes a participant through a room capability and pre-key renewal proof. It does not bind the durable proof's device/account identity to the participant identity or conversation. After these independent checks, the authenticated context installs a no-op `deviceTrust.assertTrusted` callback.

**Impact:** A successful device proof alone does not prove that the device is authorized as the participant accessing the selected conversation. The split checks make future changes fragile and can permit cross-identity authorization mistakes.

**Remediation:** Create a single verified authorization context that binds device, account, participant, conversation, requested attachment operation, and lifecycle epoch. Pass the verified context to attachment services rather than a no-op assertion. Add negative tests for account/participant/conversation mismatches.

## Low — Security-relevant rejection details are written through console logging

**Affected files:** `backend/socket.io/listeners.ts:115-129`, `backend/socket.io/listeners.ts:133-135`.

**Description:** Socket authorization failures use `console.error`. These entries are outside the privacy-preserving structured logging boundary and may be routed by deployment infrastructure without the application's redaction policy.

**Impact:** Operational logs can reveal room or authorization-failure metadata and lack consistent retention, redaction, and correlation controls.

**Remediation:** Replace console logging with the structured operational logger, use stable event codes, and exclude user, room, capability, proof, and envelope values. Configure retention and access controls for the log sink.

## Verdict

**NOT READY.** The lifecycle and database-authority findings permit trust-state violations, while private-network and messaging authorization are not fully bound to the resources they protect. These issues should be resolved and independently re-reviewed before a security-sensitive deployment.
