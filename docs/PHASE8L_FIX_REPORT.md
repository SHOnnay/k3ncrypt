# Phase 8L Fix Report

## Fixed blockers

### Invitation creation feedback and retry

The invitation UI now distinguishes an unavailable or incorrect backend from a generic creation failure. HTTP `404`, `502`, `503`, and `504` responses, plus network failures, receive actionable messages without exposing backend internals. The legacy invitation view presents a retry action while no invitation has been created.

### Modern-device bootstrap wiring

`ModernConversation` now invokes the existing signed first-device bootstrap flow when a local account binding does not yet exist. The resulting durable account reference and trust epoch are installed before the relay is joined. New local device identifiers use UUIDs, matching the durable authority contract. This connects the existing client identity, Vodozemac signing boundary, and durable authority; it does not add a capability fallback.

### Relay join ordering and test alignment

Socket relay joins now wait for the server acknowledgement, which is sent only after channel admission and offline mailbox dispatch have completed. Rejection paths acknowledge with a safe error. Existing socket, transport-manager, SDK, sync-relay, and modern-conversation fixtures were updated to model the current proof-aware, acknowledgement-based contracts.

## Validation

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run client:build` | Passed |
| `npm run build-service-sdk` | Passed |
| `npx jest backend/security --runInBand --coverage=false` | 7 suites / 16 tests passed; 1 Mongo-environment suite / 3 tests skipped |
| `npx jest --runInBand --coverage=false --detectOpenHandles` | 96 suites passed; 429 tests passed; 2 suites / 4 Mongo-environment tests skipped; no open-handle report |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | Passed |

The skipped suites require an explicitly configured MongoDB integration environment and were not replaced by mocks.

## Remaining limitation

The Mongo-backed Chromium modern-conversation scenario now gets through new-device identity bootstrap, but an encrypted message queued while the recipient is offline is still not displayed after that recipient reconnects. The relay join acknowledgement removed an ordering race, but did not resolve the mailbox replay failure. This remains a **high beta blocker** for reliable offline message delivery and must be resolved before Android work begins.

Browser tests run without Mongo lifecycle configuration also fail closed at durable-proof admission, as intended. A beta test/deployment environment must provide MongoDB and the device-trust proof secret; the product must not silently fall back to capability authorization.
