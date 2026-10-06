# Call media readiness: compatibility stop report

**Branch:** `codex/main-call-media-readiness`
**Base:** `d69df7f7022ae2e196a067632be6e6cff6d72de8` (`codex/main-call-lifetime-hardening`)

Work stopped at the mixed-version compatibility gate, before changing call or media code. The existing signal format cannot safely negotiate the changed expiry meaning between current and legacy clients.

## Wire behavior found

`CallSignal` has no protocol version, expiry-mode, or capability field. Its authenticated fields include `timestamp`, `expiresAt`, `event`, `kind`, and `mediaMode`. `kind` distinguishes control, offer, answer, and ICE candidate; `mediaMode` distinguishes audio and video. Neither identifies an implementation version.

The outer encrypted-message envelope's `version: 2` identifies the Vodozemac envelope format. It does not identify call lifetime semantics and must not be treated as a call capability.

In the lifetime-hardening source:

- INVITE uses the bounded invitation deadline.
- Other signals use an expiry no later than 60 seconds after that signal's timestamp.
- Web send/receive validation enforces safe timestamps and a maximum 60-second per-signal lifetime.
- Android's codec applies the same per-signal bound.

In the pre-lifetime source at `5aaffdd2481bcbf64a3715d96a1882ab847d5b9b`:

- Web sends every signal with the session's invitation `expiresAt` and rejects sends after that deadline. Its sender also rejects a signal whose expiry exceeds the local session deadline.
- Android sends every signal with the stored invitation `expiresAt`. Its controller discards an incoming signal for the active call when `signal.expiresAt > expiresAt`, where `expiresAt` is the invitation deadline.
- Neither client has a call-protocol capability negotiation.

The lifetime-hardening Android controller removed the old invitation-deadline comparison for subsequent signals. It separately expires invitation/setup states and uses the codec's per-signal freshness check. Thus the comparison below is a legacy Android behavior, not a current/current Android defect.

An old and a new INVITE look the same because both carry the invitation deadline. A receiver therefore cannot safely choose a signaling-expiry mode from the INVITE alone.

## Compatibility findings

| Pair | Finding |
| --- | --- |
| New Web ↔ new Web | Per-signal freshness is supported by the service layer. |
| New Android ↔ new Android | The hardened sender and receiver use per-signal freshness, while setup timeout remains tied to the invitation. |
| New Web → legacy Android | A fresh ACCEPT or media signal can exceed the invitation deadline; the legacy Android controller drops it. |
| New Android → legacy Web | Legacy Web can receive fresh signaling during setup, but it cannot originate signaling after its session invitation deadline. Established media may continue; post-deadline negotiation, reconnect, and control signaling are not reliable. |
| Legacy Web/Android → new clients | Legacy signals remain bounded by the invitation deadline. New clients can accept them only while that deadline has not passed; they cannot carry fresh signaling after it. |

## Why no adapter was applied

There is no existing field that identifies the peer's expiry semantics before ACCEPT. The invitation itself does not distinguish old from new. A fresh ACCEPT/offer sent to legacy Android can be discarded after its replay/sequence state has already advanced. Sending a legacy-shaped ACCEPT/offer by default is also ambiguous with a current peer; sending both forms risks duplicate state transitions and replay/sequence conflicts. A timeout-and-fallback scheme would need explicit rules for retries, sequence/nonce handling, call termination, and peer-version learning; that is a protocol change and needs its own design and cross-platform tests.

The safe freshness rule remains: reject expired signals. Do not extend an old invitation deadline or accept stale legacy signaling to preserve apparent compatibility.

## Required boundary before video exposure

The minimum boundary for the intended per-signal lifetime behavior is a client build containing the lifetime-hardening changes from `e399654` (Web signaling) and `3cdb5a3` (Android signaling), including the setup deadline being checked independently of individual signal expiry. Builds from `5aaffdd2481bcbf64a3715d96a1882ab847d5b9b` and older do not meet that boundary. Before video UI exposure:

1. Fix and test Android's distinction between the invitation/setup deadline and each signal's freshness deadline.
2. Define an authenticated, explicit call-protocol capability/version negotiation, or impose and enforce a minimum client release that includes the Web and Android per-signal semantics.
3. Until both peers satisfy that boundary, do not promise calls that require signaling after the invitation deadline. Do not silently downgrade expiry validation.

This branch does not change verification behavior, permissions, capture ownership, mute/camera controls, ICE configuration, or UI. Those goals remain unstarted pending this compatibility decision.
