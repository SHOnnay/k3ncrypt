# ADR 0002: Crash-consistent message acceptance

Status: Transactional acceptance selected and implemented for Web inbound message acceptance in Phase 1F. This decision does not change outbound handling, Android, ACK meaning, or transport behavior.

## Current behavior

See `current-behavior.md` and `crash-consistency.md`. Web decrypt advances the session, then the consumer stores the message, then the seen marker is written. Outbound encryption precedes outbox persistence. Android inbound instead commits account/session/message/dedupe together through `CryptoStateStore.commitInbound()` before publishing the session.

## Options for later review

A. One transaction covering ratchet/account state, message and dedupe marker. This is only feasible if storage primitives actually support a shared transaction.

B. A durable pending-accept record coordinated atomically with session state, then finalized. Requires a replay/recovery state machine.

C. Persist dedupe before consumer and require an idempotent consumer keyed by stable envelope identity. This avoids duplicates but must not acknowledge before durable content acceptance or suppress a message permanently after a crash.

Phase 1 must inspect the actual `SecureStorage` port, web IndexedDB and Android Room transaction boundaries, then document tradeoffs and obtain approval before production changes. Phase 0 records current behavior at CP1–CP6 only.

## Phase 1B acceptance gate

The owner must be able to recover from a crash after decrypt but before content persistence, during content persistence, and after content persistence but before dedupe persistence. A positive `receiver-accepted` response or future peer receipt must follow durable acceptance of content and required session/dedupe state. Web currently writes the consumer result and seen marker separately after ratchet advancement; ordering alone does not meet this gate. Android's transaction is evidence for its own inbound path, not proof of Web parity.

Sender recovery must likewise distinguish a crash before the encrypted outbox write (no durable retry item) from one after it (retry the identical ciphertext). An ACK lost after receiver acceptance leaves an unknown sender outcome and requires safe redelivery. Duplicate delivery must be idempotent across live, mailbox and later paths, including after restart. Test doubles that do not advance a real ratchet cannot prove recovery at CP1/CP2. Select A, B or C only after verifying which records can share one actual durable transaction; otherwise document and test a recovery protocol. No option is selected here.

## Phase 1C decision record

Status remains proposed; implementation choice is deferred. `crash-acceptance-v1.md` traces actual calls and S1–S2/R1–R5. `VodozemacRuntime.decrypt()` persists the advanced Web session **before** `ChatContext` persists the product message. The runtime marker does not cover that message or `modern-seen`. First inbound prekey account/session state is also committed before plaintext reaches the consumer. Idempotent product writes help duplicate handling but cannot alone recover R1.

Transaction feasibility must be proved. `SecureStorage.compareAndSwapRecords` and IndexedDB multi-record transactions exist; current call sites do not form a shared acceptance transaction. Android Room `commitInbound` groups its account, session, message and digest, but needs process-death tests. A write-ahead record is viable only if its recovery data is durably coordinated with ratchet mutation inside the existing encrypted vault boundary. Do not journal plaintext or keys.

Choose a design only after proving real Vodozemac restart recovery at R1/R2, inspecting first-session account mutation and concurrent-tab ownership, and approving ADR 0001 identity and retention. No production implementation is approved by this update.

## Phase 1D evidence update

`crash-validation-report.md` records five new fault-injection tests. They reproduce S1 missing outbox, S2 same-envelope restart retry, modeled R1/R2 loss risk, R3 duplicate product persistence under replayable decrypt, and delayed/duplicate relay-ID ACK behavior. In-memory records and fake ratchets/relay establish possible outcomes and call ordering, not real Vodozemac or browser process-death recovery. Investigate transactional Web acceptance first; use a write-ahead record if shared atomic commit proves infeasible, and idempotent envelope-keyed consumption as complementary duplicate control. No option is selected; real-state restart validation remains mandatory.

## Phase 1E evidence update

Real WASM Vodozemac plus encrypted IndexedDB confirms an existing-session Web R1/R2 gap across page reload: advanced session persists before product message and seen marker, and identical ciphertext cannot be decrypted after restoration. At R3 the product message persists but seen marker does not; real-session replay is rejected. This narrows the earlier fake-ratchet uncertainty but is not an OS process-kill or full UI/relay proof. Android JNI/Keystore/Room instrumentation confirms that an uncommitted inbound transaction rolls back message and digest after an actual instrumentation-process kill, preserving the earlier session so redelivery decrypts. See `crash-validation-report.md` for exact probes and limits.

At the Phase 1E decision point, transactional Web acceptance was a preferred candidate pending feasibility proof. Phase 1F below records the completed feasibility proof and implementation decision, superseding that status for Web inbound acceptance.

## Phase 1F decision: Web receive transaction

The Web encrypted vault has a multi-record compare-and-swap backed by one IndexedDB read-write transaction. The decision is to use it as the acceptance boundary: commit the advanced session, encrypted product message, replay marker, and bounded recovery projection record together. For first inbound pre-key messages, include the mutated account and new session in that same commit. Do not introduce a write-ahead journal because the required state already fits the existing transaction and the journal would add recovery states without closing a gap the transaction cannot close.

The conversation owner remains responsible for sender/conversation/frame validation and building the accepted message. The crypto runtime owns ratchet mutation and commits the caller-provided encrypted records with it. Receive resolves successfully only after this commit, preserving the existing ACK order and meaning. A post-commit callback failure leaves a durable message plus replay marker and temporary recovery record; duplicate delivery retries projection without decrypting again. A pre-commit failure aborts the full transaction and quarantines the mutated in-memory runtime; restart reloads the unchanged persisted state for safe redelivery.

No migration is required: existing record formats/addresses remain unchanged; the new recovery record is transient and created only for accepted messages. Existing JSON digest serialization and seen retention are unchanged and remain follow-up risks. Real-WASM/IndexedDB Playwright validation covers injected transaction abort, page reload, redelivery, duplicate handling, and a subsequent message on the restored session. Full relay/mailbox loss and OS-level browser process-kill validation remain outstanding. See `web-atomic-acceptance-v1.md` and the Phase 1F report.
