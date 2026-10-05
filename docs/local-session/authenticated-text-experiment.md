# Local Session pairing-code and encrypted-text experiment

**Status:** experimental implementation candidate; not production protocol approval.

This succeeds the physically validated unauthenticated transport spike recorded in
[`android-lan-spike-results.md`](android-lan-spike-results.md). It keeps the same
standalone Android application sandbox and deliberately does **not** reuse normal
K3NCRYPT identity, contact verification, Olm sessions, relay credentials, main
storage, PeerAdmission, or lifecycle authority.

## Goal

Prove the next bounded milestone on two physical Android phones on the same Wi-Fi
router, including with the router Internet uplink disabled:

1. discover an untrusted Local Session endpoint;
2. transfer a fresh high-entropy pairing code out-of-band by reading it from the
   advertiser and entering it on the discoverer;
3. prove both endpoints know that code and the same fresh handshake transcript;
4. require explicit acceptance on the advertiser;
5. complete client READY and server READY_ACK key-confirmation flights;
6. exchange only the fixed synthetic text buttons under AES-256-GCM;
7. tear down without persistence or main-K3NCRYPT state mutation.

The temporary pairing code authenticates **knowledge of the one-time code**, not a
persistent K3NCRYPT person/device identity. This experiment therefore must not be
shown as normal verified-contact messaging.

## Why a long code instead of a short PIN

The handshake sends HMAC proofs over public transcript data. A captured transcript
would permit offline guesses of a low-entropy PIN. The advertiser therefore creates
20 independent characters from a 32-symbol unambiguous alphabet, providing a
100-bit generation space. The code is intentionally inconvenient for this
security experiment. A future short-code UX would require a separately reviewed
PAKE or a QR/camera bootstrap rather than simply shortening this secret.

## v2 protocol namespace

The authenticated experiment does not silently interoperate with the old transport
spike:

- DNS-SD service: `_k3nlsx2._tcp.`
- instance prefix: `lsx2-`
- TCP preamble: `K3NLSX2\n`
- maximum complete frame: 512 bytes
- maximum synthetic plaintext: 256 bytes

Frame types:

1. `HELLO`
2. `CHALLENGE`
3. `AUTH`
4. `ACCEPT`
5. `READY`
6. `SECURE_TEXT`
7. `CLOSE`
8. `READY_ACK`

## Handshake candidate

All fixed contexts/nonces below are 16 bytes generated from `SecureRandom`.

```text
Discoverer                                      Advertiser

NSD hint --------------------------------------> untrusted endpoint only

K3NLSX2 preamble <----------------------------> K3NLSX2 preamble

HELLO(hostContext, clientContext, clientNonce) --->

                        <--- CHALLENGE(hostContext,
                                      clientContext,
                                      clientNonce,
                                      serverNonce)

Both derive transcript hash and keys from:
  domain || hostContext || clientContext || clientNonce || serverNonce
  + the manually transferred 100-bit pairing code

AUTH(HMAC client-proof) ------------------------>

Advertiser verifies proof, then asks local user for explicit acceptance.

                        <--- ACCEPT(HMAC server-accept)

Discoverer verifies advertiser proof.

READY(HMAC client-ready) ----------------------->

Advertiser verifies READY, then sends:

                        <--- READY_ACK(HMAC server-ready-confirmation)

Discoverer verifies READY_ACK. Only then does it enter CONNECTED. The advertiser
enters CONNECTED after validating READY and completing its local READY_ACK write.
Both sides then enable encrypted synthetic-text buttons. A dropped final write is
visible to the advertiser only when the discoverer times out and closes the socket.
```

If READY is dropped, the advertiser remains pending and the discoverer times out
waiting for READY_ACK; neither side enables synthetic text. The extra confirmation
also prevents the discoverer from treating a locally written but unreceived READY
as a completed session.

## Derivation and text protection

The implementation uses only JCA/Android platform primitives:

- SHA-256;
- HMAC-SHA256;
- AES-256-GCM.

The code and transcript hash feed a domain-separated HKDF-style HMAC-SHA256
extract/expand. It derives independent values for:

- client → advertiser AES key;
- advertiser → client AES key;
- client nonce prefix;
- advertiser nonce prefix;
- handshake authentication key.

Each encrypted text record has a strictly increasing positive 64-bit sequence.
The AES-GCM nonce is a direction-specific 4-byte derived prefix plus the 8-byte
sequence. AAD binds the Local Session text domain, direction, sequence, and
transcript hash. Sequence mismatch is rejected before accepting plaintext.

Keys are memory-only and byte arrays are overwritten on ordinary teardown where
possible. JVM/Android runtime copies (for example inside provider objects or
immutable `String` values used by UI) cannot be promised erased; this is one of
several reasons this remains an experiment rather than a production protocol.

## Threat boundary

This experiment is intended to reject a LAN attacker that merely discovers the
service but does not know the fresh pairing code. Such an attacker should not be
able to authenticate a session or modify/read AES-GCM protected synthetic text.
An attacker who can observe the pairing code out-of-band can join/impersonate the
temporary session; the code is the temporary authority.

Network denial of service remains possible. A malicious router can drop traffic,
block multicast, reset connections, or prevent availability. The design does not
claim to solve compromised Android OS/app-process execution.

A pure relay MITM that does not know the pairing code can forward the genuine
handshake and ciphertext, but does not thereby learn or modify the protected text.
This experiment does not attempt to identify or prevent traffic forwarding itself.

## OnePlus network-profile observation

The v1 physical test found one OnePlus device rejected as
`UNSUPPORTED_NETWORK_PROFILE` until Airplane mode was enabled and Wi-Fi manually
re-enabled. The original source rejected any simultaneous cellular/VPN network on
all Android releases even though API 33+ uses network-scoped NSD and binds sockets
to the selected Wi-Fi `Network`.

On API 33+, v2 enumerates usable Wi-Fi `Network` objects, prefers an active Wi-Fi
network, and otherwise accepts exactly one usable Wi-Fi candidate even when
cellular is the default network; NSD and outbound sockets are then scoped/bound to
that Wi-Fi network. Any detected VPN still fails closed. On API 26–32, unscoped NSD
is limited to a single Wi-Fi network and fails closed for simultaneous cellular or
VPN. These changes compile and pass lint, but physical v2 network behavior has not
been tested.

The packaged manifest contains only `INTERNET` (TCP sockets) and
`ACCESS_NETWORK_STATE` (network/capability inspection). Both are normal permissions
and do not trigger a runtime prompt at this module's target SDK 35. Android 17 adds
`ACCESS_LOCAL_NETWORK` for apps targeting API 37 or higher; it is intentionally not
declared for this target. Raising the target requires adopting and testing the
permission or system-picker model. See [Android local-network permission guidance](https://developer.android.com/privacy-and-security/local-network-permission).

## Required validation before any stronger claim

## Software loopback integration validation recorded 2026-10-06

The experiment's production handshake steps and encrypted-text sequence handling
are now shared by the Android controller and a deterministic JVM integration
harness. The harness connects two endpoints over ephemeral localhost TCP sockets;
it does not emulate Wi-Fi, Android network discovery, or physical-device behavior.

- `:local-session-experiment:testDebugUnitTest` — PASS (46 tests, including 100
  successful fresh loopback handshakes with bidirectional encrypted text)
- `:local-session-experiment:assembleDebug` — PASS
- `:local-session-experiment:lintDebug` — PASS
- `:app:assembleDebug` without the experiment opt-in — PASS
- default `gradlew projects` omits `:local-session-experiment` — PASS
- source scan found no experiment references in production Android modules — PASS
- `git diff --check` — PASS
- no new third-party dependency; the experiment module retains JUnit only for tests
- the standalone application ID remains `com.k3ncrypt.experiment.localsession`

The loopback suite exercises the actual `LocalSessionHandshake`,
`LocalSessionSecureChannel`, `LocalSessionProtocol`, `ExperimentState`, and
connection-attempt limiter. It covers wrong codes; AUTH, ACCEPT, READY, and
READY_ACK proof mutation; ciphertext and GCM-tag mutation; sequence/direction
changes; duplicate and stale text; previous-session control and ciphertext
replay; interruptions at every control-frame boundary; acceptance timeout;
active disconnect; simulated restart/generation fencing; frame/text/queue bounds;
the connection-attempt window; message 100/101; and session expiry.

Completion-edge results:

| Case | Advertiser | Discoverer | Secure text enabled | Cleanup / timeout |
| --- | --- | --- | --- | --- |
| READY and READY_ACK delivered | Connected | Connected | Both | Normal session lifetime |
| READY dropped | Failed | Failed | Neither | Bounded handshake timeout; temporary state cleared |
| READY_ACK dropped | Connected briefly, then disconnected on peer EOF | Failed | Advertiser only during that interval | Discoverer closes after timeout; controller's timeout is 5 s (harness: 350 ms) |
| Connection closed just after READY | Connected briefly after local ACK write, then disconnected on EOF | Failed | Advertiser only during that interval | Immediate transport close; no discoverer READY_ACK verification |
| Connection closed just after READY_ACK | Connected until EOF is processed | Connected until EOF is processed | Both briefly | Both read loops clear on peer/local close; no handshake wait remains |

The last two rows exercise a flushed frame followed immediately by socket close;
endpoint state is sampled before disconnect cleanup. The integration harness then
drives the same fail/clear outcome, while the Android controller's read loop maps
EOF or a closed socket to `finish`. In all rows with a close/loss, no session stays
usable after cleanup. Wrong codes, altered proofs, altered ciphertext/tags,
duplicate/stale sequence numbers, and old-session data do not produce accepted
plaintext.

No protocol or cryptographic redesign was needed. The brief advertiser-only
connected state is bounded by the discoverer's existing timeout and transport
close; it does not authenticate the discoverer on its side or accept plaintext
without a valid encrypted frame. This is the current final-flight behavior, not
evidence of symmetric peer completion at the same instant. The Android
controller's existing read loop maps EOF to session cleanup. No JVM-wide
memory-erasure claim is made.

The supported statement is: **“Local Session v2 passed automated end-to-end
software integration and negative-path testing over a local loopback harness.”**
This is not physical LAN evidence or production-security approval.

The APK was built at
`android/experiments/local-session-spike/build/outputs/apk/debug/local-session-experiment-debug.apk`.
Its SHA-256 at validation time was
`3c3b5791ed76a4448784c7cb975732b04d68cf1726c65c3e04c9dc9a57cda574`.

ADB found one emulator and no physical Samsung/OnePlus devices. No v2 APK was
installed and no v2 physical test was attempted. **Physical v2 status: READY FOR
PHYSICAL TESTING.** The prior Samsung + OnePlus v1 transport result remains the
separate evidence recorded in `android-lan-spike-results.md`; it does not validate
v2 authentication or encryption.

After software validation, run the two-phone physical matrix:

```sh
cd android
./gradlew -PlocalSessionExperiment=true :local-session-experiment:testDebugUnitTest
./gradlew -PlocalSessionExperiment=true :local-session-experiment:assembleDebug
./gradlew -PlocalSessionExperiment=true :local-session-experiment:lintDebug
./gradlew :app:assembleDebug
```

Required physical cases:

- correct code: advertiser/discoverer both reach pairing-code verified + AES-GCM;
- wrong code: fail closed; synthetic buttons never enable;
- tampered/invalid frame test where practical;
- encrypted A→B and B→A fixed messages;
- Internet uplink disabled with Airplane mode + Wi-Fi;
- force-close/restart clears code/keys/messages;
- second peer rejected while one session is active;
- API 33+ phone tested with Wi-Fi plus cellular present, if available;
- API 26–32 behavior remains conservative and documented.

## Claim limits

After source-only work, it is fair to say the working copy contains a candidate
pairing-code authentication and AES-GCM encrypted-text implementation using
standard platform primitives and no main K3NCRYPT authority.

Until the physical matrix passes, do **not** claim:

- validated authenticated Local Session;
- validated confidentiality;
- production cryptographic protocol;
- persistent identity verification;
- production raw TCP approval;
- integration into normal K3NCRYPT conversations;
- file/call/video readiness.
