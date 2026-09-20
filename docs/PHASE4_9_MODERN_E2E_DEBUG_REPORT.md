# Phase 4.9 Modern Conversation E2E Debug Report

## Root cause

The isolated Playwright backend ran with `NODE_ENV=test` on `127.0.0.1:43101`, while Vite ran on `127.0.0.1:43102`. The backend's existing CORS policy intentionally allows no cross-origin requests in test mode unless `K3NCRYPT_ALLOWED_ORIGINS` is configured. Browser diagnostics showed CORS preflight rejection for `POST /api/chat-link` and Socket.IO polling. The invitation-creation request never reached the application, and the test subsequently timed out locating the `Modern invitation` textbox. Backend startup itself succeeded and used volatile test storage.

## Fix

The Playwright-managed backend now receives `K3NCRYPT_ALLOWED_ORIGINS` set to the exact isolated client origin. The production CORS policy, identity, encryption, protocols, mailbox, and media systems are unchanged. The browser test additionally asserts that invitation creation returns HTTP 200 before checking the invitation UI; this catches an environment regression at its source without weakening the Alice/Bob assertions.

Diagnostic logging was temporary and was removed from the permanent test to avoid emitting invitation or identity material. The captured evidence was the browser's CORS error, failed request path, and missing invitation selector; no request bodies or tokens were added to the report.

## Validation

- Chromium modern flow: passed. Alice and Bob establish a modern conversation, exchange messages after recipient absence, retain verification across restart, continue bidirectional messaging, and assert message plaintext does not appear in captured outbound traffic or browser web storage.
- The existing Vodozemac Chromium browser smoke test previously passed on isolated ports.
- Jest, TypeScript, ESLint, and client build results for this change are recorded in the completion report.

## Remaining limitations

- This test uses an in-memory backend. Production Mongo persistence and cross-instance failover require deployment validation.
- Firefox and WebKit full modern flows were not part of this Chromium-specific debugging gate.
- This does not approve a modern-default-beta rollout by itself; the Phase 4.7 browser matrix and other acceptance gates still apply.
