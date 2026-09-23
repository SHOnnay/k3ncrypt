# Phase 8L-5 Browser Pre-key State Report

## State comparison performed

Two restart-sensitive Vodozemac sequences were exercised in the test-only WASM harness:

1. Persist a recipient account after pre-key publication, restart it, then accept the sender's first pre-key message.
2. Do the same, but replenish and mark twenty additional keys as published before accepting the retained first message. This mirrors the browser restart branch that renews a low key pool.

Both cases pass. The restored account preserves its public identity and accepts the first `message_type: 0` Olm pre-key message. Replenishment does not invalidate a previously published one-time key in the underlying Vodozemac account.

## Browser storage trace

The application persists the Vodozemac account under `vodozemac-account/local` inside the encrypted IndexedDB vault. The account is saved after initial key publication. On restart, the same vault unlocks, the same account record is loaded, and no inbound conversation session is expected before the first message. The browser mailbox envelope is confirmed to target the expected room and to be a pre-key message.

## Observed state difference

No state mismatch has been reproduced at the Vodozemac account or pre-key lifecycle layer. Continuous and restored account behavior are equivalent in the diagnostic harness, including the restart replenishment branch.

## Root-cause status

The failure remains isolated to the browser application's integration path, after mailbox dispatch and before successful inbound session completion. The next diagnostic must instrument the browser-side adapter with test-only public state fingerprints at the exact call site, then compare:

- the recipient identity fingerprint derived from the restored browser account;
- the sender identity fingerprint and recipient one-time-key identifier from the active browser pre-key bundle;
- the receiver's local public one-time-key identifier set.

The current wrapper exposes key values but not stable public key identifiers, so this comparison cannot yet be made without a narrow test-only adapter method.

## Affected files

- `service/src/crypto/modernConversation.ts`
- `client/src/crypto/vodozemacModule.ts`
- `service/src/identity/vodozemacBundle.ts`
- `crypto-wasm/src/lib.rs`

## Safest correction

Do not alter production crypto behavior until the browser adapter state comparison identifies a concrete mismatch. The existing fail-closed response and retained encrypted mailbox item remain correct.
