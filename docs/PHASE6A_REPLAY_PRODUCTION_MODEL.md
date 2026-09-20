# Phase 6A replay protection production model

Status: adapter boundary only. No database-specific replay implementation is enabled by this milestone.

## Boundary

`ReplayProtectionStore` remains the call-signaling dependency. Tests use `MemoryReplayProtectionStore`, which provides TTL cleanup, duplicate detection, bounded capacity, and explicit `accepted`, `duplicate`, `expired`, and `capacity-exceeded` outcomes.

`DurableReplayProtectionStore` is the production composition boundary. It delegates to an injected `DurableReplayProtectionAdapter` with two required operations:

- `atomicClaim(key, expiresAt, now)`: one conditional claim shared by every service instance;
- `cleanupExpired(now)`: bounded TTL cleanup.

The repository intentionally does not invent Mongo/Redis/database code. A deployment adapter must be selected and reviewed separately.

## Required production properties

- atomic claim and duplicate rejection under concurrent requests;
- shared state across instances and restarts;
- server-consistent expiry time and bounded key/value size;
- TTL cleanup and capacity/abuse controls;
- metrics that do not log signaling payloads, keys, or capabilities;
- an explicit retry/outbox policy because claiming before transport delivery can create a safe availability failure after a transient send error;
- fail-closed behavior when the store is unavailable.

## Verification plan

Before production use, exercise concurrent duplicate claims, restart recovery, clock skew, expired entries, capacity exhaustion, instance failover, transport retry, and cleanup/index behavior against the chosen durable store. Keep the memory adapter for deterministic unit tests only.
