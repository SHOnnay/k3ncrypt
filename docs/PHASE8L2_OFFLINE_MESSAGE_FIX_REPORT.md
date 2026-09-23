# Phase 8L-2 Offline Message Replay Report

## Trace result

The sender creates a Vodozemac encrypted envelope, the relay persists that opaque envelope with its channel and recipient routing address, and the recipient's authenticated join claims it from MongoDB. The message is not removed early: it remains in `offline_messages` with its short claim lease when the client rejects it.

## Changes made

- The relay now waits for an explicit client acceptance callback before deleting a replayed mailbox entry.
- The client acknowledges only after its existing envelope validation and message handler return success.
- Reconnect replay no longer deadlocks on the conversation tab lock: the serialized replay handler can run while `connect()` owns that lock.

These changes preserve encrypted envelopes, durable device proofs, routing ownership checks, and fail-closed validation.

## Validation

- Focused Socket.IO and mailbox tests passed: 3 suites, 28 tests.
- Mongo-backed Chromium test reached the reconnected conversation screen.
- The same test still fails to display the queued message because the first inbound envelope is rejected by the client validation path. Mongo inspection confirms the opaque envelope remains retained rather than being deleted.

## Remaining blocker

The end-to-end offline-message scenario is **not yet passing**. The outstanding failure is the recipient's first inbound Vodozemac-session acceptance after restart. No plaintext fallback, capability fallback, or trust bypass was added. Android work must remain blocked until this cryptographic-session interoperability failure is corrected and the full browser regression succeeds.
