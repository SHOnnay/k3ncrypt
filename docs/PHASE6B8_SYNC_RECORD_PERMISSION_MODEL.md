# Phase 6B.8 sync record permission model

Normative design only. See [protocol](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md).
The owner of replicated application data is the pinned user scope, not the
server or the device that happens to hold a copy. Source provenance is separate
from ownership. Reader/writer below always means a currently active, directly
authenticated same-scope device under valid admission, unless explicitly narrower.

## 1. Permission matrix

| Object | Owner | Reader | Writer | Revocation behavior |
| --- | --- | --- | --- | --- |
| Text message history | User-scope retained copy; original remote authorship remains attributed | Selected target under explicit history consent | Observing own device introduces immutable historical record; current exporter attests its retained copy | No new exports to target; retained old plaintext/ciphertext cannot be recalled; old live authorizations reject |
| Conversation index | User scope | Eligible approved target | Introducing device allocates replica ID; others may edit allowed label only | No new metadata transfer; existing copy may remain; no implicit session reuse |
| Contact label | User scope | Approved target | Any current own device through causal register | Revoked edits reject; accepted old label remains unless explicitly changed |
| Contact identity / verification evidence | User scope's observations; verification is local trust | Approved target receives provenance | Existing observation/verification adapters only; importer stages evidence, never marks verified | Old evidence is historical; changed identity blocks; revoked writer cannot grant fresh trust |
| Read/unread records | User scope | Approved target | Current own devices, only for known records | Reject future writes; no rewrite of past accepted markers |
| Appearance settings | User scope preference | Approved target | Current own devices; allow-listed value fields only | No future writes; OS permissions and vault policy never imported |
| Attachment metadata | User-scope placeholder for an existing media message | Approved target | Source may attest placeholder only | No download authority; no tokens/keys/filename propagation; expired media stays unavailable |
| Device state | Existing lifecycle authority in user scope | Public-only checkpoint hints to directly authenticated peers; bootstrap follows restricted ceremony | Existing lifecycle service/verified authorization only, not sync importer | Target gates close locally immediately; global fencing remains subject to protocol §10 |
| Deletion tombstone | User scope | Every recipient of that collection before visible import | Current own device with explicit local own-scope delete | Old tombstones retained; revoked fresh deletions reject; no remote deletion guarantee |

Unrelated contacts, server accounts, routing addresses and unauthenticated devices
have no permission. Pending devices only receive existing public enrollment data.
Same-scope membership does not grant a device another device's keys, session,
permission prompt or external service capability.

## 2. Record and operation schemas

Use protocol scalar types and canonical ordering. Record wrapper keys:

`version:1, scope:Ref, record:ID, kind:Kind, versionId:Ref,
author:Ref, authorSequence:U, previousAuthorDigest:Nullable(H),
parents:Ref[], provenance:Provenance, value:Value`.

`versionId` is exactly `author + ":" + canonicalDecimal(authorSequence)`.
Because concatenation can exceed Ref's 256-byte limit, versionId and parent
version references allow 280 UTF-8 bytes; author retains the 256-byte bound.
Sequence is at least 1. The previous digest is the previous operation's logical
digest (defined below) and is null only for the author's first operation.
`parents` sort by UTF-8 bytes of the whole version reference.
Record digest is SHA-256 of prefix `k3ncrypt-sync-record-v1:` followed by canonical
record bytes. Maximum canonical record bytes 65536 including wrapper.

Provenance keys:
`exporter:Ref, origin:"local"|"imported-history", originalAuthor:Nullable(Ref)`.
Exporter must match authenticated manifest source. For local operation admission,
author must equal source. Imported-history records are copies with unchanged
original record/version IDs but their exporter is explicit; never treat exporter
as cryptographic proof of originalAuthor. Preserve the original canonical record
digest separately in retained historical storage when re-exporting with changed
provenance; changing exporter must not be reported as conflicting original content.

To remove digest ambiguity: compare **logical digest** for duplicate version IDs
using the same canonical wrapper with `provenance` omitted, and compare the full
record digest for transfer integrity. Local original records and imported records
can share a logical digest; provenance never changes authority. Same logical ID
and different logical digest always conflicts. The manifest authenticates full
bytes including exporter and attribution.

Kind-specific Value schemas, keys in order (no arbitrary object payloads):

| Kind | Value |
| --- | --- |
| `conversation` | `contact:ID, fingerprint:Ref, protocol:"modern"|"legacy", label:Text(256)` |
| `message` | `conversation:ID, senderFingerprint:Ref, text:Text(49152), expiresAt:Nullable(U)` |
| `contact.label` | `contact:ID, label:Text(256)` |
| `contact.evidence` | `contact:ID, fingerprint:Ref, verifier:Ref, status:"unconfirmed"|"changed"` |
| `setting.appearance` | `theme:"paper-ink"|"slate-dusk"` |
| `read` | `conversation:ID, messages:ID[]` (ascending, unique, at most 256) |
| `unread` | `conversation:ID, message:ID, action:"mark"|"clear", markers:Ref[]` (clear's exact marker versions, otherwise empty) |
| `contact.block` | `contact:ID` |
| `attachment.placeholder` | `conversation:ID, message:ID, availability:"unavailable"` |
| `delete` | `target:ID, extent:"own-scope"` |

Message text is imported historical/application content only; this record does
not cause an outbound message to the contact. New history observation uses the
same schema. `expiresAt` preserves existing source expiry, never grants extra
retention. Null is allowed only when the original record has no expiry.

`device.state` is deliberately **not a Value kind**: public checkpoint exchange
uses protocol reconciliation frames. Full lists and authorizations flow only
through the existing validated lifecycle boundary. No unknown future kind is
passed through generically. Local security/OS settings, session IDs, transport
capabilities, attachment keys/tokens, filenames and filesystem paths are excluded.

## 3. Immutable identity fields and import authority

For an existing conversation, contact ID/fingerprint/protocol cannot be overwritten
by a new generic record. A conflict stages evidence and disables sensitive use.
An importer does not directly call `markVerified` from an incoming status field.
Remote-contact sending requires an independent authorized relationship on the
receiving device; neither shared replica ID nor synced label supplies it.

Lifecycle controls cannot be smuggled inside text or records. Only the explicit
control parser and existing authority service may mutate device state. The same
holds for a string containing a call or attachment command: displaying text is
not dispatching it. Render/import layers must never execute record content.

Source validates permissions before manifest creation. Destination independently
validates source session, same scope, active target, current admission, kind,
record ownership, causal relationship, consent selection and deletion/expiry
at final commit. A source-side allow decision alone is insufficient.

## 4. Initial scope and accepted limits

The authority model permits an active compromised device to read its eligible
data, lie about historical observations, enroll a controlled target under the
existing ceremony, or issue authorized own-scope deletion. No claim of independent
honest-user confirmation survives complete endpoint compromise. Sync neither
increases that device's cryptographic privileges nor cures this policy risk.

Only appearance is synchronized in v1 settings. Unblock is local-only; generic
sync cannot increase trust. Attachment placeholders contain no secret-bearing
reference, filename or MIME. Contacts arrive as shared records with local
verification still unconfirmed. These are intentional v1 limits, not promises
that full media/contact-trust compatibility already exists.

## 5. Permission test table

For every kind exercise: unrelated scope, pending source/target, revoked source,
stale epoch, missing consent, wrong actual session peer, same-ID changed ownership,
expired record, replay and unknown extra key. Verify no visible record, trust
mutation, download, network send or ACK occurs on rejection. Explicitly attempt
device activation via a record, verified-flag injection, attachment token copying,
protocol-mode replacement and history-as-live-message dispatch.
