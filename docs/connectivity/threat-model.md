# Connectivity overlay threat model

## Assets and boundaries

Assets: plaintext, Olm session state, device signing keys, contact verification records, route associations, lifecycle freshness, encrypted outbox/mailbox, and user network-address privacy. The relay is authorized for its own room/mailbox operations; it is not an authority for human contact trust. Paths carry ciphertext and metadata; an admitted transport does not replace E2EE.

## Threats and required controls

| Threat | Impact | Required control / test |
|---|---|---|
| LAN spoofing or rogue discovery | Route substitution, probing, denial of service | Discovery is hint only; pinned identity and reviewed PeerAdmission before envelopes; rate/frame/concurrency bounds |
| Conversation/device substitution | Ciphertext delivered under wrong peer context | Bind both device identities and conversation to admission transcript; reject wrong route; no metadata creation from hints |
| Replay across LAN/relay/direct | Duplicate UI, ratchet desynchronization | Shared path-independent envelope ID; one session owner; duplicate recognized before second decrypt |
| Lost/forged receipt | Pending item falsely cleared | Receipt authenticated, bound to exact ID/conversation/peer; raw adapter ACK never qualifies |
| Stale revocation offline | Revoked device may remain locally unaware | Preserve freshness enforcement; fail closed when evidence required; explicitly document inability to know unseen updates |
| Direct/LAN IP exposure | Peer or observer learns network addresses and timing | Opt-in disclosure policy before candidate gathering; relay-only default; minimize/log no candidates |
| Malicious TURN/helper | Metadata observation, drop/replay attempts | E2EE envelope; strict admission/receipt binding; keep helper nodes out of current phases |
| Version mismatch/downgrade | Old parser rejection or unsafe control handling | Advertised feature gate; transcript version binding; unknown controls rejected without session damage |
| Path failure/race | Lost or duplicate sends, session races | Persist once, same-envelope retry, shared dedupe, bounded retry and single owner |
| Storage/backend fault | False quota result, mailbox loss or resource exhaustion | Phase 0 reproduce and document; separate hardening branch; atomic quotas if approved |
| Relay or path forges completion | Sender discards an envelope before peer persistence | Keep submitted/mailbox/receiver evidence separate; only a validated peer-authenticated receipt can establish `peer-persisted`; receipt must match expected device, conversation and pending envelope |
| Crash between ratchet, content and dedupe writes | Message loss, duplicate content or unrecoverable retry | Review actual shared transaction boundaries; inject crashes at CP1–CP6 and restart with real session state before enabling multipath |
| ACK loss or duplicate live/mailbox attempt | Ambiguous outcome or duplicate decrypt | Treat timeout as unknown; resend identical ciphertext; common pre-decrypt dedupe after successful durable acceptance; duplicate receipts idempotent |
| Stale/cross-conversation receipt or ID collision | Wrong pending record removed or state falsely promoted | Domain-separated conversation-bound envelope ID; strict pending-set lookup, peer binding, bounded retention and versioning; reject unknown/expired/mismatched receipts |
| Replay after seen-window eviction | A previously accepted envelope reaches decrypt again | Measure maximum mailbox/retry lifetime against 1,024-entry Web seen set; approve bounded retention/expiry before multipath |

## Explicit exclusions

No VPN/IP tunnel, federation, helper-node network, account identity migration, offline first-contact pairing, automatic trust, crypto rewrite or weakening of relay authorization.
