# Connectivity rollback plan

Every later feature remains disabled by default and can be disabled without rewriting identity, sessions, verification or existing conversation descriptors.

| Stage | Rollback point | Runtime rollback | Data rule |
|---|---|---|---|
| Phase 0 specification | Main baseline `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f` | No runtime change | Docs/fixtures/tests only |
| Phase 1 delivery boundary | `connectivity/p0-complete` after merge | Select relay adapter only; keep current relay protocol | Existing records load unchanged |
| LAN feasibility spike | Throwaway `connectivity/lan-spike` | Do not merge spike behavior | Only reviewed report may be kept |
| LAN messaging | `connectivity/p1-complete` | Disable LAN; retry retained envelopes through relay | No session/identity rewrite |
| Direct path | `connectivity/p2-complete` | Disable direct candidate gathering and negotiation; relay continues | Existing pending envelopes remain intact |

For any release rollback, turn off the new path, stop its connections idempotently, retain encrypted outbox items, then resume relay retry. Never delete session state as rollback. Rollback testing must include pending sends and a client upgrade/downgrade pair.
