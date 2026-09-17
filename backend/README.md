### APIs
```endpoint: /api/<path>```

| url                              | method   | payload                         | filename                        | description                                   |
| -------------------------------- | -------- | ------------------------------- | -------------------------------- | --------------------------------------------- |
| `/chat-link`                      | `POST`   | `{ controlCapabilityHash }`      | `/api/chatHash/index.ts`         | generate a capability-bound public room id    |
| `/chat-link/status/:channel`      | `GET`    | control-capability header         | `/api/chatHash/index.ts`         | authorized room status                        |
| `/chat-link/:channel`             | `DELETE` | control-capability header         | `/api/chatHash/index.ts`         | capability-authorized soft deletion           |
| `/chat/get-users-in-channel`      | `GET`    | query + control-capability header | `/api/messaging/index.ts`        | authorized transient presence                 |

---

### Socket.io events

Chat messages and WebRTC signaling are **not** sent over REST any more — they
are relayed over the socket connection established at `chat-join`, using the
identity (`userID`/`channelID`) bound to that socket, never a client-supplied
`sender`/`channel` field. Every payload the server relays for these two
events is an **opaque, versioned envelope** (`{ version, strategy, data }`); the
server never decrypts or inspects its contents.

| event (client → server) | payload                | ack                                    | description                                        |
| ------------------------ | ----------------------- | --------------------------------------- | --------------------------------------------------- |
| `chat-join`               | `{ userID, channelID, controlCapability }` | —                         | authorize and join a room (max 2 participants)      |
| `chat-message`            | `{ envelope }`          | `{ id, timestamp }` or `{ error }`      | relay an opaque chat envelope to the other peer      |
| `webrtc-signal`           | `{ envelope }`          | `{ status: 'ok' }` or `{ error }`       | relay an opaque WebRTC signaling envelope            |
| `received`                | `{ id }`                | —                                       | acknowledge delivery of a chat message               |

| event (server → client)          | payload                                          | description                              |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `on-alice-join`                     | `null`                                             | the other participant joined              |
| `on-alice-disconnect`               | `null`                                             | the other participant disconnected        |
| `chat-message`                      | `{ id, timestamp, sender, envelope }`              | an incoming chat envelope                 |
| `webrtc-session-description`        | `{ envelope }`                                     | an incoming WebRTC signaling envelope     |
| `delivered`                         | `id`                                               | your message was delivered                |
| `limit-reached`                     | `null`                                             | the room already has 2 participants       |

Both `chat-message` and `webrtc-signal` are rate-limited per socket (token
bucket) and size-checked (rejecting oversized payloads) before being
relayed; `initSocket()` also caps the transport-level packet size via
Socket.IO's `maxHttpBufferSize`.

See `docs/SERVER_SECURITY.md` for capability, rate-limit, metadata, and CORS details.

---
