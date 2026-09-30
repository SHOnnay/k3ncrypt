# LAN Feasibility Spike Report

**Status:** incomplete real-device evidence; no production go decision

**Branch:** `connectivity/lan-spike` (throwaway; do not merge experiment code)

**Baseline:** `a80672fb739936620c18f149ea63475e499a0dcc` (`connectivity/transport-policy`). The repository's `main` worktree remains at `3e26ce9` and does not yet contain the connectivity handoff or Phase 2 work, so the spike was based on the latest local connectivity branch rather than that older `main`.

## Experiment boundary

The desktop harness under `experiments/lan-spike/` and the independent debug Android project under `experiments/android-lan-spike/` exchange only the fixed dummy payload `dummy-lan-probe`. A multicast beacon advertises a test TCP port. The responder returns an unauthenticated test acknowledgment and marks repeat dummy IDs in a bounded in-memory cache. This is **not** K3NCRYPT message acceptance, identity admission, a receipt, or persistent deduplication.

No production package, real identity, contact, key, session, encrypted envelope, relay, `ModernConversation`, or `DeliveryCoordinator` is imported or changed. The Android app has its own application ID and no release variant. It is a test instrument only.

## Device and environment matrix

| Endpoint | Platform | Role | Evidence level |
|---|---|---|---|
| MacBook Pro | macOS 27.0, Node.js 22.23.1 | Desktop listener and same-host probe | Local host only; does not test a physical LAN |
| `sdk_gphone64_arm64` emulator | Android 15 / API 35, disposable AVD | Debug app probing desktop through emulator NAT | Emulator smoke test only; does not count toward real-device acceptance |
| Real Android device 1, 2, 3 | Not available in this run | Planned peer/discovery tests | Not tested |
| Browser | Not used in this run | Planned browser feasibility | Not tested |

## Observations

| Run | Discovery / connection | Result | Limits |
|---|---|---|---|
| Desktop multicast + TCP on one Mac | Beacon found in 1,004.01 ms; 100 sequential TCP connections established | 100/100 dummy probes acknowledged; median 0.59 ms, p95 1.15 ms, min 0.46 ms, max 4.96 ms | Same-host stack, one run, no Wi-Fi or internet-loss condition |
| Android emulator → desktop via manual host address | TCP connections established through emulator NAT | 10/10 dummy probes acknowledged; median 556.08 ms, p95 708.93 ms | Emulator timing includes virtualized networking/UI scheduling; not a real LAN latency estimate |
| Android emulator → desktop after listener stopped | No accepting peer | 0/10 dummy probes succeeded; app remained running and reported failure | Confirms this prototype reports connection failure; does not exercise relay fallback |
| Automated desktop tests | Loopback | 6/6 tests passed: protocol bounds, connection/latency summary, duplicate dummy ID, closed peer, malformed frame, summary calculations | No real peer, no cryptographic or persistent delivery semantics |
| Standalone Android debug build and launch | Disposable AVD | `:app:assembleDebug` succeeded; APK installed and activity resumed; no fatal crash observed | Build and launch only; no real-device reliability or background test |

These are single-run observations. They do not establish discovery reliability, loss rate on Wi-Fi, offline behavior, battery cost, or production security.

## Required measurements still open

- At least three real Android devices plus one desktop on ordinary Wi-Fi, guest/client-isolated Wi-Fi, and hotspot networks; record repeated discovery and TCP success/failure counts.
- Test with internet **physically unavailable** before connection establishment. The local-only harness does not use a relay, but this run did not prove the network's internet path was absent.
- Compare Android NSD/mDNS with multicast beacons and manual-address connection. The current prototype uses custom multicast, not NSD.
- Establish a WebRTC data channel offline from a cold start and compare it with a socket-based carrier. No WebRTC result is claimed here.
- Measure backpressure, network transitions, app restart, Doze/background restrictions, advertising battery cost, and permissions on real devices.
- Measure browser mDNS visibility, incoming-socket restrictions, and HTTPS-to-LAN behavior.
- Read-only measurement of `TrustFreshnessAdmission` for cold-started verified **test identities** with relay unreachable. No freshness result or policy change is claimed.

## Design implications and decisions

The prototype shows that a bounded dummy frame can cross a local TCP path and that multicast beacons can be observed on the same Mac. It also shows a concrete failure mode when the peer listener is unavailable. The emulator measurement is a functional smoke test, not a latency target.

**Production go/no-go:** no-go for enabling or merging a LAN path from this evidence. The handoff's real-device matrix, peer-admission approval, freshness decision, stable envelope identity, authenticated receipt design, and mixed-version capability negotiation remain gates. This is a lack of evidence, not evidence that LAN transport is infeasible.

**D13 (data channel versus another carrier):** open. This run contains no data-channel measurement. Compare cold offline establishment, browser limits, backpressure, and recovery on real devices before choosing.

**D14 (advertising default):** open. The experiment requires an explicit `--advertise` flag or button; battery, privacy, and Doze costs are unmeasured. Do not infer a production default from this choice.

**M6 (offline trust freshness):** open. The current ADR 0005 default remains fail closed when required evidence is unavailable. No cached-state exception or fabricated freshness was introduced.

## Security notes

Multicast beacons and TCP acknowledgments in this experiment are unauthenticated and forgeable. They contain no real identifiers or secrets and convey no trust. Production LAN transport would need the approved `PeerAdmission` transcript, verified unchanged contact eligibility, lifecycle freshness, exact conversation/peer binding, stable ciphertext identity, durable duplicate handling, and authenticated receipts. Candidate addresses and dummy payloads are not written to logs or the report.

## Validation and isolation

- `node --test experiments/lan-spike/test/*.test.mjs`: 6 passed.
- `android/gradlew -p experiments/android-lan-spike :app:assembleDebug`: passed with JDK 17 and Android SDK 35.
- Disposable emulator install/launch: passed; direct dummy probe and stopped-listener failure observed.
- Source isolation scan: no import of `service/src`, `@chat-e2ee/service`, production Android packages, `ModernConversation`, or `DeliveryCoordinator` under `experiments/`.
- Only `experiments/**` and this report are intended for the spike commit. Generated APK/build files are ignored.
