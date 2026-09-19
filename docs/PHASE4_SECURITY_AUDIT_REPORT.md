# Phase 4 security audit report

Audit date: 2026-09-20

Scope: Phase 3 and Phase 4 secure messaging, identity/verification, offline
delivery, attachment encryption and delivery, authorization context, persistent
storage, media workflow, API gateway, and frontend privacy boundary.

## Tested areas

- Modern Vodozemac conversation establishment, restart, identity change, and
  delivery behavior.
- Attachment encryption/decryption, authenticated chunk ordering, tamper and
  missing-chunk rejection.
- Media preparation and media-reference parsing for image, file, and voice
  messages.
- Attachment service authorization, capability rejection, expiry, deletion,
  and generic errors.
- Conversation authorization: membership, conversation scope, permission
  scope, context expiry, and request replay.
- Persistent adapter restart recovery, duplicate protection, expiry cleanup,
  and storage-field inspection.
- Authenticated route factory: authorized upload/completion and missing/wrong
  context rejection.
- UI media boundary: protected labels, temporary object URLs, generic errors,
  local export/playback, and microphone stop/cancellation behavior.

## Passed validation

- Full Jest regression: 53 suites passed, 1 skipped; 284 tests passed, 1
  skipped.
- TypeScript checks passed.
- ESLint passed.
- Client production build passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check` passed.
- Focused attachment, media, authorization, persistence, and route tests passed.
- Browser Vodozemac artifact tests passed, including missing/corrupt artifact
  fail-closed cases.

## Browser validation failure

Playwright ran 8 tests: 3 passed and 5 failed. The five failures were the
invite-link and modern-conversation scenarios; each timed out before an invite
was generated, with the invite field remaining empty. Reproducing the test
environment showed the development backend could not bind because port 3001
was already occupied (`EADDRINUSE`). These scenarios are therefore not a
security pass and must be rerun in an isolated environment with clean backend
and frontend processes before release.

## Security findings

No plaintext media, attachment keys, filenames, previews, EXIF, public URLs,
or storage paths were found in the persistent metadata/chunk model. Capability
verifiers are hash-only and compared in constant time. Ciphertext tampering,
wrong keys, reordered/missing chunks, wrong users, wrong conversations,
expired contexts, expired attachments, and replayed authorization contexts fail
closed with generic errors.

The UI creates temporary Blob URLs only after local decryption and revokes them
when replaced or unmounted. It does not persist decrypted media. Microphone
access is foreground-triggered and tracks stop on stop/cancel.

## Remaining risks and blockers

1. The attachment route factory is not mounted into the production app because
   a real deployment session verifier is still required. The frontend gateway
   requires an injected authenticated-header provider. Live media delivery is
   therefore not production-enabled.
2. `MediaMessageWorkflow` carries the attachment key and capability inside the
   protected media reference. This is safe only when sent through an active
   modern E2EE conversation; callers must not use it with legacy or disabled
   protocol paths. The UI currently gates media actions to modern mode.
3. Persistent expiry cleanup is an explicit scheduled operation; a deployment
   must run it reliably. Mongo metadata/chunk cleanup is not a cross-collection
   transaction.
4. Logging review found existing generic backend startup, socket, and error
   logs. No media plaintext or key logging was observed, but production log
   redaction and retention still require deployment verification.
5. Browser end-to-end validation remains blocked by the environment conflict
   described above.

## Production readiness assessment

Security foundations and regression coverage: **PASS**.

Production media delivery: **NOT READY** until the deployment supplies and
mounts the real authenticated session verifier, attachment route dependencies,
persistent Mongo adapter, expiry scheduler, and an isolated successful browser
end-to-end run. No architecture or security-core changes are recommended by
this audit.
