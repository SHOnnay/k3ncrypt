# Phase 1 delivery foundation report

## Baseline and scope

- Branch: `connectivity/delivery-foundation`
- Base: `connectivity/web-outbox-recovery` at `8f9ad2b9610fe8b4f8c7243020d11b715ebba4d1`
- Previous validated branch preserved: `connectivity/web-outbox-recovery`
- No merge to `main` was performed.
- The checkout does not import the unmerged delivery-coordinator runtime, Android readiness, trust-state, SAS, or LAN implementation branches. Only this branch's additive delivery contracts/relay wrapper, M1 identity, local acceptance changes, tests, and documentation are in scope.

## Results

### Delivery contract foundation

Added contracts for `ConversationOwner`, `DeliveryCoordinator`, `DeliveryStore`, `ConnectivityPolicy`, and `PathAdapter`, plus a relay path adapter that delegates the existing Socket.IO operations and their original arguments/results. It is not wired into the production `ModernConversation` transport manager. Runtime selection and production delivery remain on the existing relay path only.

### M1 stable envelope identity

Implemented `v1:` plus lowercase SHA-256 of the domain-separated UTF-8 conversation ID and the exact validated inner `olmMessage`, each prefixed by a big-endian u32 byte length. TypeScript and Kotlin reject malformed UTF-16 instead of hashing replacement characters. The shared fixture was copied byte-for-byte from the existing connectivity specification; it was not edited. The identity is local correlation/dedup metadata, never sender authentication or a receipt.

New outbox entries record the computed ID next to the exact saved ciphertext. Old Web outbox entries are accepted and have their IDs computed when loaded. Inbound duplicate checks consult both the legacy Web JSON digest/Android serialized-envelope digest and the new conversation-scoped ID before another decrypt. Web stores the M1 replay marker in the same inbound acceptance transaction. Android stores the M1 ID in its existing Room transaction. Web's seen bound stays at 1,024 entries; Android retains its existing per-message dedupe records.

### Android parity

The Android path remains:

```text
encrypt -> account/session + outbox + outbound history transaction
        -> exact serialized envelope submission/retry
        -> existing relay completion callback removes pending work

receive -> parse -> legacy/M1 duplicate check -> existing sender trust check
        -> decrypt -> Room account/session/message/dedupe transaction
        -> existing acknowledgement
```

No route, identity, or verification state is changed by the new stable ID. The Android storage API remains source-compatible through optional trailing `envelopeId` parameters. Unit/instrumentation tests were added, but execution is blocked here by the missing Android SDK and emulator; no physical-device crash behavior is claimed.

## M2 acceptance and crash evidence

The approved ADR selects option A, using existing storage transactions rather than adding a journal. On Web, existing secure storage encrypts each record and then uses one IndexedDB read-write transaction for compare-and-swap. On Android, Room `withTransaction` already covers the receive records. The Web crypto runtime now defers durable session advancement until it can commit the encrypted product message and replay markers together; first-pre-key acceptance additionally includes the mutated account and new session.

| Point | Web result on this branch | Android source-level result | Evidence status |
|---|---|---|---|
| CP1 after decrypt / before message persistence | Ratchet mutation remains in memory; transaction abort leaves durable records unchanged and exact redelivery after reload succeeds. | Room transaction encloses receive writes; abort should roll back all records. | Real WASM + IndexedDB Playwright abort/reload test passed. Android instrumentation added, not run. |
| CP2 during consumer persistence | IndexedDB abort leaves session, account when applicable, message and replay markers unchanged. | Room transaction encloses account/session/message/digest/stable ID. | Real Web test passed. Android instrumentation added, not run. |
| CP3 after message / before marker | No separate durable gap; message and markers share the transaction. | No separate durable gap in current Room transaction. | Web exercised by injected abort; Android code path inspected/test added. |
| CP4 after marker / before ACK | Duplicate marker is durable with message/session; duplicate is recognized before decrypt. Existing ACK ordering is unchanged. | Stable ID/digest and message/session commit together; duplicate returns existing `Duplicate`. | Web conversation unit tests and persistence E2E passed; Android tests not run. |
| CP5 after encrypt / before outbox | Base branch atomically commits session and exact ciphertext outbox; failure before commit has no durable pending item. | Room outbound transaction groups state/outbox/history. | Existing Web outbox E2E passed; Android source tests updated but unavailable here. |
| CP6 after outbox / before submit | Reload retries the exact saved ciphertext. | Existing `retryPending()` reads and submits exact persisted envelope. | Existing Web outbox E2E passed; Android instrumentation not run. |

Web E2E used real generated Vodozemac WASM bindings, the encrypted IndexedDB vault, a real pre-key sender/receiver exchange, injected aborts, reload, exact ciphertext redelivery, an established-session abort/retry, and subsequent persisted-state verification. It does not establish OS-kill, browser power-loss, full relay/mailbox, or real-world delivery behavior.

## Relay and protocol checks

- Relay adapter wraps existing `SocketIoRelayTransport` send/join/mailbox behavior without changing payloads or adding envelope IDs to relay metadata.
- No relay events, routes, database schema, ACK meaning, retry timing, or outbox completion rule changed.
- No LAN/direct/WebRTC data-channel path, discovery, peer admission, SAS, trust update, or backend change was added.
- Exact ciphertext remains the retry unit. Relay IDs and stable envelope IDs remain distinct.

## Validation record

Final validation on this branch:

- Root Jest: 105 suites passed, 3 skipped; 544 tests passed, 7 skipped. Ran with `--coverage=false --forceExit`; the force-exit flag handles existing open test handles after the suite completes.
- Service Jest: 73 suites passed; 427 tests passed. Ran with `--coverage=false --forceExit`.
- Focused conversation/runtime, stable-ID, relay-adapter, and product-message-store tests: 5 suites passed; 74 tests passed.
- Browser outbox and inbound-acceptance E2E: 12 passed. This includes the real WASM + encrypted IndexedDB abort/reload/redelivery test. The injected aborts are expected fault-injection output.
- Service SDK production build: passed; declarations generated.
- Client production build: passed. Vite reports the existing large-chunk advisory for a 565 kB minified chunk.
- Lint: passed.
- `git diff --check`: passed after the final report update.
- Android unit tests: not run. `./gradlew test` is blocked because this environment has no configured Android SDK (`ANDROID_HOME`/`sdk.dir` absent).
- Android debug build and instrumentation: not run. `./gradlew assembleDebug connectedAndroidTest` is blocked at SDK discovery, and no disposable AVD/`adb` is available. Android test code was added but has not been compiled or executed in this environment.

## Remaining blockers and next gate

1. Run Android unit and instrumentation suites on a machine with the Android SDK and a disposable AVD; do not claim physical process-kill evidence until that succeeds.
2. Characterize Web sender UI-history recovery separately; the outbound session/outbox atomic commit is present on the base branch, but sender-visible history is persisted after it.
3. Define a time-based dedupe/replay retention horizon and test it before multipath or authenticated delivery receipts.
4. Do not enable any non-relay transport or peer-persisted receipt from this branch. Next recommended branch: `connectivity/delivery-foundation-review`, for review of M1 compatibility and M2 transaction/failure semantics before any coordinator/runtime integration or new path.
