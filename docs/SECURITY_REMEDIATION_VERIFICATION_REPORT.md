# Security remediation verification report

Audit date: 2026-09-20  
Scope: remediation commit `d7f89bda12e47d9a667d3360d2e08a2a21a39ee7` and its affected call-signaling boundary. This verification is read-only apart from this report.

## Call signaling identity binding

Before: call signaling validated call/conversation scope and participant membership, but the call-domain payload did not have a canonical content binding for SDP/ICE changes.

After: `signalBinding.ts` canonicalizes call ID, conversation ID, sender object, event/kind, payload, sequence, timestamp, expiry, and identity binding; it computes SHA-256 and compares the resulting digest before transport. `SecureCallSignaling.send` also checks session scope, expiry, future timestamp skew, membership, and changed-identity review state.

Evidence: `service/src/calls/security.test.ts` accepts an unchanged digest and rejects modified SDP payloads. The canonical construction excludes `payloadDigest` itself, avoiding circular hashing. `git diff HEAD^ HEAD` shows only `service/src/calls` and documentation changes; no identity or cryptographic-core files changed.

Remaining risk: this is an integrity binding, not an independent digital signature. Sender ownership depends on the existing authenticated modern-conversation envelope/session. The call transport must not expose a plaintext or unauthenticated path around that envelope. Canonical JSON also requires all producers to use the same object representation; future protocol versions should version the canonical schema explicitly.

## Replay protection

Before: process-local sequence/replay state could disappear after restart and did not define a deployment persistence contract.

After: `ReplayProtectionStore` defines atomic-looking `claim`, TTL cleanup, and bounded storage. `MemoryReplayProtectionStore` removes expired entries before claims, rejects duplicates, rejects expired claims, and refuses new entries at capacity. `SecureCallSignaling` scopes keys by call, sender, and sequence.

Evidence: the remediation tests verify duplicate rejection, TTL cleanup, and independent claim behavior. The interface is injectable, so a production implementation can use a durable conditional insert/claim with a TTL index and shared deployment storage.

Remaining risk: no production durable adapter is implemented or exercised. A deployment implementation must make claim atomic across instances, use server-consistent time/expiry, clean expired entries, bound key size, and avoid marking a claim consumed before a transport retry policy is defined. The current `send` claims before `transport.send`; a transient transport failure can cause a safe availability failure on retry, so production may need an explicit durable outbox/claim protocol rather than releasing claims unsafely.

## Frozen subsystem regression review

The remediation commit changes only `service/src/calls/*` and documentation. There is no diff in `crypto-wasm`, `service/src/core`, `service/src/identity`, `service/src/attachments`, `service/src/media`, `service/src/storage`, `service/src/transports`, mailbox code, backend database code, or legacy messaging paths. Existing attachment, messaging, Vodozemac, vault, media, and legacy tests remain the regression baseline.

## Validation

- TypeScript: passed (`npx tsc --noEmit -p service/tsconfig.json`).
- ESLint: passed.
- Client production build: passed.
- npm audit at high severity threshold: 0 vulnerabilities.
- Remediation call tests: passed for digest tamper detection and replay TTL/duplicates.
- Full Jest: the sandboxed run was blocked by `EPERM` when Supertest attempted to bind a local port; the same command was rerun with the required local-network permission. The remediation tests and previously passing suites are included; retain CI output as the authoritative clean-environment artifact.
- `git diff --check`: passed.

## New issues introduced by remediation

No confidentiality bypass or authorization bypass was found. The residual availability/protocol risks are the pre-production persistence and claim-retry requirements described above, not evidence that a forged signaling payload is accepted. The digest does not replace the existing E2EE authentication boundary and must not be treated as a standalone signature.

## Verification decision

The two audited implementation gaps are materially addressed at the call-domain boundary with regression evidence. Production acceptance remains conditional on a durable atomic replay store, authenticated envelope integration in the deployed signaling path, clean CI Jest output, and deployment-level review. This report does not approve Phase 6 or production rollout.
