# Web lifecycle stabilization — implementation and remaining gate

## Candidate and scope

Branch: `codex/web-lifecycle-completion`.
Base: `1414b40f` (reviewed V2 staging descendant of live `871fa99d0ae94c88239f6c392325f224d2c085c4`). Implementation checkpoint: `c2e423f17e7ad5ac345f9f2ee191198d545097df`. The documentation commit following it is the final report HEAD.

The base preserves attachment revocation fencing (`566c71e5`), exact V1 BSON bytes (`81986b29`), ledger read/progress corrections, bounded rate-limit recovery and truthful quota classification. The independent production hotfix remains untouched. No Android, Firebase, WebRTC, production data, owner browser data or installed applications were changed. No push, merge or deployment occurred.

**Verdict: GO for review and disposable validation; NO-GO for claiming full everyday reliability or owner-account recovery.** A confirmed seven-day server authorization coupling cannot safely be repaired by automatically recreating deleted ownership. It needs an explicit durable-authority design decision. Independent safe corrections below are implemented.

## Confirmed causes and corrections

1. Remote prekey HTTP 404 was classified as `CONTACT_REGISTRY_MISSING`. Local pins and saved descriptors can remain intact. Commits `da58c470`, `343d6928` distinguish remote failure, preserve saved contact visibility and explain recoverable states. They do not fabricate a working session.
2. A saved accepted session revalidated its original signed invitation's 24-hour admission deadline on every restoration. Commit `819763c3` separates established-session lifetime from first-use invitation expiry. The exception requires an active healthy restored session, persisted ESTABLISHED introduction matching invitation and recipient, unchanged pinned registry identity, and matching fetched bundle. Signature, capability, room, address, key binding, chronology and admission checks remain. Pending, forged and missing-pin cases fail closed. This is a functional restoration correction, not just wording.
3. Local contact display awaited optional serial invitation-expiry requests. `c3a299e2` publishes local eligibility first, then performs bounded generation-fenced enrichment. The same commit bounds API calls to 30 seconds; uncertain POST timeouts are not blindly retried.
4. Reviewed Web fixes were selectively integrated: truthful relay-stored versus recipient-delivered status (`b5bb816c`), memory-only room/session drafts and file URL isolation (`ea9715d7`), opening/accessibility feedback (`2fc6e4a2`), send/probe fences (`bbec1eb6`) and warm selection fencing (`ecddc3a9`). Android portions were excluded.
5. Pending introductions used misleading incomplete-local-record copy. `c2e423f1` uses the pending invitation state without changing admission. It also corrects stale test selectors and expands persistent-browser lifecycle coverage.

### Seven-day routing authority: blocked correction

`backend/api/chatHash/prekeys.ts` stores public bootstrap material, renewal-proof hash and identity binding in one seven-day TTL record. `backend/db/migrations.ts` deletes it. `backend/socket.io/listeners.ts` (`authorizeRoutingAddress`) and `multiplexed.ts` require that unexpired record for routing authorization. Attachment membership also depends on it. Renewing requires the original proof hash and same identity; after deletion it cannot authenticate renewal.

Therefore removing a client GET, extending a timeout or restoring an Olm pickle cannot authorize a deleted server route. An existing encrypted session is necessary but not sufficient. Do not republish ownership from a capability alone or resurrect a revoked/deleted relationship.

Proposed approval boundary: independently durable, explicitly revocable routing-owner bindings, with authenticated creation/renewal, identity/device revocation fencing and deletion tombstones, separate from disposable prekeys. Backward migration and old-client behavior need review before implementation. No new trust authority or schema was added in this pass.

## Screenshot reproduction and interpretation

Three saved descriptors plus intact verified local identity records can produce three unavailable rows with the old 404 classification. The diagnostic's zero counts only protocol/session records lacking a usable saved descriptor; it does NOT count missing contacts, validate pins or establish server availability. The disposable persistent Chromium test reproduces three old unavailable rows and zero orphan rooms, then shows all three saved contacts in a truthful paused state with current classification. Ciphertext records and verified pin survive browser-process restart. This does not prove the owner's records have the same cause or recover their account.

## Lifecycle/retention matrix

A = security expiry; B = resource/storage limit; C = incorrect lifecycle coupling; D = corrected defect; E = design approval required. Source locations identify the relevant implementation families; absence of an application TTL is not a guarantee against browser eviction or disk loss.

| Object / created when | Expiry or retention | Cleanup / user consequence | Safe recovery | Class / source |
|---|---|---|---|---|
| Encrypted vault/account, at account creation | No application wall-clock TTL; locked-session access restricted | Explicit removal/browser storage loss can make identity unavailable | Unlock original encrypted vault; no automatic identity replacement | A/B; service/src/storage/secureVault.ts, persistence.ts |
| Contact identity/pin, invitation acceptance/comparison | No age-based TTL | Explicit deletion or identity change blocks trust | Existing unchanged authenticated record; never auto-verify | A; service/src/crypto contact registry and modernConversation.ts |
| Saved conversation descriptor/index | No wall-clock TTL; bounded enumeration | Missing capability cannot be invented; orphan count is structural only | Existing authenticated descriptor | B; client/src/product/conversationEligibility.ts, conversationRoom.ts |
| Local encrypted history/session/replay records | Bounded local records/history; secureVault record ceiling 4 MiB | Resource trimming is distinct from server expiry; lock prevents access | Existing vault/session, subject to retained records | A/B; service/src/storage and crypto repositories |
| Signed contact invitation | Maximum 24 hours for admission | Expired invitation cannot establish a new contact | New authenticated invitation when needed; established matching session uses persisted acceptance | A/D; modernConversation.ts |
| Prekey bundle plus routing ownership | Seven days from publish/renew; Mongo TTL | Deletes renewal proof and routing/identity lookup authority together | Authenticated renewal while original authority exists; after deletion blocked pending design | C/E; backend/api/chatHash/prekeys.ts, db/migrations.ts |
| Room record | Explicit expired/deleted flags; not the prekey TTL | Deleted/expired room denied | No resurrection; authorized existing active room only | A; backend/api/chatHash, socket.io |
| Device trust/lifecycle and revocation | Durable state, not a TTL prekey | Revocation invalidates subsequent authority; attachment final checks fenced | Existing signed ownership/lifecycle, not Firebase or room capability | A; backend deviceTrust, deviceLifecycle, attachments |
| Enrollment/bootstrap and request proofs | Short signed validity windows; nonce expiry indexes | Expired/replayed proofs denied | Fresh authorized proof, not cached authorization | A; backend security/device proof handlers, db/migrations.ts |
| Mux room subscription | Five-minute lease | Must renew admission; no durable ownership extension | Fresh authenticated subscription | A; backend/socket.io/multiplexed.ts |
| Encrypted offline mailbox | Seven days; 64 active slots | TTL removes expired ciphertext; no promise of recovery after retention | Authorized replay within retention | B; listeners.ts, multiplexed.ts, db/migrations.ts |
| Mailbox claims / ACK waits | Mux claim 30 s, delivery ACK wait 10 s | Lease recovery retries; server acceptance is not recipient persistence | Existing transactional accept/ACK protocol | A/B; multiplexed.ts, database implementations |
| Local outbox / delivery markers | Bounded pending work and retries; no new expiry receipt protocol | Expired server mail cannot honestly become Delivered | Retry within authority/retention; explicit failure must remain truthful | B/E; modernConversation.ts |
| Recipient replay markers | Persistent authenticated acceptance records, bounded pages | Deduplication survives restart; no fabricated ACK | Existing encrypted acceptance transaction | A/B; service crypto/storage |
| V2 file allocation/content | 24 hours; 8 MiB/file, 256 KiB/chunk, 32 chunks; 2 active, 12 MiB/user, 32 ledger records | Content expires; terminal records/cleanup bounded; encrypted chat reference may remain | Sender sends again using a new authorized transfer; no integrity bypass | B; service/src/files/protocol.ts, backend/attachments/fileLedger.ts |
| Legacy V1 encrypted attachments | Requested expiry bounded by legacy limits (maximum seven days) | Expired content denied/cleaned; BSON fix preserves stored bytes | New authorized transfer; not a decryption fallback | B/D; service/src/attachments, backend/api/attachments |
| Downloaded plaintext / Blob URLs | Memory-only output tied to operation/session | Close, room change, unmount and vault teardown release outputs/URLs | Explicit re-download while authorized and retained | A/B; FileContext, previewResources, verifiedOutput |
| Maintenance / unavailable server | Temporary error and Retry-After | Must not delete browser contacts or claim missing local records | Bounded retry after service availability | D; API client and conversationOpenCopy |

This matrix is a source review plus the tests below, not a claim that every expiry/cleanup worker and every object was exercised at every age. Complete aged end-to-end coverage remains limited by the server-authority design issue.

## Time-advanced results

| Age with no renewal | Local pins/descriptors in persistent fixture | Routing authorization in real Mongo | Unclaimed mailbox within retention | Original invitation / V2 file |
|---|---|---|---|---|
| Immediately | Preserved | Allowed with correct proof | Eligible | Within validity |
| 4 days | Preserved | Allowed | Eligible | Expired |
| 5 days | Preserved | Allowed | Eligible | Expired |
| 7 days | Preserved, paused on missing prekey | Denied | Expired | Expired |
| 8 days | Preserved, paused | Denied | Expired | Expired |
| 15 days | Preserved, paused | Denied | Expired | Expired |
| 30 days | Preserved, paused | Denied | Expired | Expired |

Real Mongo fixtures insert aged records, exercise authorization and mailbox claims, and observe actual TTL monitor deletion separately. Browser age cases use a controlled provider with real encrypted IndexedDB and real Sidebar rendering. They are NOT a full seven-day real-Olm/Mongo browser restoration proof. Established-session invitation expiry has separate signed-invitation regression tests.

## Validation results and limits

- Full non-Mongo regression checkpoint: **169 suites, 1,088 tests passed**. Subsequently changed lifecycle code: **4 focused suites, 123 tests passed**, including 81 ModernConversation tests. These counts overlap and must not be added as unique tests.
- Disposable Mongo integration: **26 tests passed**, then **19 attachment read/revocation tests passed** with correct environment flags. Two initially skipped file tests were included in the latter successful run.
- Persistent encrypted-browser fixture: passed; three contacts, ages above, exact encrypted-record preservation and browser-process restart. Read-only diagnostic tests previously passed; diagnostic was not run on owner data.
- Authenticated application/controlled Web component Chromium batch: 10 passed, one failed due to obsolete pending-row selector. Corrected selector and accurate pending copy; focused rerun passed. Includes offline inviter, offline recipient/reload, interrupted local acceptance, room selection, drafts and preview isolation. Component harness tests are distinguished from full authenticated flows.
- Four sequential authenticated file transfers: passed in 24.0 s overall including fixture setup and all four files; hashes matched.
- File rate-limit/cancellation/recovery: **2 passed (24.1 s)**; bounded exhaustion, honest failure, later success, late allocation cannot publish after cancellation.
- Startup browser test: **1 passed (11.7 s total)**. Saved contact visible **336 ms after unlock submission while two optional expiry requests remained unresolved**. Before correction source awaited up to 12 serial probes (10 s each); no matched historical end-to-end startup baseline was measured. This is not Render cold-start latency.
- Service SDK build, production backend TypeScript build and production client TypeScript/Vite build passed. Focused ESLint and git diff whitespace checks passed. Client retains a >500 kB bundle warning.
- Initial test environment failed to resolve local SDK declarations; fixed isolated dependency resolution/build, then reran successfully. Initial file batch was interrupted under repeated throttling; not a pass. Another file run timed out waiting for an obsolete Discard label after successful download; changed to current Close control, rerun passed. This does not conclusively explain the historical 72-second test.
- Not tested: owner account recovery, physical Brave/Android interoperability, real Render cold-start timing, full browser+backend restart at each age, and exhaustive long-duration transfer/storage pressure. No production data or credentials used.

## File measurements (local disposable accounts)

Durations are measured test stages, not independent additive categories. Send includes protected-reference publication; download-ready includes verification and UI readiness. Fixture setup was 5,047 ms once.

| Bytes | Selection ms | Send ms | Complete-to-Sent ms | Download-ready ms | Observed prekey 429 waits | Integrity |
| 23552 | 12 | 382 | 108 | 481 | 0 | PASS |
| 174080 | 24 | 393 | 103 | 484 | 0 | PASS |
| 314368 | 42 | 2096 | 1445 | 1899 | 2 | PASS |
| 1258291 | 122 | 5110 | 2053 | 2904 | 5 | PASS |

For 1.2 MiB, measured encryption and decryption each ~0.5 ms, source reading 9 ms; five Retry-After waits ~1,003–1,004 ms each dominate part of the path. Legitimate request throttling remains; quotas were not increased. Mongo-only reads of 307 KiB/1.2 MiB took 14/71 ms with no ledger writes. These are different experiments, not before/after production measurements.

## Release dependencies and remaining decisions

Web error classification, local-first visibility, established-invitation correction, drafts and selection fixes preserve existing live API contracts. Ordinary operation still requires valid authenticated server routing. The backend security/ledger/BSON/rate-feedback corrections in the base require separate approved backend deployment to benefit live traffic. Existing index/runtime prerequisites remain those documented by the staging/hotfix base; this pass adds no production schema migration or new mandatory environment variable. Firebase was not integrated or enabled.

Android Beta 22 source and APK are untouched; shared server wire contracts were not changed. Compatibility is by source/contract review and backend regression tests, not new physical Android acceptance.

Before any controlled release: review the established-session exception and candidate diff, decide the durable routing-owner lifecycle, validate recovery with an independent persistent real browser and test retained offline messages across service restart. A released UI-only improvement must be described as visibility/diagnostic and bounded restoration improvement, not a fix for deleted seven-day routing authority. No safe automatic recovery of the owner's expired authority is established.

No contacts were recreated, trust was not synthesized, expiry values were not globally extended, and relay acceptance was not promoted to recipient delivery. Request owner approval for the narrow durable-authorization design; no deployment or owner-data recovery is authorized by this report.
