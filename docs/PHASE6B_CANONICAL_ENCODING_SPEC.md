# Phase 6B canonical encoding specification

Status: normative design addendum. The encoding is used for device-list commitments, enrollment fingerprints, and authenticated control objects. It does not define a new cryptographic primitive.

## Normative encoding

Device-list objects use **canonical JSON** encoded as UTF-8. The canonicalization rules are:

- object members use the field order listed in the schema;
- no whitespace, trailing bytes, comments, or duplicate keys;
- arrays use the protocol-defined order, never runtime insertion order;
- device entries are sorted by the UTF-8 byte ordering of `deviceId`;
- strings are Unicode NFC and encoded as UTF-8;
- timestamps, epochs, sequences, and versions are non-negative base-10 integers in JSON number form;
- floating point, `NaN`, `Infinity`, negative zero, implicit defaults, and locale formatting are forbidden;
- absent optional fields are omitted according to the schema; `null` is not interchangeable with omission;
- booleans and enum values use the exact lower-case literals specified by the schema;
- parsers reject unknown fields and duplicate identifiers rather than normalizing them.

The canonical bytes are the UTF-8 bytes of this compact representation. Implementations must publish and test byte vectors; a runtime's ordinary `JSON.stringify` behavior is not itself a specification.

## Commitment and fingerprint

The device-list fingerprint is:

```text
SHA-256(canonical-device-list-object-bytes)
```

The digest is represented in lower-case hexadecimal for machine comparison. Human comparison uses the same digest split into fixed groups (without changing the underlying bytes); QR payloads carry the canonical public fields and expiry, never private keys or permanent bearer capabilities. Transport wrappers and signatures/envelopes are excluded from the list commitment.

Control objects include `formatVersion`, `previousEpoch`, `nextEpoch`, `previousCommitment`, sorted entries, nonce, sequence, timestamps, author device, and identity reference. Any future format requires an explicit version and a new allow-listed parser; unknown versions fail closed.

## Data model constraints

Each device entry contains only its opaque ID, public identity/fingerprint, algorithm/version, lifecycle state, bounded timestamps, epoch, and optional label. Private identity keys, session/vault state, recovery secrets, message content, attachment keys, and media keys are never canonicalized or committed.

## Security reasoning

Deterministic bytes prevent two clients from accepting different lists under the same update and make rollback/epoch commitments comparable. Explicit omission, integer, Unicode, and ordering rules prevent parser differentials. SHA-256 provides mutation detection and a stable commitment; authenticity still comes from the authenticated `CryptoSession` and verified author identity.

### Threats prevented

- cross-platform commitment disagreement;
- field reordering and duplicate-key ambiguity;
- Unicode/number normalization attacks;
- list rollback and same-epoch divergent representations;
- QR/fingerprint substitution based on private or secret data.

### Test requirements

- identical canonical bytes and digest for published vectors on every supported runtime;
- reordered objects and entries canonicalize identically only when semantically allowed by the schema;
- duplicate keys/IDs, unknown fields, invalid Unicode, floats, negative values, and omitted-vs-null substitutions fail;
- changed fields produce a different digest and fail authenticated control verification;
- QR payload contains only allow-listed public fields and rejects expiry/nonce mismatch;
- version mismatch fails closed with no downgrade.

## Published vector requirement

Before implementation merges, the repository must contain at least two normative vectors: an initial list and an add/revoke transition, including exact canonical UTF-8 bytes, SHA-256 digest, displayed fingerprint, and expected parsed object. These vectors are acceptance evidence, not runtime-generated fixtures.
