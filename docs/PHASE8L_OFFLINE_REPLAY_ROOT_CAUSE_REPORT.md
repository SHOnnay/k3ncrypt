# Phase 8L Offline Replay Root-Cause Report

## Proven problems

### 1. Relay join acknowledgement is coupled to mailbox processing

**Evidence:** The relay waits for a client `accepted` callback before returning the `chat-join` acknowledgement. `ModernConversation.connect()` waits for that acknowledgement while it is still in its connection transition.

**Effect:** Reconnect success depends on completion of inbound message processing. Any delay in encrypted session setup or vault persistence prevents the connection transition from completing promptly. The ten-second replay acknowledgement deadline can expire while that transition is still active.

**Fix:** Split authenticated admission from mailbox replay. Complete the join after authentication, routing ownership, and durable proof validation. Then replay mailbox records after the connection transition has released its lock. Keep each encrypted mailbox record until the existing explicit accepted acknowledgement arrives. This preserves persistence-before-acknowledgement and avoids accepting unvalidated data.

### 2. Inbound failures are collapsed and hidden by the transport callback

**Evidence:** `SocketIoRelayTransport.acceptChatEnvelope()` catches all errors and returns an unsuccessful acknowledgement. Earlier runtime code also grouped account, session, persistence, and framing errors together.

**Effect:** The UI receives neither the message nor a usable safe error category, and the relay sees only `accepted: false`. This made the investigation incorrectly attribute the failure to Vodozemac authentication.

**Fix:** Preserve an internal, non-sensitive failure category through the client callback: `bundle`, `runtime-entry`, `wasm-authentication`, `session-state`, `persistence`, or `framing`. Show a generic retry-safe UI error. Do not include keys, ciphertext, plaintext, or server details.

### 3. The claimed mailbox item is retained but not promptly retried

**Evidence:** A rejected replay stays claimed until its lease expires. The client reconnects successfully but the message is still absent during the test window.

**Effect:** A transient startup ordering failure delays delivery until the claim lease expires or another replay attempt occurs.

**Fix:** Add an authenticated post-connection mailbox replay request after the client has completed initialization. It must use the same device proof, routing authorization, and explicit accepted acknowledgement. It must not delete or accept failed envelopes.

## Confirmed non-causes

- MongoDB persists the encrypted envelope correctly.
- The replayed envelope is a valid Olm pre-key message.
- Recipient identity fingerprint survives restart.
- Native Vodozemac account restart and pre-key replenishment tests pass.
- Device trust, sender-bundle retrieval, and identity pinning pass in the browser flow.

## Not yet proven

There is not yet evidence that browser WASM key conversion, account restoration, or Olm authentication is defective. The current code does not complete the replay operation far enough to prove one of those causes.

## Required implementation order

1. Decouple authenticated join completion from mailbox replay completion.
2. Trigger replay only after `ModernConversation.connect()` releases its connection lock.
3. Preserve the explicit acceptance acknowledgement and durable commit before mailbox deletion.
4. Add the end-to-end regression for offline first-message delivery, plus invalid-envelope, wrong-identity, and duplicate-replay cases.
