# Phase 6C threat model

Status: design only; baseline `fe59eed5576fa453407766272c594727ea81ca2c`.
Read with the [architecture](PHASE6C_COMPLETE_ARCHITECTURE_SPECIFICATION.md)
and [principles](PHASE6C_SECURITY_PRINCIPLES.md). Defenses below are required
future controls unless explicitly identified as existing. They are not audit
closure evidence for Phase 6B.

## Assets and assumptions

Assets: device identity keys, vault and session state, message/media plaintext,
archive secret and selected recovery data, group/call epoch secrets, verified
contact mappings, device membership, replay journals, deletion evidence, release
signing authority, user consent, metadata privacy and service availability.

Trust boundaries: UI to security adapter; verified peer session to lifecycle;
protocol state to transactional storage; client to relay/SFU; application to OS
keystore; build system to update installer; user-held recovery material to fresh
device; own-device membership to independent-user group membership.

Assume a relay can read operational metadata and drop, reorder, replay or fork
traffic. An authorized malicious participant knows its authorized plaintext and
may disclose it. A compromised unlocked endpoint can use its keys and forge its
own user actions. Hardware protection does not stop an authorized compromised
process from reading plaintext. Network connectivity and honest time are not
unconditional assumptions. No global instantaneous revocation is claimed.

## Adversarial matrix

| Actor / attack | Impact and asset | Required defense / test | Remaining limitation |
| --- | --- | --- | --- |
| Malicious server substitutes device directory records | Fake enrollment, identity confusion | Derive peer identity from authenticated runtime and explicit verification; substitute every identity/routing field in composition tests | An already compromised active device may approve an attacker under existing authority |
| Malicious server equivocates on epochs or group commits | Split views and stale access | Persist high-water/checkpoint evidence; compare authenticated peer transcripts; suspend forks; exercise delayed/reordered partitions | Indefinite isolation may hide forks and cause unavailability |
| Malicious relay replays old valid sync/call frames | Duplicate application or stale membership | Durable stream/replay state and current trust checks before release/import; replay across actual process restart | A digest or process-local set alone is insufficient; 6B fixes are prerequisites |
| Stolen locked device | Offline key/history theft | Encrypted vault, platform wrapping, explicit unlock and backup exclusion; test copied files on a different OS account/device | Weak unlock secrets and OS compromise may defeat protection |
| Stolen unlocked device | Valid outgoing impersonation and new device approval | Revoke and propagate fences; replace affected sessions/group leaves; test stale live handles after cutover | Prior data and operations before cutover remain exposed |
| Compromised endpoint records calls or exports text | Content confidentiality loss | Minimize retained material, release capture tracks, exclude secrets from logs; test lock/end/crash behavior | No E2EE design prevents an authorized recipient copying plaintext |
| Malicious application update exfiltrates vault data | Broad endpoint compromise | Signed/provenanced builds, two-person release controls, anti-rollback and independent reproducibility; reject modified/old artifacts | Authorized malicious signed code can still capture future unlocked plaintext |
| Network attacker injects ICE/SDP or intercepts TLS | Call hijack, metadata and availability | Existing authenticated signaling plus group call context binding; certificate validation; mutate endpoint/roster/epoch fields | Traffic analysis and denial of service remain |
| Metadata observer correlates sizes/timing/push | Relationship and activity inference | Scoped identifiers, bounded retention, padding profile and optional consistently routed proxy mode; measure observable traces | Global correlation, provider logs and media traffic patterns remain |
| Supply-chain attacker changes dependency/build job | Compromised client or server | Locked sources, integrity verification, SBOM, isolated jobs and release provenance; substitution/rebuild tests | Toolchain maintainers and runtime OS remain trust dependencies |
| Recovery archive thief without secret | History/contact exposure | Reviewed authenticated archive encryption and high-entropy offline secret; corruption and offline-guessing analysis | Size, possession and storage timing may leak metadata |
| Attacker steals archive and secret | Recovered content and social impersonation | Exclude live keys; fresh identity; independent contact comparison; simulate forged replacement claims | Selected historical plaintext is lost; rotation cannot recall copied kits |
| Server or attacker replays old recovery archive | Rollback of contacts, deletion or trust | Import as unverified historical data; preserve tombstones/provenance; fresh scope; test old-kit restore and simultaneous replacements | With all trusted checkpoints lost, freshness cannot always be established |
| Malicious group participant forges another sender | Attribution compromise | Reviewed credential binding and group/media sender authentication; cross-sender packet/proposal tests | Shared key possession alone may not authenticate an individual sender; profile review required |
| Removed Charlie uses an old device/key | Future message/call disclosure | Remove every relevant leaf, commit rekey before new release, reject stale epoch and rejoin without consent | Old ciphertext and collusion with remaining recipients stay readable |
| New member receives old history keys | Backward secrecy violation | No epoch-secret export; default no history; explicitly labeled selected history export only | A current member can disclose its retained history |
| SFU operator decrypts or substitutes media | Call surveillance or attribution attacks | Endpoint frame protection and separate call membership keys; adversarial SFU captures and modifies packets | SFU still sees forwarding headers, sizes, timing and participant connections |
| Storage attacker restores older valid database | Reused sequence or stale trust | Atomic journaling/CAS, independent high-water evidence and startup suspension; fault every transaction boundary | Complete rollback of all independent anchors may be undetectable |
| Concurrent clients write divergent states | Silent trust merge and lost updates | Causal application conflicts; existing device fencing; reviewed group conflict policy; permutation/multi-process tests | Blocking on missing peers is an accepted availability cost |
| Malicious peer floods archives/manifests/groups | Memory, CPU or storage exhaustion | Bounded parsing/staging, per-scope quotas, admission limits, no decompression surprise; boundary/fuzz tests | Resource exhaustion can still deny service; quotas must not auto-delete replay evidence |

## Feature-specific acceptance evidence

Recovery: demonstrate all-device loss with and without a kit, wrong secret,
archive tampering, identity substitution, duplicate restore, concurrent replacement,
lost notification and malicious surviving old device. Assert no inherited verified
flags, old live session or group admission. Success means selected data restoration
and explicit new trust, not silent continuity.

Clients: for Android, iOS, Windows, macOS and Linux, test vault lock/suspend,
process kill during commit, OS backup/restore, uninstall/reinstall, clock rollback,
second process, denied permissions, capture cleanup and key-store unavailability.
Inspect logs, notifications, temporary files and crash artifacts for secrets.

Groups: Alice/Bob/Charlie each use multiple independent devices. Remove Charlie
and then one Alice device; prove newly released traffic is unavailable to every
removed leaf after cutover. Inject old commits, unknown credentials, unauthorized
admin changes and valid concurrent proposals. Validate fresh joins have no prior
epoch material and fork uncertainty blocks sending.

Calls: malicious SFU, reordered/replayed frames, counter reuse after restart,
wrong call/track/sender context, removed participant reconnect, failed rekey,
missing platform frame-encryption support and permission denial. Assert no
transport-only fallback and no capture before the user joins.

Operations: compromise simulation for relay, signing key and dependency; verify
containment, independent advisory delivery, artifact revocation and clean rebuild.
Metadata tests compare network/log captures against the documented disclosure
budget; do not label padding or TLS as anonymity.

## Readiness

NOT READY. Phase 6B's latest audit findings remain open, and group/recovery/media
profiles have the concrete unresolved choices listed in the roadmap. External
review must test actual runtime and durable adapters; interface-level tests alone
cannot establish the guarantees in this model.
