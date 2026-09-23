# Protocol fixture rules

These are synthetic, versioned cross-platform contract fixtures. They contain no production credentials, account pickles, private identity keys, plaintext user content, or real ciphertext.

Every TypeScript, Rust, backend, and Kotlin compatibility suite must consume these same files. A fixture's `accepted` case must succeed; every named negative case must fail closed. The initial Phase 9.1 set freezes encoding, fingerprint, canonical control-event, proof, envelope schema, and attachment AAD contracts. Deterministic Vodozemac account/session vectors remain required before cross-device Olm compatibility can be marked complete.
