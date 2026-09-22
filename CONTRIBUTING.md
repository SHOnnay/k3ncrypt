# Contributing to K3NCRYPT

K3NCRYPT is a fork of [muke1908/chat-e2ee](https://github.com/muke1908/chat-e2ee) under Apache-2.0. Preserve upstream attribution and license notices.

## Workflow

1. Create a topic branch from `main`.
2. Keep changes focused and describe the problem they address.
3. Add meaningful tests for changed behavior.
4. Run lint, tests, the service build, and the client build before opening a pull request.
5. Include validation results and known limitations in the pull request.

Use conventional commit messages, for example `fix: reject stale device proof`.

## Security-sensitive changes

Changes involving identity, lifecycle state, proofs, cryptography, persistence, relays, attachments, calls, or private networking require security-focused review. Do not introduce alternate authorization paths, plaintext logging, private-key export, or test-only enforcement. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
