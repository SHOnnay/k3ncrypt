# Phase 8L-17 Offline Replay Final Validation Report

## Result

The Mongo-backed Chromium offline replay regression does **not** pass yet. The recipient completes authenticated admission and requests mailbox replay after the connection transition, but the queued first message is not rendered.

## Verified stages

- authenticated relay admission;
- post-connection mailbox replay request;
- encrypted envelope retrieval and retention;
- device trust validation;
- sender-bundle retrieval and identity pinning;
- restored runtime entry with an identity-restored account, loaded WASM bindings, sender identity, and pre-key message present.

The retained message remains a valid Olm pre-key envelope. It is not deleted because the client does not return acceptance.

## Root cause status

The original join/replay lock coupling was corrected, but a separate incomplete inbound-session completion remains. The browser test reaches the Vodozemac inbound-session boundary and does not finish message acceptance during the test window. No evidence supports relaxing Vodozemac, identity, trust, persistence, or replay checks.

## Security impact

The implementation remains fail-closed: invalid or incomplete processing cannot display a message or delete the encrypted mailbox record.

## Remaining limitation

Offline first-message delivery after recipient restart remains a beta blocker. Phase 8L cannot be marked complete and Android work should remain blocked until the browser regression passes.
