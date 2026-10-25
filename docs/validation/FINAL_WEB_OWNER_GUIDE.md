# Owner guide — candidate review and future controlled activation

This is a plan only. Nothing was published or deployed. Keep the existing Mac/Android APK workflow separate; no APK is involved.

## Decide before publishing

The candidate is reviewed locally, not approved for automatic rollout. Read the final report and recovery options. Confirm, without sharing credentials:

1. The exact current Render live SHA, service, selected branch, Auto-Deploy setting, instance count and worker termination evidence available in the dashboard/logs. Last owner-confirmed baseline is 871fa99; it was not queried again.
2. Intended Mongo deployment is a supported replica set with transaction/snapshot support and appropriate permissions; collection validators allow the additive owner/fence fields. An example URI or green health endpoint does not establish this. No new index/bulk migration is required by durable ownership; inspect existing migration prerequisites before any separately approved operation.
3. Use one production instance as required by the existing validator. Keep FCM disabled and current origins/proof secrets unchanged. Do not copy test secrets/certificates/database names.
4. Agree that both peers must adopt while their old authority is valid; an offline old peer may temporarily block relay. Beta22 cannot perform new long-inactivity renewal. Already-expired owner conversations need the separate recovery choice.

Mongo transactions require a supported replica set, not standalone: [MongoDB production considerations](https://www.mongodb.com/docs/v8.0/core/transactions-production-consideration/).

## Future deployment sequence — requires separate approval

Codex must first receive approval for exact private/public destination, sanitized branch publication and Render operations. No push is authorized by this document. Do not change public branches simply to get Render to fetch this candidate. Use manual deployment/Auto-Deploy off and verify the exact final SHA.

A controlled maintenance window is required; do not promise zero downtime:

1. Deploy the reviewed routing-aware candidate with `K3NCRYPT_DURABLE_ROUTING=false` and `K3NCRYPT_MAINTENANCE_MODE=true`. This is a bridge, NOT activation. Old binaries may still serve during replacement; no adoption is permitted.
2. Obtain provider evidence that ALL pre-routing workers exited: old deployment/instance IDs, termination/exit/kill completion, no remaining old serving instances. One successful health request, elapsed waiting, or a green replacement is insufficient. If evidence is unavailable, stop activation and ask for an explicit provider-supported termination procedure; do not guess.
3. With maintenance still on, deploy the same SHA with `K3NCRYPT_DURABLE_ROUTING=true`; wait for replacement and confirm the guarded revision/settings. Environment edits may create replacement workers, not mutate old ones. Preserve maintenance until old flag-off bridge processes have exited as well.
4. Remove application maintenance through another manual deployment of the same SHA/flag. Previous guarded workers must remain nonserving/maintenance-gated. Confirm final ready revision and one-instance configuration, then perform only separately authorized disposable-account smoke tests.
5. Coordinate current-client adoption for both participants before promising long-inactivity recovery. Do not rewrite legacy records or auto-adopt absent peers.

The application gate allows GET/HEAD health/readiness only, API requests receive 503 with Retry-After and new Engine.IO connections are rejected. This is K3NCRYPT's application maintenance setting, not an assumption that a free Render plan includes provider maintenance mode. Existing event guards and final authority checks remain necessary.

Render switches traffic and drains previous instances before termination; shutdown details depend on service settings. Obtain actual worker completion evidence rather than treating documented timing as proof: [Render deploys](https://render.com/docs/deploys), [Render deployment lifecycle](https://render.com/articles/how-render-handles-zero-downtime-deploys).

## Future smoke tests and monitoring

After separate authorization, inspect exact build/deployment SHA and configuration in provider evidence. Health/readiness do NOT expose a revision or prove old-worker absence.

```sh
curl --fail --silent --show-error "$K3NCRYPT_APPROVED_ORIGIN/api/health"
curl --fail --silent --show-error "$K3NCRYPT_APPROVED_ORIGIN/api/ready"
```

Use only explicitly authorized disposable accounts for a fresh invitation, comparison/verification, both-party adoption, online encrypted text, offline relay acceptance then recipient replay, small file hash verification, cancellation and sign-out/restart. No owner vault inspection, automated re-verification or production TTL manipulation. Stop on authorization changes, repeated unexpected 403/503, queued sends without acceptance, integrity errors, memory exhaustion or restart loops. Treat rate limiting honestly; do not raise limits as a shortcut. Confirm mailbox Sent versus recipient Delivered independently of health.

## Rollback boundaries

Before any ownership adoption: a separately reviewed security-only candidate may be considered; old 871fa99 has known attachment security/BSON defects. Do not casually restore it.

After ANY adoption: do NOT run 871fa99, the standalone old hotfix, or another owner-unaware binary. They ignore durable tombstones. Turning the flag off blocks upgraded rooms. Prefer maintenance isolation plus forward repair, or a reviewed routing-aware binary such as runtime 12a199f9 (same production source as this gate), preserving flag policy, schema, current devices, owners, tombstones and accepted mail. No database restore or deletion to undo adoption. If authority-aware recovery cannot be established, remain in maintenance and seek an explicit decision.

## Local test cleanup and artifacts

Only task-owned synthetic databases/profiles/certificates and child processes are used by tests. The reviewed harness removes its own disposable certificate and database. No production resources need cleanup. Keep review ZIP and Git commits; do not remove owner profiles, APKs, signing keys or existing worktrees. Native apps are unchanged.
