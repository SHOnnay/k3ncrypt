# Phase 5 replay protection production model

`ReplayProtectionStore` is the required boundary for call signaling claims. The memory implementation is only for tests and single-process development.

A production adapter must provide an atomic conditional claim keyed by conversation/call/sender/sequence, a server-consistent TTL expiry, cleanup/TTL indexes, bounded key and entry sizes, and shared state across every application instance. A duplicate must never be accepted by two instances. Expiry must be checked at claim time as well as by background cleanup. Capacity exhaustion is a distinct failure from a duplicate or expired event and must fail closed with bounded operational metrics that do not log signaling payloads.

The transport currently claims before delivery. A deployment must define an outbox/retry policy: a failed relay send must not allow an attacker to reuse a claimed sequence, but a legitimate retry must have a safe idempotent outcome. Do not replace the store with process-local maps in production, disable expiry, or accept sequence claims based solely on client time.
