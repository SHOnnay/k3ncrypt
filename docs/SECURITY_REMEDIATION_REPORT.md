# Security remediation report

## Call signaling identity binding

Finding before: signaling checked call/conversation identifiers and participant membership but did not integrity-bind SDP/ICE payload content to the authenticated call context.

After: a canonical payload digest covers call ID, conversation ID, sender identity reference, event, payload, sequence, timestamp, expiry, and identity binding. The existing encrypted conversation envelope remains the authentication/ownership boundary; no parallel identity or signing system was introduced.

Validation: valid digest accepted; modified SDP/ICE rejected; identity and changed-review states rejected by call authorization; expired/future-skewed payloads rejected.

Remaining risk: digest integrity depends on the existing authenticated E2EE signaling envelope. Production must not expose an unauthenticated route around it.

## Replay protection

Finding before: process-local call replay state disappeared on restart.

After: `ReplayProtectionStore` defines TTL cleanup, bounded capacity, duplicate claims, and a persistence boundary. `MemoryReplayProtectionStore` is deterministic for tests; production must provide durable atomic claims shared across instances.

Validation: duplicate claims reject, expired entries are removed, and independent call sequence keys do not collide.

Remaining risk: no production adapter is enabled by this remediation; deployment must choose and review one before multi-instance call signaling.

## TypeScript reproducibility

Finding before: clean-install dependency updates could expose WebCrypto `BufferSource` typing mismatches.

After: the current service type check completes without broad `any` casts; validation included a clean `npm ci` attempt followed by the service TypeScript check.

Remaining risk: lockfile/dependency installation and browser host availability still need CI artifact evidence.

## Regression scope

Existing Phase 3 messaging/Vodozemac, Phase 4 attachment/media, and legacy behavior were not changed. New tests cover signaling tamper, replay, expiry, identity binding, and call authorization.
