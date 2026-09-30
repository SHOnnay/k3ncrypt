# Phase 2D LAN architecture decision test plan

**Purpose:** collect evidence for HANDOFF D13, D14 and M6 before any production LAN adapter. Current spike is a dummy-data smoke test, not a pass for this plan. Use disposable test identities only where identity/lifecycle evaluation is necessary; do not send real messages or log sensitive data.

## Evidence matrix

| Area | Setup and measurement | Required observation / stop condition |
|---|---|---|
| Real-device coverage | At least three physical Android devices across supported OS versions plus a desktop; ordinary Wi-Fi, hotspot, guest/client-isolated Wi-Fi | Record OS, network type, trials, success/failure counts and bounded time distributions. Emulator runs are supplementary only. Do not claim LAN readiness if real-device matrix is incomplete. |
| NSD discovery | Foreground advertise/browse, app restart, network switch, no internet, service withdrawal, duplicate names, forged service/TXT | Measure cold discovery and stale-entry lifetime. Forged hints must never create contacts or satisfy admission. Observe permission prompts and service visibility. |
| Offline DataChannel | Start both peers with internet physically unavailable; use discovered local rendezvous, host-only ICE, cold app/process state | Offer/answer, DTLS and DataChannel must establish without public STUN/TURN, relay, or cached online signaling. Record failures per network. Failure blocks DataChannel carrier choice. |
| TCP alternative | Establish dummy local socket on identical devices/networks; propose and review authenticated channel binding before any real envelope | Compare setup, resource cost, teardown and failure with DataChannel. Unauthenticated TCP results are feasibility only and cannot satisfy M5. |
| Android lifecycle | Foreground/background, Doze, screen lock, force-stop/restart, Wi-Fi loss/rejoin, permission denied/revoked | Observe advertisement/discovery behavior, socket/channel leaks, battery and memory. No false delivery state or stale admission. |
| Web/desktop | Current supported browsers and a desktop runtime; test browser ICE/local-candidate behavior, permissions and HTTPS context; native desktop discovery separately | Record what works, fails, or requires relay/manual rendezvous. No assumption of browser NSD or incoming TCP. |
| Privacy | Opt-in off, relay-only, hide-address, contact opt-in revoked during discovery/ICE | No NSD advertisement, optional browse, candidate gathering, or direct connection before consent; teardown on change. Inspect captures/logs for stable identifiers and addresses. |
| M5 admission | Approved transcript fixtures; wrong peer, conversation, role, nonce, version, DTLS fingerprint; replay/reflection; malformed/oversized frame | All reject before an envelope; no trust, registry, session, or conversation mutation; relay remains usable. Security review required before implementation. |
| M6 offline freshness | Read-only `TrustFreshnessAdmission` evidence with cold verified test identities and relay unavailable; known revocation during outage | Record exact evidence and its lifetime. No inferred unseen-revocation knowledge. LAN stays blocked if required evidence is missing until owner decision in ADR 0005. |
| Delivery/migration | Same saved ciphertext via LAN then relay under definite and ambiguous failure; old/new clients; process crash/restart; recipient offline | One durable acceptance, pre-decrypt dedupe, valid receipt only for peer persistence, same ciphertext on retry; old clients relay-only. These are later-phase acceptance tests, not Phase 2D implementation. |

## Decision procedure

1. Record raw trial counts, OS/network conditions, test harness version, and qualitative permission/privacy behavior. Avoid publishing local addresses, contact identifiers, capabilities, fingerprints, keys, or payloads.
2. Compare DataChannel and the reviewed TCP option on the same physical devices and networks, including offline cold start, failures, backpressure, background teardown and power cost. A speed win alone cannot override admission or privacy gates.
3. Security review the complete rendezvous and channel-binding transcript. If neither carrier meets M5 and offline requirements, record D13 as **no production carrier yet** and continue relay-only.
4. Ask the owner to decide D14 advertising default and M6 freshness from measured evidence. Until then, advertising is off/foreground-only and missing required freshness blocks LAN.
5. Only a subsequent reviewed Phase 2B proposal may convert these results into production code. Preserve the spike report and this plan as evidence; do not merge experiment code.
