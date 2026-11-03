# Decision: what Android shows as the security number

Status: decided by the owner, 2026-11-03. Applies to Android milestone A0 and the web check flow.

## Decision

1. Android's contact check shows the **30-digit per-contact number** and the **verification QR**, exactly as web does:
   - Number: `deriveHumanVerificationCode` (`service/src/identity/verificationFoundation.ts`): SHA-256 over `k3ncrypt:relationship-comparison:v1\0` + the JSON array of both `K3 …` fingerprints, sorted. Six groups of five digits, joined by ` · `. Both people see the same number for their pair.
   - QR: `{"version":1,"algorithm":"vodozemac","fingerprint":"K3 …"}`, the canonical payload in `protocol-fixtures/v1/verification-qr.json`.
2. The `K3 …` identity fingerprint is shown **only under Security details** on Android, as on web. It is not the number people compare.
3. **Once Android A0 ships**, web removes the "Is <name> using K3NCRYPT on an Android phone?" step and its Android path (`client/src/components/Settings/VerificationPanel.tsx`, the `android*` strings in `client/src/content/checkCopy.ts`). Web then uses the same scan / compare-numbers flow for every contact.

## Why

The 30-digit number is short enough to read aloud and identical on both sides, so neither person has to copy a long fingerprint. Showing one number on both platforms removes the separate Android path, which today leaves Android contacts "Not checked yet" on web and blocks their files there.

## State on 2026-11-03 (read-only review)

- `codex/android-beta23-stabilization` (`76eade5d`) already implements both: `RelationshipComparisonCode.kt` (same calculation and format) and `VerificationQr.kt` / `VerificationQrCode.kt` (byte-compatible payload, show and scan). None of it is on `main` or `m3/hardening`.
- No shared fixture for the 30-digit number: web's test recomputes it and Android's test hard-codes its own vector (`62986 · 29402 · 06636 · 16135 · 54684 · 29097`). Android does not parse `verification-qr.json`.

## A0 scope that follows from this

- Bring beta23's comparison number and verification QR onto the release line.
- Add `protocol-fixtures/v1/relationship-comparison.json` (fingerprint pairs → expected number, both orders) and read it from both the Jest and the Kotlin tests. Make Android's QR test parse `verification-qr.json`.
- Move the `K3 …` fingerprint display on Android under Security details.
- Then, in a web release after A0 is installed: drop the Android step from the web check flow and update `verification-qr.json`'s note.
