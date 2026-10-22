# Contact-access incident: exact 871fa99 read-only investigation

Baseline: `871fa99d0ae94c88239f6c392325f224d2c085c4`.
Owner evidence: Render Deploys lists 871fa99 as Live, with aae9beb earlier; no Phase 4A deployment is shown. The site origin remains `https://k3ncrypt.onrender.com`.
No owner browser profile, vault, production API or database was accessed. This report distinguishes source reproduction from the owner's still-unconfirmed failure.

## Leading explanation and uncertainty

A remote pre-key lookup failure is a strong working hypothesis. Seven-day server pre-key expiry can block an established conversation on reload even when local pinned trust, session and history are intact. The baseline labels that HTTP 404 CONTACT_REGISTRY_MISSING. A genuine missing local contact record remains possible; neither the screenshot nor the code alone distinguishes these cases.

This does not establish that the owner's prekeys expired. The 404 also covers absent records and room/address authorization failure. No production record has been inspected, and no server state has been changed.

`git diff --name-only aae9beb80771bc1e0c221da96c74ccae52a3a0e4..871fa99d0ae94c88239f6c392325f224d2c085c4` lists only:

- README.md
- site/assets/k3ncrypt-appicon.svg
- site/index.html

There is no messenger-client, contact-registry, IndexedDB or backend change between those two deployed revisions. Phase 4A is not shown as deployed. A newly changed Web implementation is therefore unsupported as the explanation for this incident.

## Exact ordering and diagnostic sources

1. `ChatContext.restoreSession` first calls `refreshConversations(vault)` without a network room probe. `readConversationIndex` checks locally saved descriptors and `conversationEligibility` marks any local failures.
2. Normal saved-chat open/restore then calls `conversationEligibility(vault, descriptor, probeConversationRoom)`. This probes `/api/chat-link/status/<room>` FIRST. A 503 returns SERVICE_NOT_READY; 401/403 returns VERIFICATION_REQUIRED; structured expired/deleted states get their own codes. This status probe never fetches prekeys and does not return CONTACT_REGISTRY_MISSING.
3. If that probe passes, local eligibility reads the conversation-protocol record, validates the saved routing/address bindings, then calls `ContactIdentityRegistry.get(remoteAddress, false)`. An absent encrypted record returns CONTACT_REGISTRY_MISSING. This is BEFORE connect and its pre-key request. It does not mean a decryption error: AES-GCM authentication/JSON failures have different classifications. Pending bootstrap and unanswered invitation paths can intentionally return before a contact exists; those are not established contacts.
4. An eligible established conversation then enters `ModernConversation.connect`. At lines 586-592 it fetches the REMOTE public pre-key bundle again even when a session was restored. `service/api/client` preserves HTTP status on the thrown error. The baseline `safeDiagnostics` maps a pre-key 404 to CONTACT_REGISTRY_MISSING. This is AFTER the local contact check already succeeded for an ordinary established-chat open.
5. Local-address pre-key lookup happens later. Its failure is replaced by an invitation-expired message, producing CONVERSATION_INVITATION_LOOKUP_FAILED rather than CONTACT_REGISTRY_MISSING. Only after a successful self lookup can the existing conditional renewal run.
6. `safeDiagnostics` also preserves explicitly tagged CONTACT_REGISTRY_MISSING errors and maps `Unknown contact identity` exceptions from registry mutators to the same code. `get` itself returns undefined for absence; it does not throw that exception.

References: client/src/context/ChatContext.tsx:934,969; client/src/product/conversationRoom.ts; client/src/product/conversationEligibility.ts:15,27; client/src/product/safeDiagnostics.ts:34; service/src/crypto/modernConversation.ts:586,597; service/src/identity/contactIdentityRegistry.ts:132.

## Why contacts can disappear from normal Chats without deletion

- `classifySidebarConversations` moves every room with an availability diagnostic out of normal Chats, even for retryable network errors. Pending invitations and incomplete bootstrap records are also separated. It does not count verified registry entries.
- `Sidebar` shows the copy `No trusted contacts yet` whenever that filtered Chats array is empty. It therefore overstates what is known: saved conversations may still appear in Unavailable Conversations.
- `readConversationDescriptors` ignores invalid/duplicate descriptor projections; absent, malformed or non-array index content yields an empty projection, without deleting the raw encrypted index. Profile-name projection errors cannot delete a descriptor.
- `readConversationIndex` classifies malformed/duplicate entries and bounds display to the newest 1,000 entries. It retains unavailable nonterminal descriptors. Authoritative expired/deleted rooms are omitted from the in-memory projection. Neither this nor failed open/restore deletes the source index.
- The separate Contacts page uses saved descriptors and its search query, rather than filtering registry verification. The reported phrase belongs to the sidebar empty state.
- `ContactIdentityRegistry.get(..., false)` is read-only. A recovery-reset marker can report unverified state, but does not remove contact records or itself produce a missing-contact error. Profile visibility is a separate encrypted record and does not prove a specific contact still exists.
- The explicit `ModernConversation.delete()` path deletes its peer contact record. Ordinary `close`, failed connect, maintenance rejection and restore eligibility do not delete it.

Storage is IndexedDB `k3ncrypt-local-vault`, version 1, stores `vault_metadata` and `secure_records`. Record keys use stable `<type>:<id>` addressing. These implementations are unchanged between aae9beb and 871fa99. The owner confirms the same origin and Brave profile; a namespace change is not supported by current evidence.

## Pre-key availability is distinct from local trust

`backend/api/chatHash/prekeys.ts:12` sets a seven-day TTL. The authenticated GET returns 404 for invalid/unauthorized room/address, or absent/expired prekey records. Its response deliberately does not distinguish these cases. The Mongo expiry index can remove server records; it cannot delete the browser's IndexedDB.

Maintenance returns HTTP 503 with Retry-After. The room probe maps that to SERVICE_NOT_READY and error classification maps 5xx to NETWORK_FAILURE. A cold start or maintenance response alone does not explain CONTACT_REGISTRY_MISSING. A restart may merely expose an existing restoration/pre-key problem.

## Preserve the browser first (owner action only)

1. Do not clear site data, reset the vault, import/create identities, accept replacement invitations or reverify contacts.
2. In `brave://version`, note Profile Path privately. Do not share it. This identifies the actual user-data folder without reading K3NCRYPT records.
3. Quit Brave completely with Command-Q, including background Brave processes. Before another reopen/retry or any corrective change, preserve the complete enclosing Brave user-data directory (including Local State and all profile data) using an existing encrypted local backup/Time Machine, or copy it to an encrypted local drive/disk image. Use a new destination; do not overwrite an older backup. Never upload the profile or archive to chat/GitHub. A screenshot, HAR, bookmarks export or copied IndexedDB file while Brave is running is not an equivalent backup.
4. Keep the original directory in place. Do not restore over it or launch a copied profile as a recovery experiment. No backup/restore operation was executed by Codex.

## Smallest owner-run read-only diagnostic

After preserving the closed-browser backup, reopen the same Brave profile and same origin. No unlock is needed for key counts. Use the reviewed local script `scripts/diagnostics/web-contact-metadata-readonly.js` in DevTools (a Sources Snippet can run it). If browser protections block execution, stop; do not disable protections.

The script lists existing database metadata, refuses to create/upgrade a database, opens a readonly transaction and uses only `getKey`/`openKeyCursor`. It counts at most 10,000 keys and prints only allowlisted counts/booleans. It does not read vault values, ciphertext, contact IDs, fingerprints, credentials, or plaintext; it does not decrypt, fetch, write, delete, export or repair anything. It never runs on the owner's profile automatically.

Share only the object labelled K3NCRYPT_CONTACT_METADATA_V1. Do not share raw storage rows, browser profiles, invitation URLs, Network headers/bodies or HAR exports.

Interpretation:

- status OK, contactIdentityRecords = 0 with protocol/session records present: no contact-identity keys were found in this database. This supports a real local registry absence. It does not establish when/why records became absent.
- contactIdentityRecords > 0: globally missing contact storage is disproved, but counts do NOT establish that every saved room's particular record exists, parses, decrypts or matches its pin.
- truncated true: counts are lower bounds. A zero count cannot establish absence beyond the inspected bound.
- VAULT_DATABASE_ABSENT / UNEXPECTED_SCHEMA / other BLOCKED: stop. Do not create a database or attempt repair.

If DevTools Network ALREADY contains the failed opening, note only whether room-status succeeded and whether a subsequent GET to a prekeys endpoint returned 404. This combination supports post-local-check failure for an established saved room. Do not export requests or reveal their room/address path segments, capabilities, headers or response bodies. Do not reload or reopen solely to capture a new request before preserving the backup; a normal reopen is not a read-only diagnostic because successful protocol operations may write state.

If no existing network evidence is available, report that limitation. Counts alone cannot settle per-room binding. Further targeted local decrypt/eligibility inspection or a normal reopen requires an explicitly agreed procedure; do not infer a missing record from this UI label.

## Reproduction and narrow prepared correction

- Evaluating the exact 871fa99 classifier on an ApiError(404, Pre-key bundle unavailable) returns CONTACT_REGISTRY_MISSING.
- A disposable ModernConversation establishes a session/history and explicitly verifies its contact. After close, a mocked remote pre-key 404 blocks reconnect while the pinned verified contact, protocol, session and history bytes remain unchanged; nothing is sent.
- The isolated candidate changes only the diagnostic taxonomy: prekey 404 -> CONVERSATION_PREKEY_UNAVAILABLE (retryable, nonterminal). Local registry absence still maps to CONTACT_REGISTRY_MISSING. No trust gate or protocol is bypassed. This does not restore contacts, fix prekey expiry, or deploy code.
- Tests demonstrate normal Chats filtering can become empty while canonical records and the saved descriptor remain intact.

## Validation

161 focused Jest tests passed across eight suites: eligibility, safe diagnostics, room status, session index, contact registry, ModernConversation, backend prekeys and maintenance gate.
Seven disposable Chromium diagnostic tests passed: counts-only access under guards refusing value reads/writes/network; absent contacts with retained sessions; missing DB/no creation; wrong origin; unexpected schema/no migration; deletion/enumeration race/no creation; 10,000-key bound. All browser routes are fulfilled from memory and no live origin was contacted.
Changed-file ESLint and git diff --check passed.
Initial backend tests were blocked by sandbox EPERM on local socket binding; the same focused tests passed with approved local test-socket access. There was no test-source workaround.
Whole-client TypeScript check is BLOCKED by the reused dependency tree missing @zxing/browser, causing TS2307 and two consequent implicit-any errors in existing LocalQr/InvitationQr. No dependency installation or source workaround was attempted. Relevant changed TypeScript and service test code compiled through ts-jest. No production bundle was built.
No physical/browser-owner recovery has been tested or claimed.

## Recovery boundary and next evidence

If canonical contact records remain, encrypted trust/history may be intact and the blocker may be server-side availability/authentication. If a specific canonical verification record is genuinely absent, an authenticated prior encrypted backup may preserve it; a descriptor or public bundle alone cannot safely recreate the old verified decision. Do not automatically observe/pin a replacement, republish an identity, extend expired server trust or import trust from another device.

Next evidence needed: the counts-only diagnostic result and any ALREADY captured sanitized room-status/pre-key response statuses. A pre-key 404 alone cannot distinguish expiration from authorization. Production data access or trust-recovery changes remain outside this task.
