# Phase 6 Final Wiring Closure Report

## Scope

This closure pass connected the existing recovery and group security components to product-facing runtime boundaries, hardened plaintext strategy selection, and extended the encrypted-vault compare-and-swap concurrency evidence. It did not change Vodozemac, CryptoSession algorithms, message or mailbox encryption, attachment encryption, or media encryption.

## Recovery runtime integration

`RecoveryRuntime` is now the single public recovery composition exported by the service SDK:

```text
Explicit client action
  -> AuthenticatedRecoveryAuthority
  -> encrypted RecoveryArchive verification
  -> RecoveryCeremony replay/expiry state
  -> explicit replacement confirmation
  -> RecoveryIdentityReplacementWorkflow
  -> old-device invalidation and contact-trust reset
```

The archive remains protected by user-owned material. The runtime receives no server recovery key and exposes no administrator bypass. It requires a separate authenticated account authority before staging, verifies/decrypts the archive through the established archive boundary, zeroes recovered plaintext, and only completes persistence after trust replacement succeeds.

Integration coverage includes valid recovery, modified archive rejection, archive replay rejection, and unauthorized recovery rejection.

## Group security runtime integration

`GroupSecurityRuntime` now composes persisted group state, issued authenticated device contexts, membership protocol validation, authorization, CAS state mutation, and key rotation. It is exported through the public service SDK.

```text
Authenticated device/CryptoSession context
  -> actor identity binding
  -> persisted current group snapshot
  -> event digest, expiry, epoch and replay validation
  -> administrator authorization
  -> CAS membership mutation
  -> key rotation/member-key removal
```

The runtime does not accept a caller-supplied actor identity as authority: the event actor must match the identity in an issued device context. State is loaded from persistence rather than accepted as the mutation authority. The existing add authorization rule was narrowed so a new target need not already exist, while activate/remove still require an existing member.

Integration coverage includes authorized add/activate/remove, key rotation, removed-member invalidation, unauthorized actor rejection, stale epoch rejection, and replay rejection.

## Production encryption strategy hardening

The disabled/plaintext strategy is now rejected unless both conditions hold:

1. the runtime is not production; and
2. `developmentAllowInsecurePlaintextStrategy: true` is explicitly configured.

Production rejects the strategy even if the development-only flag is supplied. Secure encryption remains the default. Custom encrypted strategy registration remains unchanged.

## Storage concurrency validation

The real encrypted-vault CAS test uses two independently unlocked `BrowserSecureStorage` instances over the same persistence adapter. Concurrent multi-record writes verify that:

- exactly one commit succeeds;
- lifecycle-style state/high-water records remain identical;
- the losing/stale value never becomes durable; and
- subsequent stale CAS attempts fail.

## TypeScript reproducibility

WebCrypto call sites in device-list commitments, lifecycle authorization digests, group event digests, recovery archives, and sync digests now pass owned `ArrayBuffer` values. This preserves the algorithms while resolving current TypeScript `BufferSource` declaration incompatibilities. The service SDK now emits both JavaScript and declarations successfully.

## Files added

- `service/src/recovery/runtime.ts`
- `service/src/recovery/runtime.test.ts`
- `service/src/groups/runtime.ts`
- `service/src/groups/runtime.test.ts`
- `docs/PHASE6_FINAL_WIRING_CLOSURE_REPORT.md`

## Files updated by this closure pass

- `service/src/recovery/index.ts`
- `service/src/groups/index.ts`
- `service/src/groups/membership.ts`
- `service/src/crypto/registry.ts`
- `service/src/crypto/registry.test.ts`
- `service/src/public/types.ts`
- `service/src/sdk.ts`
- `service/src/sdk.test.ts`
- `service/src/devices/securityClosure.test.ts`
- `service/src/devices/canonicalEncoding.ts`
- `service/src/devices/lifecycle.ts`
- `service/src/groups/protocol.ts`
- `service/src/recovery/archive.ts`
- `service/src/sync/codec.ts`

Other modified/untracked Phase 6C files were already present in the working tree and were preserved.

## Validation

| Validation | Result |
|---|---|
| Jest | Passed: 80 suites, 387 tests; one Mongo-dependent test skipped |
| Service TypeScript | Passed |
| ESLint | Passed |
| Client production build | Passed; 206 modules transformed |
| Service production SDK/declarations | Passed |
| npm audit | Passed; zero vulnerabilities reported |
| git diff --check | Passed |

## Remaining limitations

- Platform deployments must provide durable production implementations for recovery persistence, authenticated recovery authority, group persistence, and group key management. The runtime refuses to replace those boundaries with server-created trust.
- Recovery UI/file-selection presentation was not added; this task exposes the secured product API without redesigning UI.
- Group transport delivery remains responsible for producing the issued authenticated device context; the runtime does not accept raw network identity fields.
- Recovery persistence still defines claim/stage/complete as adapter operations. A production adapter must make its replay claim and stage transition crash-safe and idempotent.
- Existing Phase 6 adversarial-audit findings outside the four requested closure tasks were not redesigned in this pass.

## Closure statement

The requested security features are now reachable through public runtime compositions rather than as disconnected helper classes. Their trust decisions remain delegated to authenticated device/recovery authorities and durable adapters, with fail-closed behavior when those boundaries are unavailable.
