# Security policy

K3NCRYPT is beta software. A passing test suite does not guarantee that the system is free of vulnerabilities.

## What the web client cannot protect against (P1-4)

K3NCRYPT encrypts messages, files and calls on the user's device, and the relay only carries ciphertext. That protects against a **passive or curious server**. It does not fully protect web users against an **actively malicious or compromised host**:

- The web client's JavaScript and WASM are served by the same origin as the relay (`app.ts` serves `client/dist`). Nothing in the browser pins or attests that code.
- Anyone who controls that origin (a compromised Render account, a malicious deploy, a hijacked domain) can serve a modified client that reads the passphrase, the vault or plaintext before encryption.
- Contact checking (security numbers, QR) proves who is at the other end of a conversation. It cannot detect a modified client on your own device.

Mitigations in place: strict CSP with no third-party scripts or fonts, HSTS, same-origin WASM, and no CDN. They raise the bar against injection but do not defend against the host itself.

Recommended: use the Android app for the highest assurance, because it is installed once rather than downloaded on every visit. Users see this in plain words under Settings → About security.

Possible future work: publish reproducible build hashes of `client/dist` per release, and serve the client from a separate origin from the relay.

## Reporting a vulnerability

Report suspected security issues privately before opening a public issue. Until a project security address is configured, use the repository owner’s private GitHub contact channel or a private maintainer discussion. Do not include secrets, personal data, message content, or live-user identifiers.

Include the affected version or commit, component, security impact, and a minimal safe reproduction description. Redact credentials and private material. Maintainers will acknowledge, assess, coordinate a fix, and publish disclosure details when users can protect themselves. No response time or bounty is guaranteed.

## Supported versions

The actively developed `main` branch is the current security-review target. Beta releases may contain unresolved limitations documented in their release notes.
