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
| Receiver dies after persisted ratchet but before content | Valid ciphertext cannot be reprocessed and message is lost | One durable acceptance/recovery boundary spanning ratchet, message and dedupe; real Vodozemac restart fault test at R1/R2 |
| Sender dies after ratchet but before outbox | Ciphertext has no durable retry record | Model S1 as unresolved local send; design safe recovery without falsely claiming queued delivery |
| Acceptance journal ambiguity | Premature dedupe suppresses undelivered content or leaked recovery material | Journal only encrypted bounded records, coordinate with ratchet mutation, define recovery and corruption behavior before choosing write-ahead design |

## Explicit exclusions

No VPN/IP tunnel, federation, helper-node network, account identity migration, offline first-contact pairing, automatic trust, crypto rewrite or weakening of relay authorization.

## Phase 1G: envelope identity and correlation risks

The selected v1 identity is a public deterministic digest, not a MAC or signature. Its conversation binding reduces accidental cross-conversation aliasing; it does not prove that the sender is a member of that conversation. An attacker able to inject or alter transport metadata cannot make a message valid by supplying a matching ID. Receivers must derive the identity from the strictly validated envelope and authenticated conversation context, and must keep trust/session checks authoritative.

| Threat | Impact | Required control / test |
|---|---|---|
| JSON canonicalization mismatch | Web and Android disagree on duplicates; cross-path retries may be decrypted twice or incorrectly treated as new | Hash only exact validated `olmMessage` UTF-8 bytes with the canonical conversation ID and fixed domain/length encoding; run shared fixtures in both implementations. |
| ID substitution or forged ID field | A transport-supplied ID could alias another pending/accepted envelope and suppress delivery or clear outbox state | Recompute locally; do not trust an adapter-provided ID. A future receipt must be authenticated and bind the derived ID, conversation and expected peer device. |
| Cross-conversation replay/collision | Same ciphertext identifier could suppress or correlate unrelated conversations | Include the exact conversation identifier in the domain-separated construction; test distinct conversation vectors. Existing cryptographic sender/conversation validation remains required. |
| Cleartext cross-path correlation | Relay, LAN observers, or direct-path observers can correlate the same ID across retries and networks | Keep ID local in v1. Do not place it in cleartext headers, logs, or analytics absent a separate privacy decision. |
| Replay after marker expiry/eviction | Previously accepted ciphertext is decrypted again after its dedupe record disappears | Bound retry/mailbox lifetime and ID retention together. Do not evict eligible IDs under pressure; expire delivery eligibility before dedupe state. |
| Legacy/new namespace confusion | Old 64-hex digest may be mistaken for v1 or overwritten, causing duplicate acceptance or permanent suppression | Version new values (`v1:`), dual-read legacy and v1, preserve old formats, and never infer a v1 value from a legacy digest. |
| Hash collision | Two different envelopes map to one ID, suppressing a legitimate message | Use SHA-256 over domain-separated unambiguous length-prefixed bytes; test encoding and conversation binding. Residual cryptographic collision probability remains negligible but the digest is not a trust primitive. |
| Receipt replay or stale receipt | Old authenticated receipt could clear a newer pending item or be applied to wrong device/conversation | Bind receipt to version, conversation, expected peer device, exact pending ID and roles; require idempotence and reject unknown/expired IDs. |
| Resource exhaustion | Huge input or unbounded accepted-ID state consumes CPU/storage | Apply existing strict envelope size limits before hashing; specify ID count/time limits and fail safely rather than evicting live dedupe records. |

An envelope ID is stable only for one exact encrypted envelope. Re-encryption, even for the same plaintext, yields a different ID; sender-assigned logical-message IDs or hybrid identities would require a separate authenticated message-format decision and threat review.

## Phase 1I: capability negotiation risks

Capabilities describe declared implementation support and possible protocol operations. They do not authenticate a device, establish trust, authorize relay access, prove path reachability, or provide delivery evidence. See ADR 0008 for the model and unresolved wire decisions.

| Threat | Impact | Required control / test |
|---|---|---|
| Relay strips or rewrites an optional offer | Forced fallback, mismatched control parsing, or attempted downgrade | Bind both complete offers and the selected intersection to a fresh authenticated transcript before relying on it; unauthenticated metadata can only disable an optional feature, never select a weaker security mode. Test stripping and alteration. |
| Malicious peer overclaims support | Unsupported control frame could damage session processing, or a fake receipt/path feature could be treated as evidence | Treat claims as untrusted even after peer authentication; send only after authenticated selection and local policy approval; parse failures affect only the optional feature and must not mutate trust/session state. Test an authenticated peer that lies. |
| Old relay rejects a newly advertised ID | Client cannot join, causing availability failure during rolling deployment | Define server-first or versioned-envelope rollout and test old/new client × old/new relay combinations before registering a wire ID. Current relay rejects unknown join feature IDs. |
| Missing, unknown, malformed, or duplicate capability | Peers disagree on controls or accidentally infer support | Missing means relay baseline only; reject unknown/malformed/conflicting optional negotiation under fail-closed parsing and fall back to the authorized relay baseline; keep bounded parsing and explicit versioning. Test each form. |
| Stale/replayed capability selection | A past device/session capability is reused after reconnect, revocation, identity change, or version change | Bind offers and selection to the current conversation, expected peer device, fresh context, and session; invalidate on reconnect/session replacement and identity/trust lifecycle changes. Test replay and invalidation. |
| Peer capability confused with relay capability | Peer data could alter mailbox or room authorization | Keep service capabilities under a distinct relay identity and authorization channel. Peer offers never affect relay proofs, room membership, or mailbox rules. Test that the authorization path is unchanged. |
| Capability inventory leaks platform/version data | Enables fingerprinting or unnecessary disclosure of local features | Advertise only bounded necessary identifiers; do not include addresses, candidates, names, keys, or device inventory; defer user-opt-in and privacy-sensitive disclosure decisions. Review logs and serialized metadata. |
| Voice WebRTC mistaken for direct data transport | Product or policy may assume a nonexistent envelope path | Model voice-call support, data-channel implementation, ICE reachability, and path health as separate facts. Test that call capability alone never enables direct message delivery. |

Downgrade rule: optional negotiation failure returns to the already-authorized relay baseline without changing identity, verification, encryption, session state, message acceptance, or ACK semantics. If a future operation explicitly requires an optional capability, reject that operation rather than silently changing its security properties. No capability negotiation implementation is authorized by Phase 1I.
