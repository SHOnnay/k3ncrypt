# Relay server security

Updated: 2026-09-17.

## Capability authorization

Room identifiers are routing metadata, not authorization. A device creating a room now generates two independent 256-bit random values with WebCrypto:

- the invitation secret, used only for legacy message/signaling encryption; and
- the room-control capability, used only to authorize relay control operations and room membership.

The client sends only `SHA-256(control capability)` when creating a room. The server stores that verifier with the room and returns no capability. Both raw values travel in the URL **fragment**, which browsers do not include in HTTP requests. A capability holder sends the raw control value in `X-K3ncrypt-Control-Capability` for status, presence, and deletion and in the encrypted Socket.IO connection for `chat-join`. The server hashes it and compares fixed-length verifiers with Node `crypto.timingSafeEqual`.

The capability is a bearer credential shared by both invited participants. Anyone who obtains the full invitation can join, query authorized presence, and soft-delete the room. It is deliberately not an account system and does not distinguish an owner from an invited peer.

Rooms created before this schema have no verifier and fail closed. There is no room-ID-only compatibility fallback.

## Fixed vulnerabilities

- `DELETE /api/chat-link/:channel` no longer accepts knowledge of a UUID as authorization.
- `GET /api/chat-link/status/:channel` no longer reveals existence/deletion state to arbitrary room-ID holders.
- `GET /api/chat/get-users-in-channel` no longer reveals presence to arbitrary room-ID holders.
- `chat-join` requires the same independent capability before a socket is bound to a room.
- Control routes validate UUIDs, exact 256-bit base64url capabilities, exact 32-byte SHA-256 verifiers, allowed body/query fields, and bounded lengths.
- Control routes have a process-local token-bucket limit (burst 20, refill 0.25/second) keyed by source address and route. Socket traffic retains its separate per-connection limiter.
- CORS is no longer wildcard. `K3NCRYPT_ALLOWED_ORIGINS` is a comma-separated allowlist; development defaults to local Vite origins and production defaults to same-origin only.
- Relay envelopes now require an exact, bounded `{version,strategy,data}` schema. Unknown top-level fields, unsupported ranges, malformed acknowledgements, and oversized payloads fail closed.

Capability values are never interpolated into logs. Operators must also keep reverse-proxy header logging disabled for `X-K3ncrypt-Control-Capability`.

## Unavoidable relay metadata

The relay can observe client IP/network metadata, connection and message timing, room membership, temporary routing UUIDs, ciphertext size, room creation/deletion, and whether an authorized presence result is empty. It cannot read application plaintext or the legacy invitation secret. It briefly receives the control bearer on authorized requests; compromise while a request is active can expose it.

The in-memory limiter is not a distributed abuse-control system. Multi-instance deployment requires a shared rate limiter and proxy-aware address configuration. Room records are soft-deleted rather than cryptographically erased from database backups.
