# Phase 4 multi-device limitations

## Current behavior

K3ncrypt's modern 1-to-1 identity, Vodozemac account, sessions, contact pins, and verification records are held in a local encrypted vault on one browser device. An invitation establishes a conversation between the participating browser identities. The offline mailbox routes opaque envelopes to the established recipient; it is not a device directory or a synchronization service. Verification is local to the observing device. A changed contact identity becomes pending review and cannot inherit the previous verified state.

Phase 4 does not implement device enrollment, device lists, cross-device session fan-out, transfer of private identity material, revocation, or recovery from a lost device. The QR verification payload contains only a public fingerprint; it cannot authorize another device or restore a vault.

## Security limitations

- A second device must not be treated as the same verified identity merely because it uses the same account name, invitation, or relay room.
- Copying a vault or session across devices could duplicate ratchet state and create message-loss, replay, or compromise risks. No such copying is supported.
- A newly observed device identity is unverified until an independent comparison; an identity change on one device does not imply authorization by another.
- Offline messages are not automatically distributed to multiple devices. Delivery, acknowledgment, deduplication, and deletion semantics would need a device-aware protocol review.
- Loss of the only device can mean loss of identity and local encrypted state. No server-side key escrow or recovery shortcut exists.
- The relay can observe device connections, timing, and routing metadata even though it cannot decrypt modern message content.

## Requirements before future multi-device work

1. Define explicit, authenticated device enrollment and user-visible device inventory. Pairing must bind each device's public identity to an independently verified participant identity, with no secret in a public QR payload.
2. Define per-device verification and identity-change semantics. A verified state must not be copied to a new key or silently restored after revocation.
3. Specify per-device Vodozemac sessions and encrypted fan-out without sharing or cloning ratchet state. Preserve fail-closed downgrade and replay protections.
4. Define revocation, lost-device recovery, offline queue targeting/ACKs, and deletion guarantees under partial connectivity and server restart.
5. Review vault export/import, backup, and recovery threats separately; never place private keys, pickles, or recovery secrets in the relay, URLs, logs, or QR verification data.
6. Add adversarial tests for concurrent devices, stale/revoked devices, key changes, mailbox replay, partial delivery, and rollback before deployment.

This document is a design boundary only. It does not enable multi-device operation or authorize changes to the Phase 3 security core.
