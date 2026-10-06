# MAIN secure file transfer V2 implementation and validation

## Product contract

The reviewed AES-256-GCM attachment foundation is unchanged. Newly selected ordinary files, documents, photos and Web recordings use only `k3ncrypt-file-v2:` references and `/api/attachments/v2`. There is no fallback to v1. The Web legacy media provider is read-only; older records keep their original legacy authority and are not upgraded by current verification.

The per-transfer key is generated on the sender. It stays in process memory during upload. Once all encrypted objects are available, a strictly validated reference containing the key is sent through the existing E2EE message/outbox and protected message-history persistence. It is never written in plaintext to browser storage, ordinary Android files, SQLite, preferences, logs or server storage. This uses the existing vault/Keystore boundaries; no new wrapping or KDF is introduced.

The Web sender reads `ContactIdentityRegistry` through `ModernConversation.fileTransferBinding(true)`. Android reads `ContactVerificationAuthority` through `AndroidMessagingRepository.fileBinding(true)`. Both refresh the published identity against the existing pin, require an explicit local verified-and-unchanged decision, and recheck while producing chunks and publishing. The Web reference/outbox commit additionally CAS-guards the contact decision and existing recovery-reset epoch. An absent reset epoch is initialized to the existing canonical `version:1, resetAt:0` representation; it cannot reset a normally timestamped verification. Android checks the reference/pin/decision inside the existing conversation mutex immediately before message encryption and persistence. Ordinary text and call admission semantics are unchanged.

Receiving an already-authorized reference requires its recorded sender/recipient routing IDs and fingerprints to match the current unchanged pins. A current unverify does not manufacture authority or rewrite old records. Identity replacement denies access.

## Limits and bounded work

| Limit | Value |
| --- | --- |
| File size | 1 byte–8 MiB |
| Chunk size | 256 KiB; final chunk is the remaining length |
| Chunk count | 32 maximum, plus one manifest: 33 objects |
| Encrypted manifest size | 2,048 bytes of ciphertext including GCM tag |
| Active incomplete transfers | 2 per verified account |
| Reserved stored bytes | 12 MiB per verified account |
| Reserved incomplete bytes | 12 MiB per verified account |
| Record/tombstone count | 32 per verified account |
| Transfer lifetime | 24 hours from server creation |
| Tombstone retention | One further 24-hour interval |

Quotas reserve base64-encoded ciphertext geometry plus nonce, record and metadata overhead before accepting bytes. They are conservative reservations, not a display of plaintext usage. One maximum-size file occupies most of the quota. Quotas span conversations/devices sharing the same server-verified account.

Web file processing reads one bounded `File.slice` at a time. OPFS stores already-sealed objects; the file key is never part of that cache. The receiver writes authenticated plaintext into a private temporary OPFS output and returns a disk-backed File only after all checks. A browser workspace lock prevents multiple tabs from clearing an active workspace. Only one verified receive output is retained; explicitly save/discard it before another download. Native Chromium cache/output/cancel checks and actual page-reload cleanup passed. The installed headless WebKit could not acquire OPFS, and the headless Firefox harness stalled. Those runtimes are not claimed validated. Missing/unavailable disk APIs fail closed; there is no whole-file memory fallback. Browser support and real picker/save behavior remain physical-test items.

Android uses ACTION_OPEN_DOCUMENT/content://, ContentResolver streams and bounded reads; it requires a trustworthy declared size and rejects unknown/changed size. Sealed objects live in app-private cache subdirectories, never filename-derived paths. Receiving reconstructs one private incomplete file. Saving uses ACTION_CREATE_DOCUMENT with application/octet-stream and a bounded copy. No broad storage permission, automatic open or external preview is added. Only one receive result is retained.

Both clients process at most one 256 KiB chunk plus bounded ciphertext/encoding/API buffers. Web recordings remain a source Blob produced by the existing recorder, now capped at 8 MiB and sent through the same V2 path; encryption never materializes a whole recording as a typed byte array. The backend projects bounded metadata and one requested chunk; it does not retrieve an entire ciphertext payload into application memory.

## Durable server storage and authorization

`file_ledgers_v2` stores one bounded document per server-verified account. Transfer metadata includes stable bindings, geometry, state, expiry, reservations, an encrypted manifest and bounded chunk summaries. Encrypted chunk payloads are separate embedded fields within that same document. Filename/MIME/key/plaintext are absent from server records. Routing UUIDs and account IDs grant no authority by secrecy.

Creation authenticates the existing room-control/routing proof, durable single-use device proof, current published local fingerprint, recipient membership/fingerprint and exact request schema/version. Every endpoint requires the V2 header and its operation-specific proof. Read/write/cancel/delete also enforce the stored conversation, exact sender/recipient role and fingerprint. Only the bound sender can mutate/cancel; only the bound recipient can retrieve available chunk bytes. Alice/Bob/Mallory, substitutions, guessed IDs and version stripping are permanently covered.

Each metadata/reservation/state update and chunk write/unset is one revision-conditional, journaled Mongo update. This works on the existing standalone Mongo configuration; no replica-set deployment change is needed. Metadata projections exclude payloads. A transfer-ID partial unique index excludes empty ledgers, and bounded lookup requires that index. Run the existing additive migrations before production traffic; readiness requires the new index.

Completion requires a manifest and every expected index, whose ciphertext geometry was validated and atomically recorded with the actual object. There is no separate chunk insertion/finalization race or quota reservation transaction gap. The server attests stored geometry/availability, never AEAD authenticity or peer delivery. Identical duplicate objects are checked against the actual bounded stored object and accepted idempotently; conflicting bytes/nonces or nonce reuse across different objects fail closed. Duplicate requests cannot inflate reservations.

Cancel atomically removes chunk payloads/manifest and releases reservations, retaining a bounded tombstone. Expiry rejects further bytes/downloads; an idempotent minute sweep reclaims objects/reservations and later removes tombstones. Initialization after backend restart starts the sweep again. Account/participant authorization cannot be bypassed to clean another sender's records.

## State, retry, cancel and restart

Both clients use the same conceptual typed phases and legal transitions. Generation fences prevent stale callbacks from changing canceled/failed/expired/superseded state. Upload progress is reconciled from authenticated accepted indices, not only local counters. `WaitingForRecipient` means encrypted storage plus protected local message publication, not Delivered/Opened/Read.

For sender transient failures within the current process, retry queries server state and sends only missing exact cached sealed objects. Existing object nonces/ciphertext are reused verbatim; missing previously unproduced objects get fresh random nonces. A process-only produced-object inventory prevents regeneration after cache eviction: missing previously sealed material requires a new transfer and key. At most 33 objects are ever produced under a transfer key. There is no raw-key plaintext cache and no re-encryption of a cached logical object during retry.

Sender restart capability on both platforms: **SAME-SESSION RETRY ONLY / RESTART REQUIRED after process death**. Incomplete uploads whose IDs cannot be recovered expire server-side. Neither client claims durable upload resume.

Receiver restart capability on both platforms: **RESTART REQUIRED for partial output; fresh bounded redownload from the existing protected E2EE message reference**. Temporary work is discarded at startup. Already-complete protected history can recover the key through its existing vault, not a new key-restoration scheme.

Sender cancel invalidates its generation, aborts network work, stops new objects, clears the sealed cache where possible and requests authorized server cancellation. Receiver cancel stops retrieval and discards private incomplete output; it does not cancel the sender or invent peer delivery. Cleanup after catastrophic disk/provider failure is best effort and repeated on startup. No incomplete output is exposed as a verified final file.

Output free space is checked where the platform exposes it. Storage-full errors stop rather than loop. If an Android document provider fails during the explicit final save, deletion of the partial destination is attempted; if unsupported/failing, UI tells the user a partial file may remain and must be removed. That destination copy starts only after full AEAD/size verification.

## Filename, MIME and image safety

The reviewed manifest encoder normalizes/sanitizes filenames, controls/bidi/path separators/reserved names/length, and normalizes MIME or falls back to application/octet-stream. Names never become server or private cache paths. MIME is untrusted metadata. V2 images/photos share exactly the ordinary file path; thumbnails are deferred. Web downloads and Android save destinations use application/octet-stream with explicit user action. No HTML/SVG/media inline preview or auto-launch is introduced for V2.

## Validation evidence

- Full Web/service/backend Jest gate: 122 enabled suites / 671 tests passed; opt-in suites remain skipped in the default run; the new isolated Mongo suite is run separately. Final counts are included in the completion report.
- Foundation vectors and participant-authorization tests retained unchanged. The focused attachment gate passed 17 suites / 49 tests.
- Added explicit V2/version stripping, local verification/reset/commit-CAS, geometry/count, filename/MIME, source size, partial-output, quota exhaustion, concurrent duplicate/reservation, cancellation/stale callback and same-session reconciliation tests.
- Real isolated Mongo tests: concurrent create bounded at two; duplicate accounting stable; database-container restart preserves accepted chunks and incomplete state; quotas remain intact; bounded metadata projection excludes payloads; recipient download works; cancel removes payloads; empty account ledgers do not collide.
- Shared software fixture verifies Web and JCA sender output byte-for-byte in both directions and opens both on both implementations, covering Web→Android, Android→Web, Web→Web and Android→Android crypto/geometry interpretation. This is not physical interoperability or an Android UI/device/network claim.
- Android media/content/state/cancel/fixture tests (11) and app JVM tests (40), APK assembly and lint passed; final counts and APK identity are reported separately.
- SDK build, production Web build, repository lint, focused modern-target backend TypeScript and diff whitespace checks pass.
- Root TypeScript remains blocked by the pre-existing @k3ncrypt-vodozemac alias, ES6 replaceAll library, Vite/plugin module resolution and import.meta configuration issues. The feature does not modify root compiler configuration.

## Scope and remaining physical gate

No dependencies added. Reviewed attachment primitive/AAD/manifest/vector files and existing Keystore implementation are unchanged. Identity/session encryption algorithms and call/video signaling are unchanged; only the file authorization boundary uses existing protected records. Local Session, parked video-interoperability infrastructure, production/main, historical worktrees and preserved stash are untouched.

Physical Web↔Android file transfer is pending. Use a validated OPFS-capable Mac browser (Chromium has native disk evidence), the current Android APK and the normal authenticated HTTPS backend configuration with migrations applied. Verify real providers, permissions, filenames, storage-full behavior, cancellation/retry/relaunch, all four sender/receiver platform pairings as applicable, and actual byte equality. This feature does not require or import the parked local CA/proxy/Mongo configuration.
