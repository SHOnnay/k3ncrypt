# Saved-contact availability correction (local candidate)

Base: 1146778baf4a552c778a9402c904c036b49506f4, isolated branch codex/web-contact-recovery-871. The source ancestry remains based directly on live 871fa99. No other development history was merged.

## Owner files

The existing K3NCRYPT-Contact-ReadOnly-Diagnostic.js and K3NCRYPT-Contact-Recovery-ReadOnly-Guide.md were copied byte-for-byte from /private/tmp to the owner's requested Downloads names. Existing files would not have been overwritten if different. They were not executed in the owner's browser.

Script SHA-256: eea572d88df49d2c9a5ea24fc357247003e628bcf94edf0287880d58be064f28
Guide SHA-256: e6fce1ab1970419d8e8e5e970d6b8fb493853b564157fd2ffde4b1642b1a3686

The script itself was not changed. Source review confirms that it opens only a readonly transaction, inspects record keys/counts and metadata-key presence, aborts attempted schema creation/upgrades, and prints only allowlisted aggregate counts/flags. No network primitive, crypto/decryption API, record write/delete, identity API, Blob/download/export API or plaintext value read is called. Disposable Chromium tests additionally deny writes, value reads, network access, decryption and Blob URL creation, while checking that stored values remain identical. The console counts are its diagnostic output, not a vault/record export.

## Functional changes

1. Saved, identity-bound conversation descriptors remain visible in normal Chats for the explicit remote availability diagnostics CONVERSATION_PREKEY_UNAVAILABLE, NETWORK_FAILURE and SERVICE_NOT_READY. Pending bootstrap, unbound descriptors, missing local identity, identity change, authorization failure and terminal-room states retain the existing separate presentation. Duplicate/conflicting security diagnostics still block the normal Chats row.
2. A pre-key availability failure shows `Contact saved · reconnection paused`. App-level feedback explains that required server keys are unavailable, preserves the existing contact, and offers an ordinary bounded manual retry. It does not claim the session is connected, restored or usable.
3. An existing session's own-address pre-key GET previously replaced every error (including service failure) with an invitation-expired/create-new-conversation instruction. It now propagates the original error/status for established saved sessions. Initial invitation behavior is unchanged. Connection remains fail-closed.
4. The preceding local CONTACT_REGISTRY_MISSING versus remote CONVERSATION_PREKEY_UNAVAILABLE distinction is preserved.

Presentation cannot grant trust. Eligibility, canonical contact lookup, identity commitment comparison, room status, transport authentication and normal session restoration all still run before connection. There is no new verification shortcut, session cloning, key publication, plaintext storage or automatic retry worker.

## What existing authenticated recovery can and cannot do

The current backend's POST /prekeys/:address/renew requires an authorized room, existing server record, matching ownership proof and unchanged Curve25519/Ed25519 public identity. The existing client already uses that endpoint to renew its own available binding when needed. This correction does not replace that mechanism.

When a transient lookup failure clears and the original matching authenticated prekey material remains available, normal manual retry restores the existing encrypted session. Regression coverage confirms unchanged verified contact bytes and message history; it makes no new identity publication, one-time-key claim or explicit verification decision.

After the seven-day expiry cleanup actually removes a server prekey record, the current renewal endpoint cannot authenticate renewal because its reference proof/identity record is gone. A disposable test keeps the room active, ages just the prekey record by seven days, observes 404, then attempts renewal with the original valid room capability/proof and same identity: the server returns 403 and no replacement record is created. A peer cannot renew someone else's address with the peer's own proof.

No recovery of deleted server authority was implemented. In that case this candidate resolves hiding/misdiagnosis and preserves access records, but does NOT restore online communication. Restoring deleted authority would require a separately reviewed authenticated recovery design or independently preserved authoritative server state; the local descriptor or public bundle is not sufficient. No owner-specific diagnosis is established until the owner-run metadata check and appropriate status evidence are available.

## Validation

179 focused Jest tests passed in 10 suites: conversation eligibility, safe diagnostics, room status, session index, real Sidebar rendering, contact registry, ModernConversation, original backend prekeys, the new prekey recovery-boundary test, and maintenance gate.

Eight disposable Chromium checks passed: seven original metadata-diagnostic guards plus one browser-restart fixture. The restart fixture uses actual BrowserSecureStorage AES-GCM/Argon2id wrapping, IndexedDbVaultPersistence, contact-registry reads, eligibility and the real Sidebar component. It closes and relaunches a fresh persistent Chromium profile, verifies the vault starts locked, unlocks with a synthetic test passphrase, and checks that verified pin/history remain identical while the seven-day-unavailable contact remains visible and paused. It separately models a transient outage clearing. Every browser request is intercepted; no production service is contacted. This is encrypted-persistence/presentation evidence, not a full real-WASM messenger or physical-owner recovery test. Actual connection and renewal behavior are exercised separately with disposable service/provider fixtures and authenticated local backend API fixtures.

Client TypeScript passed with the candidate's own service/src/sdk.ts mapped explicitly (not a newer checkout), plus existing locally available client type dependencies. Changed-file ESLint and git diff --check passed. No dependencies were installed; ignored symlinks in this isolated worktree reuse installed packages without changing their source worktrees.

Initial failures were corrected: a test-only unused React import; a missing test bundler resolved from the service's already-declared/installed dependency; temporary TypeScript config type-root resolution; and shared test-fixture rate pressure. The new backend case now runs in its own Jest runtime with the original real rate limiter enabled. No production quota or authorization was weakened and no artificial sleep was introduced.

No production build, deployment, APK, push, merge, live MongoDB access, owner browser access, identity update or vault change was performed. Owner access remains unchanged until a separately approved procedure is used.
