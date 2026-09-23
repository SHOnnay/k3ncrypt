# Phase 8L-20 Runtime Stage Fix Report

## Result

The Mongo-backed Chromium offline replay scenario passes. A recipient can restart before receiving its first encrypted message, reconnect, establish the inbound Vodozemac session, persist the resulting state, acknowledge mailbox delivery, and display the message once.

## Runtime trace result

The guarded runtime trace reached `returned`:

1. `input-ready`
2. `wasm-called`
3. `wasm-returned`
4. `session-created`
5. `session-serialized`
6. `returned`

This ruled out a WASM call hang, session creation failure, and crypto persistence failure. The message was lost after inbound session return.

## Root cause and correction

The conversation creator has no identity commitment for the invitee before the invitee sends a first message. After a valid pre-key session was established, `ModernConversation.receive()` called `observe()` with no commitment. `observe()` rejected the otherwise authenticated initial identity, so the client did not acknowledge the mailbox item or update the UI.

`ModernConversation` now permits the first peer identity to be recorded only after Vodozemac has successfully authenticated the inbound pre-key message. The record is explicitly **unverified**. Invitation-bound identities continue to require their commitment, and an existing contact identity still rejects a changed identity pending explicit review.

The client also now refreshes the durable contact record after replay. This prevents the pre-replay connection snapshot from overwriting the contact discovered during replay.

The runtime diagnostic hook remains guarded by `__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__`; it returns public state only. Production error handling no longer calls that test-only hook.

## Security properties retained

- Vodozemac pre-key validation remains mandatory before first-contact persistence.
- First contacts remain unverified until the user compares fingerprints.
- Existing contacts retain strict identity pinning and changed-identity review.
- Failed envelopes are not acknowledged; mailbox deletion remains conditional on acceptance.
- Duplicate envelope handling continues to use the durable seen-record guard.
- Device trust, sender routing, and relay proof checks were not changed.

## Validation

| Check | Result |
| --- | --- |
| Mongo-backed Chromium offline replay | Passed: 1 test |
| `npm run lint` | Passed |
| `npm run client:build` | Passed |
| `npm run build-service-sdk` | Passed |
| `npx jest --runInBand --detectOpenHandles` | Passed: 96 suites / 429 tests; 2 suites and 4 tests skipped by their existing configuration |
| Focused crypto, conversation, and relay tests | Passed: 3 suites / 19 tests |
| `git diff --check` | Passed |

The focused Jest command emitted pre-existing coverage collection warnings for the client Vite/WASM aliases, but all selected tests passed. The production client build succeeded.

## Remaining limitations

This validates Chromium with a local MongoDB relay. It does not establish cross-browser interoperability, TURN-mediated connectivity, or production-scale relay behavior. The first inbound peer remains a trust-on-first-use contact and must be fingerprint-verified before users rely on a verified identity relationship.
