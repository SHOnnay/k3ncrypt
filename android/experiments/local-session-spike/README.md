# Local Session experiment

This is an opt-in, debug-only Android application for isolated same-LAN experiments.
It has a distinct application ID (`com.k3ncrypt.experiment.localsession`) and installs
alongside the normal K3NCRYPT application.

The original v1 transport spike physically demonstrated that two Android phones on
the same Wi-Fi router can exchange bounded synthetic messages with the router's
Internet uplink unavailable. The current v2 experiment adds a **temporary
high-entropy pairing-code proof and AES-256-GCM encrypted synthetic text** while
remaining independent of normal K3NCRYPT identity, trust, storage, relay, calls,
and conversations.

This is still **experimental and not production-approved**. The pairing code proves
knowledge of a fresh temporary shared code; it is not K3NCRYPT contact/device
verification.

## Build

From `android/`:

```sh
./gradlew -PlocalSessionExperiment=true :local-session-experiment:testDebugUnitTest
./gradlew -PlocalSessionExperiment=true :local-session-experiment:assembleDebug
./gradlew -PlocalSessionExperiment=true :local-session-experiment:lintDebug
```

The Gradle project is included only with `-PlocalSessionExperiment=true`; normal
Android project builds do not include it. It has no project dependency and no
new production dependency. JUnit is test-only.

## v2 test flow

1. Connect two physical Android phones to the same Wi-Fi router.
2. For an Internet-off proof, disable the router uplink and prevent mobile-data
   fallback (Airplane mode + Wi-Fi manually re-enabled is the known working setup).
3. On phone A, tap **Start Advertiser**. It shows a fresh 20-character code.
4. On phone B, tap **Start Discovery** and wait for the endpoint.
5. Type the code from phone A into phone B and tap **Connect using pairing code**.
6. Phone A verifies the code proof and then requires explicit **Accept pairing-code peer**.
7. After the final key-confirmation message, both sides should show:
   - `Authentication: pairing code verified`
   - `Encryption: AES-256-GCM active`
8. Send only the fixed synthetic messages in both directions.
9. Stop/force-close and verify the session, code, keys, and messages do not restore.

A wrong code must fail before any synthetic text is enabled.

## Experimental security construction

- Pairing code: 20 characters from a 32-symbol unambiguous alphabet (100 bits of
  generation space), fresh per advertiser session.
- Handshake: fresh 128-bit host/client contexts and client/server nonces, HMAC-SHA256
  proofs over a domain-separated transcript, then client READY and server READY_ACK
  confirmations. The discoverer waits for READY_ACK before showing a connected session;
  the advertiser waits for a valid READY before showing one.
- Key derivation: HKDF-style HMAC-SHA256 extract/expand using the high-entropy code
  and transcript hash.
- Text protection: independent client→server and server→client AES-256-GCM keys,
  direction-specific nonce prefixes, strictly increasing 64-bit sequence numbers,
  and transcript/direction/sequence bound as AAD.
- Protocol v2 uses `K3NLSX2\n`, `_k3nlsx2._tcp.`, and a separate frame type set so
  it does not silently interoperate with the unauthenticated v1 spike.

The code is intentionally long/high entropy because the observable HMAC handshake
would allow offline guessing if a human-memorable low-entropy PIN were used. Do
not shorten it to a 4/6-digit PIN without adopting a reviewed PAKE construction.

## Isolation evidence

- Application ID is distinct from `com.k3ncrypt.app`; Android gives each package
  its own application sandbox/UID. No `sharedUserId`, provider, service, receiver,
  deep link, or IPC bridge is declared.
- Source/build dependency inspection found no production package imports,
  Hilt, Room, JNI, Vodozemac, messaging, relay, call, lifecycle or identity module.
- It does not call SharedPreferences, open files, create a database, or request
  Keystore access. Session, endpoint hints, pairing code, derived keys, messages,
  and diagnostics are memory-only and cleared on teardown as far as ordinary JVM
  object lifetime permits.
- It declares only INTERNET (TCP sockets) and ACCESS_NETWORK_STATE (selected
  Wi-Fi/capability inspection). No production manifest is changed.
- Both are normal permissions with no runtime prompt at target SDK 35. Android 17
  requires `ACCESS_LOCAL_NETWORK` for apps targeting API 37+; do not raise this
  experiment's target without adopting and testing that permission/picker model.
- API 33+ uses network-scoped NSD and binds the TCP socket to a selected Wi-Fi
  `Network`, so a cellular default network does not automatically hide an otherwise
  usable local Wi-Fi path. Any detected VPN still fails closed. On API 26–32,
  simultaneous cellular/VPN and multiple Wi-Fi networks remain rejected because NSD
  cannot be scoped the same way.

Static package isolation reduces accidental authority coupling. It is not a claim
that arbitrary operating-system or same-process code execution is contained.
