# Security and delivery visibility contract

This UI reports state already exposed by each client. It does not create trust, a delivery receipt, or transport authority. Production messaging uses the relay path; Local Session and optional direct paths are not active here.

## Conversation state

| Display | Source | Means | Does not prove |
| --- | --- | --- | --- |
| Verified / Unverified | Web `StoredContactIdentity.verification`, only when `changeStatus` is `unchanged` | The Web identity registry's explicit verification value | A healthy session, relay availability, or peer receipt |
| Identity changed · review required | Web `StoredContactIdentity.changeStatus = changed-pending-review` | The registry observed a different identity and has not accepted it | Which person controls the new identity |
| Verification status unavailable | Missing or incomplete state; all Android conversations currently | No separate verification value is exposed to this visibility layer | That the contact is verified or unverified |
| Identity pinned | Android conversation route and identity reference are saved | The conversation is bound to a saved identity reference | A separately persisted verification/change state; Android displays those as unavailable |
| Message path: Relay | Current Web and Android messaging implementations | The selected production message transport in this build | Recipient presence or message acceptance |
| Relay socket: connected/disconnected | Android `SocketRelay.connected` | Local Socket.IO connection state | Authenticated peer presence, mailbox storage, or send success |
| Session status | Web `ModernConversation` session-health observer | Current local session health category (`healthy`, `unhealthy`, or `renewal-pending`) | Remote device health or verification |

Web does not expose current relay socket availability through the conversation UI, so its details panel says that value is not exposed. Android does not expose a separate session-health value. Neither client currently exposes a production optional-path preference or a reason for an unavailable optional path.

## Message state

| Display | Source | Means | Does not prove |
| --- | --- | --- | --- |
| Pending | Local message projection/outbox state | The client has not received the final state shown below | Whether a relay accepted it or a recipient received it |
| Accepted by relay | Legacy Web or Android positive `chat-message` acknowledgement | The relay returned an acknowledgement; Android's DTO and legacy Web state do not retain the `stored` distinction | Whether the live recipient app accepted it versus the relay storing it in a mailbox |
| Recipient app accepted · relay report | Web modern `delivered` event; backend emits this after a recipient `received` event following its acceptance callback | The relay reports that the recipient application accepted the envelope | A signed/authenticated peer receipt, display, read, or durable peer storage verified by the sender |
| Could not confirm · Retry | Web send/retry failure; Android send did not return a relay receipt | The client did not obtain a confirmed result | That no copy reached the relay; a timeout can leave outcome unknown |
| Status unavailable | No delivery field | There is no displayable delivery evidence | Any positive delivery state |

“Delivered”, “received by peer”, and “persisted by peer” are not shown as outbound success states. Android's received-message callback means the local client accepted an inbound message; it is not used as an outbound receipt.

## Privacy and diagnostics

The conversation details expose no keys, fingerprints, ciphertext, tokens, transcripts, ICE data, or network addresses. Advanced Android fingerprint comparison controls remain a separate existing screen. No developer diagnostics surface was added; current internal debug stages are not promoted into user UI.
