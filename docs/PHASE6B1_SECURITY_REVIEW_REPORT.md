# Phase 6B.1 security review report

## Scope and conclusion

This adversarial review covers the isolated Phase 6B.1 device foundation:

- `service/src/devices/deviceIdentity.ts`
- `service/src/devices/deviceList.ts`
- `service/src/devices/canonicalEncoding.ts`
- `service/src/devices/epoch.ts`
- `service/src/devices/deviceIdentity.test.ts`
- the Phase 6B authority, encoding, epoch, and implementation-readiness documents.

No Phase 6B.2 enrollment or trust-changing operation was implemented. The foundation is safe as a public-only validation layer, but **Phase 6B.2 is not ready** until the authority and integration gates below are composed around it.

## Attack review

| Attack | Attempt and observed result | Severity | Finding/fix |
| --- | --- | --- | --- |
| Device identity forgery | Supplied attacker-chosen device IDs and public identity references. Syntactically valid public records are accepted, but no trust or activation decision is made by this module. | Informational boundary | This is intentional for 6B.1. Phase 6B.2 must bind the reference to the existing verified device and authenticated `CryptoSession`; a server or list parser must never promote it. |
| Device-list tampering | Changed epoch, device ID, lifecycle state, and list fields; commitment verification rejected each changed object. Immutable snapshots prevent in-place mutation. | None in scope | Keep `verifyDeviceListCommitment` mandatory before accepting a control update. |
| Rollback | Lower epochs are classified stale/rejected by `compareEpoch` and `assertNotRollback`; next-epoch checks reject skipped increments. | None in scope | Phase 6B.2 must also reject same-epoch divergent lists by comparing the authenticated commitment chain. |
| Duplicate device identifier | Duplicate entries are rejected by `createDeviceList`, including entries with otherwise different public material. | None | Covered by regression test. |
| Serialization differential | Reordered object fields and device-array entries produce identical canonical bytes; unknown fields, duplicate keys/IDs, invalid numbers, control characters, and non-NFC strings are rejected. | None in scope | Publish cross-platform vectors before multi-client enrollment. |
| Lifecycle transition attack | Pending→active/revoked and active→revoked are allowed; active→pending and revoked→active are rejected. Revoked entries require a timestamp and cannot authorize operations. | None in scope | Phase 6B.2 must apply transitions only to an authenticated list update, not by direct client mutation. |

## Authority-boundary review

- **Current authority:** none is created by the foundation. `createDeviceEntry` and `createDeviceList` validate public data only.
- **Required future authority:** an existing active, verified device through the authenticated modern `CryptoSession` boundary, as specified by `PHASE6B_DEVICE_LIST_AUTHORITY_SPEC.md`.
- **Server authority:** none. The module has no server adapter or server trust bit.
- **Private key storage:** none. Only opaque public identity references are modeled.
- **Silent trust creation:** none. Lifecycle validation does not activate a device or establish verification.
- **Identity replacement:** none. Recovery and replacement are deliberately outside this milestone.

## Findings

### R-01 — Public identity material is not an identity proof

**Severity:** Informational for 6B.1; security-critical integration requirement for 6B.2.

The model accepts any well-formed public identity reference because it is intentionally a public data boundary. This is not an authorization bypass today: no enrollment, server acceptance, or trust transition exists. It becomes unsafe if a future caller treats parsing as proof of device ownership.

**Required fix before 6B.2:** authenticate the canonical control object through the existing `CryptoSession`, bind the author and target identity to the verified conversation context, and require explicit user verification before `pending` becomes `active`. No new key system may be introduced.

### R-02 — Same-epoch divergence requires composition enforcement

**Severity:** Low design gap; security-critical integration requirement for 6B.2.

`assertNotRollback` correctly rejects lower epochs, while commitment verification detects changed lists. The two checks are separate by design. A future integration that calls only the epoch helper could accept a divergent list at the same epoch.

**Required fix before 6B.2:** make the control-update path require both authenticated commitment verification and epoch-chain validation, with same-epoch divergence failing closed. This is an integration contract, not a Phase 6B.1 parser defect.

### R-03 — Durable replay/atomic persistence is not implemented

**Severity:** Deployment/design gate.

Phase 6B.1 is local and immutable; it does not claim nonces or persist multi-instance state. Enrollment/revocation cannot ship until replay claims and list persistence are atomic, shared, TTL-bounded, and restart-safe.

## Future integration risk review

Phase 6B.2 must bind the current epoch and authenticated device identity to:

- `CryptoSession` establishment and admission;
- new messaging/mailbox delivery authorization without changing historical ciphertext or formats;
- attachment create/read/delete authorization;
- call invitation and authenticated signaling admission;
- contact verification and changed-identity review.

Vodozemac, `CryptoSession` internals, message protocol, mailbox semantics, attachment/media encryption, call cryptography, and legacy behavior remain frozen.

## Test coverage

The reviewed tests now cover:

- valid and malformed public device creation;
- deterministic field/entry ordering;
- fixed SHA-256 commitment vector and changed epoch/device/state rejection;
- duplicate identifiers and unknown fields;
- lifecycle transition rules and revoked-authority rejection;
- immutable snapshots;
- rollback, stale, future, and next-epoch behavior.

## Validation evidence

- Targeted Phase 6B.1 Jest suite: passed (5 tests).
- Full Jest suite: passed (61 suites; 313 tests passed, 1 skipped).
- Service TypeScript check: passed.
- ESLint: passed.
- Client production build: passed.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: passed.

## Phase 6B.2 readiness

**NOT READY.** The Phase 6B.1 foundation has no identified parser, commitment, rollback, duplicate-ID, or lifecycle-validation vulnerability in scope. Phase 6B.2 must first implement and test the authenticated authority composition, same-epoch commitment-chain enforcement, explicit enrollment ceremony, durable atomic replay/list persistence, and fail-closed integration gates. Until those are complete, no trust-changing enrollment or recovery operation should be added.
