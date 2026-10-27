# Isolated Android compatibility finding — not deployed

Base: f868cd5d695d82b9980a4e5fd0816d024d05a31b.

Actual JNI Android tests against an isolated copy of this source rejected valid signed bootstrap events with createdAt only 1–4 ms ahead of the backend. Signatures were valid and events unexpired. Enrollment has the same zero-skew boundary. Existing signed device-proof requests already allow five seconds of skew.

This separate candidate applies that same bounded five-second tolerance to bootstrap, enrollment and signed lifecycle-event time validation. Expiry, maximum lifetime, signatures, epochs, ownership and nonce/replay checks remain unchanged. It changes no payload or schema. It is NOT a prerequisite for already enrolled Android identities and does not recover revoked/deleted authority.

Validation: 41 tests passed across four suites, including real disposable Mongo bootstrap boundaries, routing TTL/renewal/revocation/restart regressions, device trust and device-proof clock-skew tests. Backend TypeScript build and scoped ESLint passed.

The Android acceptance run against the unchanged deployed contracts uses an explicitly documented -1000 ms test-only lifecycle request clock offset. That workaround is confined to androidTest; production Android timestamps remain unchanged. Thus those successes do not claim the live backend's zero-skew defect is fixed.

No push, deployment, live database, credentials, or production configuration changes. Owner review is required before any integration or deployment. Rollback returns to the same strict-clock rejections; no data migration is involved.
