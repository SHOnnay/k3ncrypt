# Alpha contact identity and verification

## Claimed profiles

Web uses `k3ncrypt-profile:` plus a version-1 JSON control payload inside the existing encrypted message envelope. Fields are `version`, `displayName`, `identityFingerprint`, and monotonic local `revision`. No encryption primitive, ratchet, signature scheme, fingerprint, or verification-authority rule changes. The relay receives ciphertext, not the display name. Profiles are not a public directory and are not published in invitation links or public pre-key bundles.

Names are normalized NFC text, at most 40 JavaScript characters and 160 UTF-8 bytes; control and directional override characters are rejected. The complete control is limited to 1024 UTF-8 bytes. React renders names as text. Unknown versions and malformed controls are consumed safely without becoming chat messages. Acceptance requires a matching currently pinned, unchanged peer identity, and the profile record joins the existing inbound atomic acceptance transaction. Older revisions are ignored. Records are scoped to the protected room and identity; an identity change hides the old claim.

An initial profile is shared after the protected session is established. The first valid peer profile prompts one identity-bound profile reply after route commit; this lets an initial claim arriving before contact-record creation be safely republished without accepting it early. Editing the local profile republishes it through each saved established relationship, with durable encrypted outbox retry. Unopened relationships are connected sequentially with the normal durable inbound consumer; failure retains the local update for publication when reopened. These claims never write contact verification records. Local nickname overrides the remote name; existing custom local labels retain their priority. Duplicate names are allowed and never merge identities. Reopening the same room reuses its existing descriptor; separate rooms stay separate.

## Account and invitation continuity

An unlocked vault is reused for creation of new relationships and acceptance. A locked existing vault must unlock its original records; it is not initialized again. A genuinely new device explicitly chooses its name and confirms its passphrase before creating a vault. A pending URL invitation is retained until acceptance finishes, then removed from the active URL. Names are not invitation authority.

New room invitations carry the existing random 256-bit capability in the URL fragment and are rate limited. Fresh pre-key publication reserves an atomic seat: one creator and one recipient, within 24 hours. Consumed seats are not reopened after an uncertain insertion outcome. Reopening a saved relationship uses its existing publication instead of claiming another seat. Expiry applies to joining, not established room operations or authenticated pre-key renewal. Historical rooms without the new expiry fields retain their compatibility behavior. No short manual capability code or searchable username service is added.

## Human verification

QR version 1 contains the existing complete public pinned identity fingerprint and algorithm marker. The scanner validates the existing strict local payload format and compares it to the current peer fingerprint. Matching only enables an explicit verification action; mismatching clears confirmation. Camera capture starts only on a user action and stops on exit or backgrounding.

The apart-comparison code is six groups of five decimal digits. Compute SHA-256 over UTF-8 of `k3ncrypt:relationship-comparison:v1`, NUL, and JSON.stringify of the lexicographically ordered pair of complete fingerprint strings. Take the first 12 digest bytes as six unsigned big-endian 16-bit integers; left-pad each decimal representation to five digits and join with ` · `. Both sides get the same code; names are excluded. Changing either fingerprint changes the derivation input. No remote resources or word lists are loaded.

The representation retains 96 digest bits (each group ranges from 00000 to 65535). An unrelated accidental collision has probability approximately 2^-96. Truncation is a human comparison aid, not a replacement fingerprint or signature. A generic attack searching two attacker-controlled identity pairs has a birthday bound near 2^48; compare the complete QR when nearby and use a trusted independent channel when apart. Comparing without the other person is not verification.

Confirmation is bound to the displayed pair and cleared when either identity changes. Changed identity remains blocked until explicit change review and a fresh verification. Verification still uses the existing local canonical contact registry; names and QR scanning cannot set trust automatically.

## Settings scope

The alpha Web UI hides native screen-capture protection and media auto-download toggles because neither is implemented by this Web client. Their underlying preference fields remain for future work. Working appearance, profile, encrypted-vault lock status, blur, notifications, call preferences, identity verification, device approval, and connection information remain accessible.

The file limit stays 8 MiB. File-transfer internals and call-state implementations are outside this pass.
