# Domain cutover plan (not started — waits for the owner's domain)

Status 2026-11-14: no domain chosen. Nothing in this plan has been done. **Stop point: step 5 (DNS).**

## Why this must happen before more people use it
- A web vault belongs to its origin. Today that origin is `k3ncrypt.onrender.com`; if the host ever changes, every web user loses their vault.
- The Android build has the backend URL baked in. A domain you control lets the host change without a new app.
- The review's decision: the web client moves to its own origin, separate from the relay, with a published build hash.

## Target layout
| Name | Serves | Host |
|---|---|---|
| `app.<domain>` | Web client (static files only) | GitHub Pages, built by a public workflow from a tag |
| `relay.<domain>` | Relay API + Socket.IO | Render (custom domain on the existing service) |
| `<domain>` | Landing page | GitHub Pages (existing `site/`) |

## What changes in code (all prepared and tested before any DNS change)
1. Relay: `K3NCRYPT_ALLOWED_ORIGINS=https://app.<domain>` (keep the old origin during the overlap); `CHAT_LINK_DOMAIN`; CSP `connect-src` for the relay name. The relay stops serving the web client only after the overlap.
2. Web: build with `CHATE2EE_API_URL=https://relay.<domain>`; new workflow `web-release.yml` builds from a tag, publishes to Pages, writes `build-hash.txt` (SHA-256 of the bundle) and a build provenance attestation; Settings → About shows the same hash.
3. Android: `-Pk3ncryptBackendUrl=https://relay.<domain>`; App Links host `app.<domain>` (needs `/.well-known/assetlinks.json` on that origin with the release certificate fingerprint); invitation links use the new host.
4. Invitation links: old `k3ncrypt.onrender.com/#…` links keep working during the overlap (the old origin redirects with the fragment kept, which a static redirect page can do).

## Web vault move (the only hard part)
A browser cannot read another origin's IndexedDB. Options, in order of preference:
1. **Export/import through the backup v1 format** (milestone 18): old origin "Move to the new address" → encrypted file → new origin imports it. Needs backup v1 first.
2. Do the cutover **now, before anyone but the owner has a web vault**: the owner re-creates the web identity and re-checks contacts once. This is the cheap path and the reason to decide soon.

## Cutover steps
1. Owner: get the domain; add it to GitHub Pages and to Render as custom domains (both issue TLS automatically).
2. Agent: code changes above on a branch; E2E gate green 3×; Android build against the new relay name, release-signed.
3. Agent: deploy the relay with both origins allowed (no user-visible change).
4. Agent: publish the web client to `app.<domain>`; verify hash, CSP, no third-party origins, and a two-browser smoke test against production.
5. **STOP. Show the owner the DNS records to create and the rollback. Owner creates DNS records (TTL 300).**
6. Phone: install the new Android build over the old one; check that chats, checks and calls still work.
7. After 14 days of overlap: the old origin serves only a "we moved" page; remove it from allowed origins.

## Rollback
Before step 7 nothing is removed: point users back to `k3ncrypt.onrender.com`, redeploy the previous relay commit, reinstall the previous APK. DNS TTL 300 keeps this to minutes.

## What the owner must decide
- Which domain (Student Pack free year, or buy one). A name you can keep paying for matters more than which registrar.
- Whether to do the cheap path (2) now, or wait for backup v1 and move vaults properly.
