# Unlock speed: measurements and proposal (UX A11)

Status: decided 2026-11-03. A (keep Argon2id) and B (unlock waits only for local work) are done; C is partly done. See "Result" at the end. Argon2id parameters are unchanged.

## What was reported

Unlocking took 5–6 s on an M-series Mac (production, Brave).

## Measurements (2026-11-03, Apple M1)

| What | Result | Evidence |
|---|---|---|
| Current Argon2id parameters | m = 19,456 KiB (19 MiB), t = 2, p = 1, 32-byte output (`PRODUCTION_ARGON2ID_PARAMETERS`) | [read code] `service/src/storage/secureVault.ts` |
| Argon2id alone, Node, `hash-wasm` | 25–33 ms per derivation (6 runs) | [local run] |
| For comparison | m = 46 MiB, t = 1: 49 ms; m = 64 MiB, t = 3: 140 ms | [local run] |
| Browser unlock, vault open (KDF + profile read) | 44–46 ms | [local browser run], 3 rounds |
| Browser unlock, whole flow to the open chat, local stack | 384–388 ms | [local browser run], 3 rounds |
| Requests made while the unlock screen waits | 10, mostly in sequence: room status probe; Socket.IO handshake (4); prekey GET, renew POST, GET; device-trust proof × 2 | [local browser run] |
| Production round trip from this Mac | ~110 ms per request on a kept-alive connection, ~220 ms on a new connection | [production], read-only `curl` on `/api/health` |

**Conclusion: Argon2id is not the cause.** It is about 1% of the unlock time. The unlock screen waits for about ten network round trips to Render, mostly one after another. From this Mac that is roughly 1–2 s. On a longer route, plus TLS setup, it reaches 5–6 s. A free Render instance waking from sleep adds much more.

No phone was measured. WebAssembly on a mid-range Android phone is typically several times slower than an M1, so the current parameters should take roughly 0.2–0.5 s there. That estimate is unconfirmed.

## Options

### A. Argon2id parameters: keep them (recommended)

The current parameters are the OWASP minimum for Argon2id, and the vault refuses anything weaker (`memoryKiB < 19,456` or `iterations < 2` fail validation). They already fit the 1–1.5 s target on a mid-range phone with room to spare. Lowering them would make offline guessing of a stolen vault cheaper, and it would not fix the 5–6 s.

If more resistance is wanted at the same speed, OWASP's alternative profile, m = 46 MiB, t = 1, p = 1 (49 ms here), is more memory-hard for similar time. Trade-offs: more memory per unlock, and existing vaults keep their stored parameters until a migration re-wraps the master key on the next unlock (not implemented).

### B. Make unlock wait only for local work (recommended; needs your approval)

Close the unlock screen once the vault is open and the chat list is read (about 0.1 s here). Then connect in the background, with the existing connection status ("Connecting…") in the chat header. Sending is held until connected, as it is today during reconnects. This cuts the waiting screen from 5–6 s to well under 1 s on any network. It does not change what is protected or checked: device proofs, room authorization and the contact check still gate every send and call.

### C. Fewer round trips (independent of B)

- Do the prekey status, renew and re-read in one request instead of three.
- Send one device-trust proof per join instead of two.
- Start the Socket.IO connection with WebSocket directly instead of polling, then upgrading.

Each saves one or more round trips per unlock and per chat opened.

## Decision needed

1. Keep the Argon2id parameters (A, recommended), or move to m = 46 MiB, t = 1 with a re-wrap migration.
2. Approve B (unlock waits only for local work).
3. Schedule C as a relay/client performance task.

## Result (2026-11-03)

Owner decision: keep the Argon2id parameters, do B, and cut the sequential round trips.

What changed:
- **B.** `restoreSession` returns once the vault is open and the chat list is read. The first saved chat then connects in the background, the same way a selected chat opens: its row shows as opening, and a click on another chat supersedes it. The unlock progress is now two steps (unlocking, opening chats).
- **C, status probe.** The startup path no longer asks for the room status before connecting. Local eligibility decides; the status is read only if admission fails, to report expiry or deletion. This is the rule `openConversation` already followed.
- **C, transport.** Socket.IO opens over WebSocket first (`RELAY_SOCKET_OPTIONS`), with polling as the fallback (`tryAllTransports`). This removes the three polling handshake requests.

Not changed, with reasons:
- **Two device proofs.** Both are `relay:message`: one for the channel join, one for the first protected send after it. They are separate operations, and proofs are single-use by design, so they stay separate.
- **Prekey requests.** The three are: read own key bundle, renew it (only when fewer than 10 one-time keys remain), read the contact's bundle. They are not a re-read of the same thing. Combining them needs a new relay endpoint that Android would share; left for the relay performance task.

Measured with the opt-in spec `e2e/unlock-timing.spec.ts` (`UNLOCK_TIMING=true`): local stack, 110 ms added to every HTTP request, 3 rounds each. The test cannot delay WebSocket frames, so production numbers will be higher in both columns.

| | Before (`6948f4a6`) | After |
|---|---|---|
| Unlock screen open after clicking Unlock | 885–947 ms | 133–137 ms |
| HTTP requests while the unlock screen waits | 9 | 1 |
| HTTP requests until the chat is connected | 9 | 5 |
| Chat connected and ready to send | 894–954 ms | 1006–1008 ms |

Time until the chat is connected is about the same locally. The network chain is shorter by four requests, but the app now renders while the connection finishes, which adds about 100 ms of main-thread work on this stack. On production, each removed request is about 110–220 ms, so the connected time should drop by roughly 0.4–0.9 s there; this is unconfirmed until measured after release.
