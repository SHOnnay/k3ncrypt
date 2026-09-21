# Phase 6B Distributed Trust Enforcement

## Scope

This milestone adds the application-level enforcement boundary for device
trust changes. The existing lifecycle store remains the source of truth;
Vodozemac, `CryptoSession`, message encryption, mailbox encryption,
attachment encryption, media encryption, and call cryptography are unchanged.

## Architecture

```text
DeviceLifecycle (durable list, epoch, commitment)
                |
                v
       DeviceTrustEnforcer
                |
       TrustStateEventCoordinator
                |
   sessions / messaging / attachments / calls
```

`DeviceTrustEnforcer` is the single application boundary. Consumers do not
reimplement lifecycle rules. Each protected operation reads and verifies the
current canonical commitment and requires the local device to be active and
bound to the expected identity reference.

## Propagation model

Lifecycle changes emit an encrypted `trust-state` control event containing an
event id, scope, epoch, commitment, target device, identity reference, and
state. It travels through the existing authenticated signaling session; no
raw or plaintext control channel is introduced. `TrustStateEventCoordinator`
accepts only events that match the locally verified state at the current epoch.
It rejects replayed, stale, future, forked, malformed, or identity-mismatched
events. A notification never creates trust by itself: durable lifecycle state
must first be committed and commitment-verified.

This conservative rule means an instance with unknown propagation state fails
closed rather than continuing on an old decision. A deployment adapter must
provide shared durable lifecycle state and atomic event delivery for
multi-instance convergence; the in-process memory set is only replay
protection for one runtime.

## Revocation and session invalidation

Revocation commits the device list, incremented epoch, commitment, and
authorization record through the existing atomic persistence boundary, then
publishes a trust-state event. Every modern conversation operation observes
the current epoch before sending, receiving, creating calls, or mutating
device trust. A stale epoch or revoked entry closes the local Vodozemac
runtime through its public `close()` boundary and clears call composition.
No CryptoSession internals are changed.

An instance receiving a revocation event cannot keep using an old list: the
event is accepted only when its commitment is already present locally. If the
state is missing, delayed, or inconsistent, the event is rejected and
protected operations remain unavailable until state converges and verifies.

## Attacks tested

- revoked device and identity mismatch are rejected;
- corrupted commitments are unavailable;
- old epochs are rejected;
- future epochs fail closed;
- same-epoch commitment forks are rejected;
- duplicate propagation events are rejected;
- event target/state mismatches are rejected;
- a protected operation with a stale epoch is rejected.

The tests exercise the trust enforcer and propagation coordinator. Existing
runtime, authorization, lifecycle, and cryptographic regression suites remain
in force.

## Remaining deployment risks

1. A production deployment still needs a shared, atomic lifecycle persistence
   adapter and durable cross-instance event delivery. Local secure storage and
   its process lock are not a substitute for a distributed transaction.
2. Transport availability and event delivery are not treated as proof of
   trust; unknown propagation is intentionally fail-closed.
3. Recovery and multi-user/group trust models are out of scope. No recovery,
   group messaging, or mobile implementation is introduced here.

## Validation

The targeted trust suite passes. Full validation commands are run for this
commit and their exact results are recorded in the handoff.
