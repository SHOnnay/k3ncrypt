# FIFO mailbox head observability (M3, delivery semantics unchanged)

## What the warning means

Each successful atomic mailbox claim increments additive `deliveryAttempts` metadata. Existing active rows without this field are treated as zero and acquire a value of one on their next claim. No index, migration, envelope change, ACK behavior, FIFO ordering, terminal-state behavior, or seven-day expiry change is required.

The application emits `offline_mailbox_fifo_head_delayed` after a successful claim when the FIFO head has at least 5 claims or is at least 15 minutes old. Fields are limited to `transport` (`legacy` or `mux`), bounded `attempts`, `ageMinutes`, and a coarse `reason`. Logs contain no room/account/device/message identifiers, ciphertext, plaintext, capabilities, keys, or envelope data. Warnings are deduplicated process-wide to at most one per minute. The metadata increment is atomic with claim ownership; a lost ACK or crash does not remove the record or falsely accept it.

This is opportunistic detection: it runs when a recipient transport is actively claiming the mailbox. It does not add a background worker and cannot announce an old mailbox head while no recipient reconnect/replay is occurring.

## Operator runbook

1. Search sanitized service logs for `offline_mailbox_fifo_head_delayed`; note only transport, attempt count, age and warning time. A warning is an investigation signal, not proof of corruption or permission to bypass FIFO.
2. Check service health, Mongo availability, delivery ACK timeout/error categories, device authorization status and reconnect history for the same window. Do not copy payloads or identifiers into shared logs or tickets.
3. If authorized database access is available, use a restricted read-only session and a private terminal. Inspect only the oldest active unexpired row's `timestamp`, `deliveryAttempts`, `claimedUntil`, and `expiresAt`; exclude `_id`, account/routing identifiers, sender, and `envelope` from projections/output. Compare its lease with current time and verify whether the head has expired. Never edit, delete, ACK, terminally reject, reorder, or skip the head as an operational shortcut.
4. Restore the recipient's authorized connection or repair the underlying transient service condition. Let existing lease-expiry/replay retry the same FIFO head. Verify recipient acceptance precedes ACK/deletion and the next row is attempted only after the head is accepted, validly terminally rejected under existing rules, or expires under its unchanged seven-day TTL.
5. Escalate a persistent head to a separately approved mailbox lifecycle review. This implementation deliberately has no quarantine or message-skipping policy.
