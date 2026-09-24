# Protocol fixture rules

These are synthetic, versioned cross-platform contract fixtures. They contain no production credentials, account pickles, private identity keys, plaintext user content, or real ciphertext.

Every TypeScript, Rust, backend, and Kotlin compatibility suite must consume these same files. A fixture's `accepted` case must succeed; every named negative case must fail closed. The initial Phase 9.1 set freezes encoding, identity fingerprints, bootstrap/enrollment/activation signatures, proof-request canonical bytes, envelope schema, and attachment AAD contracts. Deterministic Olm interoperability remains a Rust/Vodozemac boundary test; device/emulator E2E vectors are still required before cross-device Android messaging is fully verified.
