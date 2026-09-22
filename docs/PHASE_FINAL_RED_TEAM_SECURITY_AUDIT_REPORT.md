# K3NCRYPT Final Independent Red Team Security Audit Report

Date: 2026-09-22

Scope: actual production source under `backend/`, `service/src/`, `client/src/`, `docker/`, `app.ts`, and `index.ts`. Existing reports and tests were not treated as evidence of security.

## Executive result

K3NCRYPT is **NOT READY** for users who rely on its stated privacy and device-revocation guarantees. The modern first-contact protocol is vulnerable to an active backend compromise, revoked devices are not excluded at the relay or remote-message boundary, attachment authorization substitutes a no-op for device trust, and the private-network relay accepts unauthenticated device claims. Several newer subsystems are exported libraries backed only by in-memory adapters and are not composed into a usable production data plane.

## Finding 1

Severity: **CRITICAL**

Title: Compromised backend can perform first-contact key substitution and read modern conversation plaintext

Affected files:

- `backend/api/chatHash/prekeys.ts:67-86`
- `service/src/crypto/modernConversation.ts:238-245`
- `service/src/crypto/modernConversation.ts:397-410`
- `service/src/identity/contactIdentityRegistry.ts:51-66`

Attack scenario: An attacker controlling the backend or MongoDB replaces the public bundle returned for an invitation address with a bundle whose private keys the attacker owns. The joining client accepts that bundle as first-seen, establishes its Olm session to the attacker, and is allowed to send immediately. The attacker separately initiates a session to the original participant using that participant's published bundle and bridges plaintext between the two encrypted sessions.

Impact: The backend can read and alter messages and attachment keys for new, unverified modern conversations. This directly violates the no-server-plaintext goal.

Evidence: Published bundles contain public keys but no signature or invitation-bound commitment. The fetch path trusts the server response. A first-seen identity is stored as `unverified`, yet `sendUnlocked` rejects only `changed-pending-review`; it does not require `verification === 'verified'`.

Exploitability: High. It requires active backend/database control and interception during initial session establishment. The requested server-compromise threat model grants that capability. Users who compare fingerprints before sending detect the attack, but the application does not enforce that order.

Recommended fix: Bind the intended identity key to an out-of-band invitation commitment or require verified identity before sending sensitive content. Authenticate published prekey bundles with the already-pinned identity and make first-contact substitution detectable before session use.

## Finding 2

Severity: **CRITICAL**

Title: A compromised production web origin can replace the cryptographic client and steal all browser-held secrets

Affected files:

- `app.ts:22-26`
- `service/src/api/links.ts:19-41`
- `client/src/utils/urlHash.ts:34-80`
- `service/src/storage/secureVault.ts:193-202`

Attack scenario: An attacker controlling the production backend host modifies `client/dist` or the response serving `index.html` and JavaScript. The modified client reads the invitation fragment, captures the vault passphrase when entered, and exfiltrates decrypted records and future plaintext.

Impact: Complete account, identity, message, attachment, recovery, and call compromise for users loading the malicious client.

Evidence: The same production Express process serves the mutable client build. Invitation secrets are intentionally available to page JavaScript through `window.location.hash`, and vault unlocking necessarily exposes the user-entered secret to that JavaScript. There is no independently signed client, immutable code pin, or trusted native shell in the production path.

Exploitability: High under the stated assumption that the attacker owns the backend server. End-to-end cryptography cannot protect a browser session from a server that supplies replacement cryptographic code.

Recommended fix: Define this limitation explicitly and provide an independently distributed, reproducibly built, signed client with update verification. A web deployment alone cannot satisfy the strong server-compromise claim.

## Finding 3

Severity: **HIGH**

Title: Revocation is not enforced by the relay or by inbound message sender authorization

Affected files:

- `backend/socket.io/listeners.ts:89-123`
- `backend/socket.io/listeners.ts:136-174`
- `service/src/crypto/modernConversation.ts:599-625`
- `service/src/crypto/modernConversation.ts:745-757`

Attack scenario: A device is revoked while offline. It later reconnects using its still-valid room control capability, routing address, routing proof, and persisted Olm session. The relay checks room and routing ownership but has no device trust or epoch input. The receiver checks only whether its own local device is trusted and whether the sender routing address matches; it does not check the sending device against the current lifecycle list.

Impact: A revoked device can continue sending encrypted messages and signaling until other credentials expire or the conversation/session is replaced. Restoring an old complete IndexedDB snapshot also restores the device's locally active trust view.

Evidence: `chat-join` never receives a trust epoch or device authorization. `receive()` calls `assertCurrentDeviceTrust()`, whose enforcer is constructed for the local device, then accepts the bound routing address. No remote-device lifecycle lookup occurs on the message path.

Exploitability: High for a stolen or compromised device retaining local encrypted state and its unlock secret. The system cannot force hostile client code to install the peer-delivered revocation update.

Recommended fix: Make every sender prove current, account-authorized device status to recipients and/or a privacy-preserving admission service. Rotate credentials and sessions on revocation, and bind inbound traffic to the current device epoch.

## Finding 4

Severity: **HIGH**

Title: Attachment production authorization uses a no-op device trust check

Affected files:

- `backend/api/attachments/production.ts:51-72`
- `backend/security/authorizationContext.ts:43-57`
- `backend/api/attachments/production.ts:40-45`

Attack scenario: A revoked device retains its room capability and prekey renewal/routing proof. It submits fresh request IDs and continues creating, reading, or deleting attachments while its prekey record remains unexpired.

Impact: Revocation does not remove attachment access. A revoked device can download ciphertext for any attachment whose identifier and attachment capability it retained, delete data, or consume storage.

Evidence: The production authenticator explicitly creates `deviceTrust: { assertTrusted: async () => undefined }`. The downstream authorization service invokes this method believing it enforces Phase 6 trust. Membership is only the existence of an unexpired prekey record, which is not the account device lifecycle.

Exploitability: High after device theft or compromise. Required bearer values are stored on the device and remain valid independently of revocation.

Recommended fix: Replace the no-op adapter with verification of a short-lived, epoch-bound device authorization and invalidate attachment sessions when device trust changes.

## Finding 5

Severity: **HIGH**

Title: Private-network relay allows unauthenticated device impersonation and route squatting

Affected files:

- `backend/privateNetwork/relay.ts:8-30`

Attack scenario: An attacker who learns or guesses a network ID and device ID connects first with those two UUIDs in the Socket.IO handshake. No signature, capability, encrypted-session proof, or trust snapshot is checked. The attacker occupies the victim's route, receives envelopes intended for that device, injects arbitrary opaque envelopes under the victim's sender ID, and can repeatedly deny reconnection.

Impact: Reliable denial of service, metadata exposure, traffic capture, and sender impersonation at the routing layer. Payload authentication should prevent application plaintext recovery and accepted packet forgery, but that does not prevent route takeover or traffic analysis.

Evidence: `validAuth` checks only UUID syntax. The route map binds the claimed `deviceId` immediately, and duplicate IDs are disconnected. The relay emits the claimed ID as `senderDeviceId`.

Exploitability: Medium to high. UUID secrecy is not authentication; IDs can be exposed by configuration, logs, peers, or a compromised relay.

Recommended fix: Require an authenticated, short-lived relay admission token bound to network ID, device identity, trust epoch, and connection nonce. Prevent an unauthenticated first connection from locking out the legitimate device.

## Finding 6

Severity: **HIGH**

Title: Private-network and adaptive-node authorizations are forgeable digests and are not bound to the calling device

Affected files:

- `service/src/privateNetwork/runtime.ts:21-34`
- `service/src/privateNetwork/nodes.ts:19-31`
- `service/src/privateNetwork/bridge.ts:21-31`

Attack scenario: Code running on any locally trusted device calls the exported authorization methods with an owner's identifiers, or directly constructs an authorization and recomputes its public SHA-256 digest. `PrivateNetworkRuntime.authorize` selects the first active owner without identifying the caller. `AdaptiveNodeRuntime` accepts caller-supplied issuer fields. Site-route records are likewise protected by an unkeyed digest rather than a signature from the issuing device.

Impact: A non-owner trusted device or malicious local integration can add/remove network members, register permanent relay/bridge capabilities, or mint route records as an owner when it can access the relevant persistence/runtime objects.

Evidence: These methods accept no `AuthenticatedDeviceContext` and no signature. Their `digest` functions are plain SHA-256 over attacker-controlled JSON. Apply/install code proves only that the named issuer exists in state, not that the issuer authorized the operation.

Exploitability: Medium in the current product because these runtimes are not wired into the client. It becomes high as soon as a UI, RPC, or platform adapter exposes them.

Recommended fix: Require an issued authenticated device context and a cryptographic authorization signature/MAC bound to the existing device identity, operation, epoch, commitment, target, and expiry.

## Finding 7

Severity: **HIGH**

Title: Private networking, adaptive nodes, and site bridges have no production persistence or application composition

Affected files:

- `service/src/privateNetwork/runtime.ts:51-55`
- `service/src/privateNetwork/nodes.ts:39-40`
- `service/src/privateNetwork/bridge.ts:34`
- `service/src/privateNetwork/index.ts`
- `client/src/` (no runtime consumer)
- `backend/privateNetwork/relay.ts`

Attack scenario: Operators deploy the advertised private-network feature expecting membership, revocation, bridge authorization, and replay state to survive restarts and govern the backend relay. In reality, only process-memory persistence implementations exist and none of the control-plane runtimes are connected to the relay. A restart drops all state; the relay continues accepting raw UUID claims regardless of that state.

Impact: The advertised security policy is not enforced in production. Replay claims, membership changes, bridge approvals, and routes do not provide a durable security boundary, and no site-to-site data plane exists.

Evidence: All concrete persistence classes are `Memory*` maps/sets. Repository-wide use finds no production construction of `PrivateNetworkRuntime`, `AdaptiveNodeRuntime`, `SiteToSiteBridgeRuntime`, or `AuthenticatedPrivateNetworkTransport` outside tests. The backend initializes only the unauthenticated blind relay.

Exploitability: Immediate as a deployment/configuration failure. There is no protected production path to attack because the claimed path is absent; users who expose the relay receive weaker behavior than the APIs imply.

Recommended fix: Do not expose or market the feature until durable adapters, authenticated admission, control-plane composition, crash recovery, and platform forwarding have been implemented and independently reviewed.

## Finding 8

Severity: **HIGH**

Title: Vault permits low-entropy eight-digit PINs with offline verification and no attempt limit

Affected files:

- `service/src/storage/secureVault.ts:10-15`
- `service/src/storage/secureVault.ts:75-88`
- `service/src/storage/secureVault.ts:135-149`
- `service/src/storage/secureVault.ts:193-202`

Attack scenario: An attacker copies the browser's IndexedDB vault and tests PIN candidates offline against the AES-GCM wrapped master key. The minimum PIN space is only 100 million candidates. No server, rate limit, secure enclave, or attempt counter participates.

Impact: Successful guessing exposes the master key, identity pickles, sessions, conversation history, routing proofs, device state, and other encrypted local records.

Evidence: Numeric PINs of exactly eight digits are accepted. The verifier is entirely contained in persisted metadata: Argon2id parameters/salt plus an AES-GCM wrapped master key. The production Argon2id profile is 19,456 KiB, two iterations, one lane.

Exploitability: Medium to high for a targeted attacker with a copied profile. Argon2 raises cost but cannot supply entropy or online throttling to an offline eight-digit secret.

Recommended fix: Remove low-entropy PIN-only unlocking unless backed by hardware rate limiting. Use a stronger passphrase policy or a platform keystore-bound random secret and calibrate Argon2 for supported hardware.

## Finding 9

Severity: **MEDIUM**

Title: Rollback detection is stored inside the same rollbackable browser vault

Affected files:

- `service/src/devices/runtime.ts:54-82`
- `service/src/devices/runtime.ts:86-95`
- `service/src/storage/persistence.ts`

Attack scenario: An attacker restores an older complete IndexedDB database containing both an active device lifecycle record and its matching older high-water record. Internal consistency and AES-GCM authentication still pass because both records are authentic historical ciphertext.

Impact: Local rollback protection cannot detect whole-store restoration. Combined with the missing remote/relay revocation enforcement, this enables a stolen device to return to a locally trusted state.

Evidence: The lifecycle high-water mark and lifecycle record share the same `SecureStorage` and IndexedDB persistence boundary. No external monotonic counter, server witness, hardware counter, or cross-device quorum anchors the latest epoch.

Exploitability: Medium. It requires access to a prior valid browser profile snapshot and the ability to restore it, which is realistic for a stolen disk/profile, backup restore, or compromised endpoint.

Recommended fix: Anchor the latest trust epoch outside the rollbackable vault using an authenticated remote witness, hardware monotonic storage, or mandatory convergence with current trusted devices before protected operations.

## Finding 10

Severity: **MEDIUM**

Title: Group-security implementation is not integrated into product messaging and stores one shared group key locally

Affected files:

- `service/src/crypto/modernConversation.ts:534-540`
- `service/src/groups/persistence.ts:17-45`
- `client/src/` (no group runtime or group conversation consumer)

Attack scenario: A beta user assumes group membership changes and key rotation protect real group messages. The client has no production group creation, delivery, distribution, or message-encryption flow. The exported adapter generates a single base64 group key and returns it to any locally active member query; there is no per-member key distribution protocol connected to messaging.

Impact: Removed-member future secrecy is not an end-to-end product guarantee. The available code proves local state transitions, not a deployed group communication protocol.

Evidence: `createGroupSecurityRuntime()` only constructs a local secure-storage adapter. Repository-wide source search finds no client consumer. No group message encryption/decryption path consumes `keyForActiveMember`.

Exploitability: Immediate as a false security expectation; no secure production group feature exists to withstand the requested removed-member attack.

Recommended fix: Keep group communication disabled until membership events, authenticated key distribution, sender authentication, message epoch enforcement, and removal convergence are wired end to end.

## Finding 11

Severity: **MEDIUM**

Title: Recovery cannot recover a lost or locked account and is absent from the user flow

Affected files:

- `service/src/crypto/modernConversation.ts:542-546`
- `service/src/recovery/production.ts:32-40`
- `client/src/` (no recovery runtime consumer)

Attack scenario: A user loses the only device or cannot unlock the current vault and attempts account recovery. The only production authority reads the existing unlocked `device-account-binding` and device lifecycle from that same vault before accepting an archive. The UI exposes no archive export/import or recovery ceremony.

Impact: Recovery is unavailable precisely in common recovery scenarios. This is primarily availability, but it can pressure users into insecure manual backups and creates misleading expectations around device invalidation.

Evidence: `SecureStorageRecoveryAdapter.authorize()` requires current local binding and lifecycle records. `createRecoveryRuntime()` is exposed only from an already-connected `ModernConversation`; no client source calls it.

Exploitability: Immediate when the primary device is lost, destroyed, or its vault cannot be unlocked.

Recommended fix: Treat recovery as unavailable until a user-accessible export/import flow and an authority model that does not require the lost unlocked vault are implemented and threat-modeled.

## Finding 12

Severity: **MEDIUM**

Title: Public HTTP rate limiting can be used for unbounded process-memory growth

Affected files:

- `backend/middleware/apiRateLimit.ts:4-12`
- `backend/middleware/controlRateLimit.ts:5-14`
- `backend/socket.io/rateLimiter.ts:22-49`

Attack scenario: An unauthenticated remote client sends requests across many unique paths and/or spoofable client IPs behind the configured proxy. Each unique key creates a token bucket. HTTP buckets are never expired or reset.

Impact: Long-running production processes can be forced to retain an unbounded number of map entries, eventually causing memory exhaustion and denial of service.

Evidence: `RateLimiter.consume()` inserts every new key into a `Map`. Only socket disconnect code calls `reset`; the HTTP middleware has no cleanup. The broad API key includes `req.path`, allowing attacker-controlled path cardinality.

Exploitability: High for availability if the service is directly Internet-accessible and upstream infrastructure does not cap abusive requests.

Recommended fix: Use a bounded, expiring store keyed by normalized routes and validated client identity/IP, with proxy-side rate limiting and global connection/body limits.

## Finding 13

Severity: **MEDIUM**

Title: TURN credentials are compiled into the public client and may become reusable infrastructure credentials

Affected files:

- `client/src/config/runtimeConfig.ts:10-33`
- `docker/frontend.Dockerfile:11-17`

Attack scenario: A deployment supplies static TURN username and credential values through `CHATE2EE_ICE_SERVERS`. Vite compiles them into the public JavaScript bundle. Any visitor extracts the credentials and uses the TURN service for unrelated relay traffic.

Impact: Relay abuse, cost exhaustion, denial of service, and potential attribution of attacker traffic to the operator.

Evidence: The configuration parser accepts credential strings and the frontend Docker build passes the complete ICE JSON as a build argument/environment value. Browser WebRTC necessarily exposes configured static credentials to client code.

Exploitability: High when operators use long-lived TURN credentials, which the current configuration format encourages.

Recommended fix: Issue short-lived TURN credentials from an authenticated endpoint, scope and rate-limit them, and avoid durable secrets in build arguments and static bundles.

## Finding 14

Severity: **LOW**

Title: Production web responses lack a Content Security Policy and permissions policy

Affected files:

- `docker/nginx.conf:1-9`
- `app.ts:22-26`

Attack scenario: A future HTML injection, compromised dependency, or hosting misconfiguration gains fewer browser-level constraints than expected and can connect to arbitrary exfiltration origins or request sensitive browser capabilities.

Impact: This does not create an injection by itself, but it increases the consequence of any client-side injection in an application that handles decrypted plaintext and vault access.

Evidence: Nginx sets `nosniff`, `no-referrer`, and frame denial only. The Express static path sets no CSP, Permissions-Policy, or HSTS headers.

Exploitability: Low without a separate injection or network precondition.

Recommended fix: Add a restrictive deployment-specific CSP, Permissions-Policy, and HSTS at the TLS termination layer; verify required WebSocket, WASM, worker, and media directives without enabling broad script exceptions.

## Server compromise exposure summary

A backend/database attacker can directly see room identifiers, control-capability hashes, public identity/prekey bundles, routing addresses, connection and delivery timing, offline encrypted envelopes, attachment sizes/timestamps/status, encrypted attachment chunks, and operational availability metadata. The database does not directly contain message plaintext, attachment keys, vault keys, or local passphrases.

That passive-at-rest protection is insufficient for the stated attacker. The backend receives raw room control capabilities and routing proofs in live request headers/Socket.IO handshakes, controls prekey responses and relay ordering, and serves the browser application in the combined production mode. Findings 1 and 2 therefore provide active routes from server compromise to plaintext.

## Final verdict

# NOT READY

The cryptographic primitives and ciphertext-at-rest boundaries are generally stronger than the surrounding authorization and product composition. Realistic attackers can exploit first-contact trust, stale/revoked device credentials, unauthenticated private-network admission, no-op attachment trust, and browser code delivery. These are security-boundary failures, not documentation defects or missing cosmetic features.
