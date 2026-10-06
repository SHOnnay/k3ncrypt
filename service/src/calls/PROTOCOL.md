# Call signaling protocol

## Supported wire version

Current Web and Android clients send and accept call signaling protocol **v2** only. The minimum compatible build is the first K3NCRYPT build that emits `protocolVersion: 2`; the repository does not identify that build with a released version number. A call attempt stores v2 with its `callId`, and every signal in that attempt must remain v2.

## Authentication and downgrade handling

Signals are plaintext only inside the existing end-to-end encrypted conversation session. That session authenticates the peer. The v2 SHA-256 digest uses the domain `k3ncrypt:call-signal-digest:v2\0` and includes `protocolVersion` in its canonical input. The digest is not a MAC and does not replace the authenticated session. The relay forwards the encrypted envelope and neither chooses trust nor interprets the inner version.

The original unversioned digest remains unchanged for historical fixtures. A missing version is pre-v2; a valid legacy digest can be recognized to show an incompatibility message, but it is never admitted. Removing or changing the v2 version makes its digest fail. Unknown versions can produce an incompatibility notice after the encrypted peer, conversation, and identity binding checks, but never enter call or replay state. Unknown fields are rejected for v2. There is no downgrade or legacy fallback.

## Expiry and lifetime

Historical legacy clients use `expiresAt` as the invitation/setup deadline for the whole call attempt. Pre-versioned hardened builds also exist whose later messages used individual freshness, but they carry no discriminator; all unversioned traffic is therefore unsupported rather than guessed.

In v2, the INVITE's `expiresAt` is both its message freshness bound and the setup deadline. Each later signal has a new `expiresAt` no more than 60 seconds after its timestamp. The setup deadline remains fixed, while an established call may continue after it; later offers, answers, ICE, reconnect, and hangup signals still need their own fresh bounds. Expired, malformed, unsupported, or semantically inconsistent signals are rejected before replay state is claimed.

## Rolling upgrades

Deployments may contain pre-v2 and v2 clients, but they cannot establish a compatible call. A v2 client receiving an authenticated legacy INVITE reports that the contact needs a newer K3NCRYPT version. A legacy client rejects v2 because the v2 digest differs from its historical digest. That rejection is silent to the sender, so a v2 caller cannot reliably distinguish an older client from no answer and must not label a timeout as a version failure. Update both peers to a v2-capable build; neither side falls back to legacy expiry semantics.
