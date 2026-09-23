# Phase 8L-9 Browser Pre-key Comparison Report

## Captured browser comparison

The Mongo-backed Chromium scenario ran with the diagnostic flag injected before application navigation. The captured public snapshots show:

| Field | Before recipient shutdown | After restore, before inbound acceptance |
| --- | --- | --- |
| Recipient identity fingerprint | Same | Same |
| Available one-time-key identifiers | Empty | Empty |
| Available key count | 0 | 0 |
| Retained envelope protocol | — | Olm wire version 1 |
| Retained envelope type | — | Pre-key (`message_type: 0`) |

The recipient identity is stable across restart. The empty available-key set is expected after `markKeysAsPublished`; the Rust restart and replenishment diagnostics demonstrate that this does not itself remove the account's ability to accept a previously published pre-key message.

## Comparison result

No identity rotation, routing mismatch, malformed envelope, or observable one-time-key replacement was found. The browser-specific inbound rejection remains after the same public state is restored.

## Next fix location

The next evidence needed is the sender-side selected key identifier from the active invitation flow. The Playwright diagnostic harness now captures that sender snapshot as well. Comparing it with the server bundle and receiver account's internal published-key state requires a Vodozemac-side public identifier for *published* keys, because `oneTimeKeys()` intentionally reports only available unpublished keys.

## No cryptographic change

No encryption, session-acceptance, Vodozemac validation, or trust behavior was modified. The offline replay regression remains failing and should continue to block Android work.
