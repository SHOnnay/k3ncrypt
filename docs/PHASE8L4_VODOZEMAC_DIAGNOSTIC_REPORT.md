# Phase 8L-4 Vodozemac Inbound Session Diagnostic

## Diagnostic scope

No production cryptographic behavior was changed. A Rust/WASM test-only diagnostic was added for the exact recipient-first-message restart sequence.

## Result

`cargo test` passed all six crypto-wasm tests, including the new `restored_recipient_accepts_first_pre_key_message` test. It verifies a recipient can persist its account, restart, and accept a sender's valid first pre-key message.

Only public identity equality, a one-time-key identifier, and the Olm wire-message type are asserted. No private key, pickle, plaintext, or ciphertext content is logged.

## Browser replay metadata

The retained Mongo mailbox record was inspected only for routing metadata and envelope shape. It has the correct channel, recipient routing address, sender routing address, Vodozemac envelope version, and an Olm wire message with `version: 1` and `message_type: 0` (pre-key). The message is retained after client rejection.

## Failure category

The failure is neither a generic account-pickle restart failure nor an invalid pre-key wire format. It is an **integration-level restored recipient account/pre-key state mismatch**: the browser adapter's restored account rejects a valid pre-key envelope that the same WASM boundary accepts in the deterministic restart harness.

## Affected components

- `client/src/crypto/vodozemacModule.ts`
- `service/src/crypto/modernConversation.ts`
- browser IndexedDB-backed account lifecycle surrounding pre-key publication and receiver restart

## Root-cause hypothesis

The remaining hypothesis is that the browser conversation flow publishes a bundle from one account state and persists/restores a different effective state after key publication. The next diagnostic should compare the browser-published one-time-key identity against the restored account's public one-time-key set immediately before `establishInboundSession`, without revealing key material.

## Security posture

No crypto bypasses, fallback session creation, plaintext mailboxes, or relaxed validation were introduced. The browser replay remains fail-closed.
