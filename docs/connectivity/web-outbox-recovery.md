# Stage 1: Web outbound session/outbox recovery

Branch: `connectivity/web-outbox-recovery`
Base: `connectivity/stage0-contract-hardening` at `f123519c2f77df36948e501306f0148befc8c21d`

## Scope and invariant

Stage 0 established three narrow correctness guards on this branch: authenticated peer metadata repair requires the saved identity commitment; a queued tab operation rechecks its lease after entering the Web Lock; and a resumed lease heartbeat cannot overwrite a newer owner. Stage 0 also characterized that the Web sender persisted a mutated Vodozemac session separately from its outbox envelope.

This stage addresses only Web outbound encrypted message/control-envelope recovery. The invariant is:

> On the production `ModernConversation` user-message and join-introduction send paths, the durable session snapshot must not advance unless the exact resulting encrypted envelope and its local recovery metadata become durable in the same storage transaction.

On transaction failure, the runtime restores its in-memory ratchet only when the durable session still equals the exact snapshot from which this runtime encrypted. If another writer advanced that snapshot, this runtime fails closed and quarantines its session rather than overwriting the newer state.

## Previous failure and resulting state machine

Previously, `ModernConversation.sendUnlocked()` encrypted first. `VodozemacRuntime.encrypt()` wrote an interruption marker, advanced and persisted `vodozemac-session`, removed the marker, and returned an envelope. Only then did the conversation write `modern-outbox`. An outbox write failure therefore left an advanced persisted session with no recoverable ciphertext for that attempted message. Retrying a *durably queued* item already reused its stored ciphertext; retrying the failed application send created a different logical send.

The new outbound sequence is:

1. Validate the existing trust/device/contact preconditions, ensure the outbound session is established and persisted, and read the current outbox bytes.
2. Encrypt the message in memory.
3. Ask the existing encrypted `SecureStorage.compareAndSwapRecords` boundary to atomically compare the exact saved session snapshot and outbox snapshot, then replace both with the advanced session and outbox containing that envelope. Renewal correlation metadata, when applicable, is included in this transaction. The existing join-introduction control record is also committed atomically with its session advance.
4. Dispatch only after the atomic commit succeeds. The relay retry path reads the durable outbox and sends the stored envelope unchanged.
5. Record an attempt's existing relay ID and timestamp with an outbox compare-and-swap. Existing `delivered` handling removes a matching item with a compare-and-swap; its meaning is unchanged.

The session pickle and outbox are both stored through the existing encrypted secure-record layer. IndexedDB performs the underlying record replacements in one readwrite transaction. No migration or record-format change is required. Runtimes without multi-record CAS fail before message encryption.

The lower-level `VodozemacRuntime.encrypt()` remains the existing session-only mutation path for non-outbox operations and direct low-level callers; it is not the application message-send API. This work does not make signaling/receive operations atomic or fence every possible direct runtime caller. New application message sends must go through `ModernConversation`'s atomic method.

## Crash and failure behavior

| Interruption point | Durable result and recovery |
|---|---|
| Before encryption | Existing session and outbox remain unchanged. |
| After in-memory encryption, before transaction commit | Durable rows remain unchanged. A reload restores the old session and there is no phantom outbox item. A live runtime reloads its old pickle only if storage still contains that exact snapshot. |
| IndexedDB abort during commit | Both writes abort together. The prior session remains usable for a later send; no envelope is queued. |
| Commit succeeds, before dispatch | The advanced session and exact envelope are durable together. Conversation startup/retry can dispatch the stored envelope without encrypting again. |
| Dispatch throws/fails | The committed envelope remains pending and is retried unchanged. |
| Dispatch returns, browser stops before attempt metadata is saved | The envelope remains durably pending. The next attempt may submit the same ciphertext again. |
| Stale runtime races a newer session | Its compare-and-swap fails. If durable session differs from its expected snapshot, it quarantines and does not overwrite the current session/outbox. |
| Tab loses its lease before commit | The final ownership assertion rejects the commit. If the saved session is still current, the in-memory runtime reloads it; otherwise it fails closed. |
| Repeated reload/recovery | Recovery reads the existing outbox envelope; it does not mint a replacement envelope. |

An interrupted outbound transaction does not leave a `vodozemac-commit` marker: the session/outbox IndexedDB transaction itself is the atomic boundary. Existing markers and recovery behavior for ordinary session mutations remain in place.

## Identifiers, retries, and delivery claims

The existing local `clientId` remains a UUID stored beside the envelope in `modern-outbox`. It associates local UI/delivery callbacks and verified-renewal correlation; it is not sent in the encrypted envelope or relay request. The relay returns an attempt-specific ID, which can change when the same envelope is retried. The envelope format is unchanged.

The receive side still computes SHA-256 over `JSON.stringify(envelope)` for its existing bounded `modern-seen` list (at most 1,024 entries). This is a current same-runtime duplicate check, not a stable cross-platform envelope identity or an exactly-once guarantee. A repeated relay submission can still create duplicate relay/mailbox work; a crash before local attempt metadata is recorded leaves the sender uncertain whether the relay accepted the first submission. No ciphertext hash, timestamp, UI ID, or relay ID was introduced as a protocol-level deduplication key.

Existing submission/`delivered`/mailbox/peer-acceptance meanings are unchanged. This work does not add authenticated receipts and does not claim that the peer durably persisted the message.

## What was tested

Focused service tests exercise the real `ModernConversation` orchestration with the repository's deterministic session/storage adapters. Browser tests use the real Vodozemac WASM module, `BrowserSecureStorage`, encrypted IndexedDB, page reload, unlock, and runtime session restoration. A test-owned sink models dispatch; it does not connect to a live relay.

The 11 browser cases cover:

1. successful encrypted envelope + session commit;
2. actual IndexedDB transaction abort, asserting neither session nor outbox advances;
3. in-memory restoration and successful later retry after abort;
4. reload after an aborted transaction, with no phantom envelope;
5. reload after successful commit, restoring the exact pending ciphertext;
6. recovered outbox dispatch after reload and same-envelope retry after transport failure;
7. stale restored writer rejection without overwriting the winner;
8. lease loss before commit;
9. two browser tabs racing one saved snapshot, with only one commit;
10. repeated reload recovery without a duplicate local outbox item;
11. atomic renewal correlation metadata plus envelope persistence.

The service regression also verifies that an outbox CAS failure leaves the prior session snapshot intact and a subsequent send can use that restored session. A separate service test continues to characterize that generic non-outbox session mutations use their existing persistence path; this Stage 1 change does not claim to solve stale writes for signaling or receive-side session mutations.

## Remaining limitations and platform boundary

- The browser test reloads a document in a disposable Chromium context; it is not a physical power-loss or browser-process-kill test.
- If a crash happens after the session/outbox transaction commits but before `ChatContext` adds and separately persists the plaintext UI message, the encrypted envelope remains dispatchable but the sender's local history may not reconstruct the original display text. This task does not change message-history persistence.
- A crash after relay acceptance but before local attempt/ACK bookkeeping can cause the same envelope to be resubmitted. Existing receiver replay suppression is bounded and serialization-dependent; exactly-once delivery and stable cross-path deduplication remain unresolved.
- Signaling/call and inbound receive session mutations still use the pre-existing session persistence path. No call protocol, receive/acceptance behavior, or ACK semantics changed.
- Android is untouched. Its eventual compatible guarantee should be semantic: persist an advanced platform-native session snapshot and the exact already-encrypted envelope/recovery record atomically (or with deterministic recoverable journaling), then retry that same envelope. Android's native serialized pickle need not be byte-identical to the Web pickle. Cross-platform session/identity association, account-wide ownership, shared stable envelope identity, and authenticated receipts remain separate work.
- No LAN, direct transport, delivery coordinator, new envelope identity, receipt protocol, or exactly-once claim is introduced.

## Stage distinction

- **Stage 0:** the three identity/lease race guards above, characterization tests, and an audit/report. It did not establish sender outbox/session atomicity.
- **This Stage 1 task:** Web message-channel encryption now commits its advanced session with its exact local outbox/control recovery record; reload and stale-writer tests establish deterministic recovery for the tested IndexedDB boundaries.
- **Still unresolved:** cross-platform identity/session association, account-wide ownership, global stale-runtime protection for other session mutation paths, stable message identity/deduplication, authenticated peer-persistence receipts, plaintext sender-history recovery after a post-commit crash, physical crash testing, and all Android changes.
