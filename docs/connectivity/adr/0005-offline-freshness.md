# ADR 0005: Device-trust freshness while offline

Status: Skeleton; measurement and owner decision remain open. Default: fail closed when currently required evidence is unavailable.

## Facts to measure

- Does a cold-started verified Android pair pass current `TrustFreshnessAdmission` with relay unreachable?
- Which evidence is persisted, where, and for how long?
- Does a currently established LAN path carry fresh authenticated lifecycle evidence without changing trust state?
- What behavior follows after a remote revocation that occurred while disconnected?

## Options for owner

F1. Keep current enforcement and define measured evidence lifetime.

F2. Permit cached state with a persistent notice that unseen revocations cannot be detected offline. This changes policy and requires explicit security approval.

F3. Disable LAN whenever current freshness evidence is unavailable (strict fail-closed form).

Signatures prove authenticity, not that no newer revocation exists. Do not choose a maximum age, fabricate evidence or weaken current gates in implementation branches without the owner's decision.
