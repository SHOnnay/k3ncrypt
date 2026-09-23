# Phase 8L-3 Inbound Crypto Session Trace

## Recipient state before restart

1. The creator generates a Vodozemac account and persists its encrypted account pickle in the browser vault as `vodozemac-account/local`.
2. Its public identity and one-time keys are published to the pre-key service; publishing persists the account after `markKeysAsPublished`.
3. The creator has no conversation session before the peer sends the first message. This is expected: the first received pre-key envelope must create the inbound session.
4. The browser vault persists encrypted records in IndexedDB. The Vodozemac pickle key is deterministically derived from the unlocked vault master key, so the same local passphrase restores the same account identity.

## Recipient restart sequence

1. The new `ModernConversation` unlocks IndexedDB storage and restores `vodozemac-account/local`.
2. It restores the same public identity fingerprint and its local routing address from the conversation mode record.
3. No `vodozemac-session/<room>` record exists yet, as expected for an inbound-first conversation.
4. The client authenticates its relay join with its durable device proof and routing proof.
5. The relay claims the opaque mailbox item and dispatches it to the already-installed transport handler.
6. The handler calls `ModernConversation.receive`. With no active session it fetches the sender bundle and calls `VodozemacRuntime.establishInboundSession` using the sender Curve25519 identity and the pre-key message.
7. That operation returns rejection. The transport correctly reports `accepted: false`; Mongo retains the encrypted record under its lease and the UI receives no message.

## Confirmed race fixed during trace

The initial acknowledgement implementation deadlocked because `connect()` held the tab lock while waiting for replay acceptance, while the replay handler tried to acquire the same lock. The handler now uses the active connection lock context during that narrow interval. The recipient reaches the conversation screen after reconnect.

## Exact remaining failure boundary

The remaining failure is inside the Vodozemac inbound-session creation boundary, before plaintext framing or UI insertion. It is not caused by Mongo persistence, routing identity, device proof, replay deletion, or UI state.

## Affected components

- `service/src/crypto/modernConversation.ts` — selects inbound pre-key processing when no session exists.
- `service/src/crypto/vodozemacRuntime.ts` — wraps the inbound Vodozemac account operation.
- `client/src/crypto/vodozemacModule.ts` — adapts browser WASM account inputs.
- `crypto-wasm/src/lib.rs` — parses the pre-key wire message and calls Vodozemac.

## Proposed next diagnostic and fix boundary

The current transport deliberately suppresses the inbound validation error to prevent sensitive envelope details from being logged. The next step is a test-only integration harness that captures the typed failure category at `establishInboundSession` and compares the persisted account identity and claimed one-time key against the sender's pre-key message. Only then should a minimal restoration-boundary correction be made. No production crypto behavior has been changed as part of this investigation.
