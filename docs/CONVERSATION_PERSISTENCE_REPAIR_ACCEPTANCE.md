# Conversation persistence and restoration repair

Base: `b6396e5b0886ebb11d7ccff5accff2d12bede7ed`.
Local repair branch: `codex/conversation-persistence-restoration`.

## Confirmed causes and corrections

- The encrypted descriptor array used uncoordinated read/modify/write. Independent room saves and removals could overwrite each other, losing the only stored control capability. Every mutation now compares and commits the index and encrypted removal markers through the existing BrowserSecureStorage multi-record CAS. Its IndexedDB adapter compares and writes within one `secure_records` read/write transaction shared across tabs. Conflicts re-read the current records and recompute the mutation, with at most 64 attempts and bounded yielding. Exhaustion throws an explicit safe error; there is no non-atomic fallback.
- Runtime callbacks wrote full, potentially stale descriptor snapshots. They now patch only their intended fields against the latest committed descriptor. Capabilities cannot be replaced; established bootstrap/accepted relationship state cannot be downgraded by delayed callbacks. Signed invitations and unknown existing fields survive metadata updates. Identity changes can only project a matching canonical contact record, granting no verification or trust.
- Intentional removal was vulnerable to late saves. An encrypted removal marker and index removal commit together. A subsequent update or save for that room is rejected, including from a different unlocked tab. Duplicate descriptors are not destructively merged by mutation: ambiguity rejects the operation and preserves the original records.
- Restore and switch error handlers removed visible contacts on transient or unclassified failures. Locally valid descriptors remain visible with room-specific retry, pending, incomplete or review states. Only structured terminal room-status evidence quarantines a room; its encrypted descriptor is retained. Generic exception text cannot establish that a room was deleted. A room-status request has a ten-second deadline and clears its timer. Restore stops repeated backend connection attempts after a service/network failure.
- Both index readers discarded the entire list above 100 entries. Each entry is now validated separately. The newest 1,000 unique valid descriptors form a bounded visible window; excess entries are reported and retained. New insertion at capacity fails explicitly; updates and removals remain possible on larger historical indexes. Malformed records are retained, with bounded diagnostics, without hiding healthy records. A failed claimed-profile projection cannot erase a descriptor.
- Exceptions were collapsed into incomplete-state errors. Safe categories now distinguish invalid local records, unavailable storage, session absence, transient transport failures, another-tab ownership, superseded opens and uncertain invitation lookup. Local nicknames/labels and a room suffix identify affected entries without exposing capabilities. Superseded requests cannot overwrite the current selection's status or error banner.
- An open requested while unlock was still restoring the same room could queue another actor. Selection now rechecks its completed, bound legacy connection inside the serialized path and reuses it only after local eligibility and canonical identity checks. Mux reuse continues through its existing verified-device/identity eligibility path. Prior legacy actors are closed using current room state, even when an earlier UI snapshot lacks their room projection. Explicit disposal invalidates the selection cache.

## Read-only orphan diagnostic

Unlocked storage can enumerate at most 1,000 record addresses per requested namespace using an IndexedDB key cursor. The diagnostic compares `conversation-protocol` and `vodozemac-session` addresses with usable descriptors and intentional removal markers. It does not read message or session contents, mutate records, repair trust, or invent a capability. The UI reports unavailable or truncated inspection explicitly. Addresses alone are evidence of local records, not proof of a recoverable or established conversation.

A capability already overwritten by the old race is not derivable from an Olm session. An intact encrypted backup or independently retained original authorization material may supply it, subject to room availability and identity validation. This patch does not recover lost capabilities automatically and makes no claim that orphaned rooms can be reopened.

## Compatibility and operational limits

The existing descriptor-array format is retained. The encrypted removal-marker record is additive. Message/attachment cryptography, verification authority, device authorization, replay stores, wire contracts, backend code and production gates are unchanged. No server database migration is introduced.

All browser-tab concurrency guarantees assume tabs run the repaired code. An older application tab still uses unconditional writes and ignores removal markers. Close older tabs before adopting the repair; mixing old and new writers cannot provide the new guarantee. Reverting application code also restores the original races.

The visible window is intentionally bounded; entries beyond it remain stored and are reported, with no automatic pruning. Read-only orphan inspection is also bounded. Broader recovery tools or pagination are not implemented here.

## Acceptance evidence

The focused suite covers seeded 1,200-operation concurrent save/update/remove workloads with an oracle for each retained field; removal races; exhausted CAS; unavailable atomic support; protected bindings; malformed/duplicate records; profile-read isolation; 150-entry and 1,002-entry indexes; transient room probes and timer cleanup; unchanged verification; and read-only orphan inspection.

The Chromium repair spec uses actual BrowserSecureStorage, encrypted IndexedDB, Argon2id, Olm/WASM, Socket.IO and fresh disposable loopback MongoDB. It runs 1,200 competing mutations across two pages and reopens/unlocks the same vault. Its Alice/Bob/Carol case switches repeatedly, verifies encrypted delivery and saved history, injects 503, a ten-second request stall and disconnected API traffic, refreshes/unlocks, and verifies a deliberately missing session cannot hide a healthy room. Only disposable fixture records are changed.

Final automated results: 24 focused suites / 207 tests passed; full Jest 152 passed suites / 908 passed tests, with four Mongo-gated suites / 17 skipped tests. The standard suite exited normally without `--forceExit`. Client production build, backend TypeScript build, service SDK build, ESLint and `git diff --check` passed. The client retains its existing large-bundle warning. Jest's broad coverage collection also reports unsupported Vite/browser-module TypeScript contexts; those warnings are not build or assertion failures and are not claimed as usable coverage for those files.

Shared mailbox/migration and durable device trust compatibility were executed separately against disposable local MongoDB: two suites / 13 passed tests, zero failed or skipped. Four unrelated Mongo-gated file-ledger/private-network tests were not rerun. One setup run used a fixture name whose generated migration suffix exceeded MongoDB's 63-character database-name limit (12 passed / one failed); a fresh shorter fixture passed all 13 and exited normally. No application correction or test weakening was required. The disposable container was removed after validation.

Chromium acceptance: two repair tests passed (actual IndexedDB concurrency and Alice/Bob/Carol restoration), plus one Mux compatibility test passed. The latter intentionally attempts Mux while the peer still owns legacy delivery, verifies rejection without contact disappearance, then disconnects the legacy peer and explicitly retries. Both verified peers exchange encrypted messages over Mux, refresh/unlock, retain history and exchange another message. No ownership, verification or production gate was bypassed.

The existing broader `e2e/mux-stage1b.spec.ts` does not pass: its sequential reload/transport handoff encounters `Room subscription rejected.` and cannot reopen Alice at line 118. The exact base candidate also fails at that step: it hides Alice after the same subscription rejection. An isolated base-candidate diagnostic rerun added only an allowlisted failure category and bounded test timeout to establish the first cause; it did not change functional behavior. This patch preserves the contact and permits an explicit retry, as the new compatibility test demonstrates. Full three-profile background/file/call acceptance through that existing fixture is therefore a remaining validation gap, not reported as green. Automatic legacy-to-Mux handoff is not implemented by this repair.

Browser fixtures execute serially without weakening production rate limits. Early fixture runs were corrected to await completed selection, account for intentionally canceled requests, and restrict offline interception to actual `/api/` paths rather than Vite module imports.

Firefox/WebKit, complete browser-process termination, actual power loss, and production user vaults are not validated by these local Chromium runs. No production environment, database, deployment or branch is changed by this task.

## Review recommendation

Obtain independent security review before release, focused on the CAS/removal-marker transaction, field merge and binding guards, terminal-versus-retryable classification, serialized selection reuse, and compatibility with old tabs. The tests provide regression evidence, not a universal proof against every browser or storage failure.

## Exact changed files

Runtime/UI:

- `client/src/App.tsx`
- `client/src/components/AppShell/Sidebar.tsx`
- `client/src/context/ChatContext.tsx`
- `client/src/product/conversationEligibility.ts`
- `client/src/product/conversationRoom.ts`
- `client/src/product/roomState.ts`
- `client/src/product/safeDiagnostics.ts`
- `client/src/product/sessionStore.ts`
- `client/src/types/index.ts`
- `service/src/core/contracts.ts`
- `service/src/storage/persistence.ts`
- `service/src/storage/secureVault.ts`

Tests/support:

- `client/src/product/conversationEligibility.test.ts`
- `client/src/product/conversationRoom.test.ts`
- `client/src/product/profileMetadata.test.ts`
- `client/src/product/safeDiagnostics.test.ts`
- `client/src/product/sessionStore.test.ts`
- `client/src/product/testStorage.ts`
- `service/src/storage/secureVault.test.ts`
- `e2e/conversation-persistence-repair.spec.ts`
- `e2e/conversation-persistence-mux.spec.ts`

Evidence: `docs/CONVERSATION_PERSISTENCE_REPAIR_ACCEPTANCE.md`.
