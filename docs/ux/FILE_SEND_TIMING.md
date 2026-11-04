# 1.5 MB file send: where the time goes (Part A2, 2026-11-04)

Owner report: a 1.5 MB send took 10–11 s on production.

Measured with the opt-in spec `e2e/file-timing.spec.ts` (`K3NCRYPT_FILE_TIMING=true`, `K3NCRYPT_FILE_TIMING_SIZES=1572864`): local stack, Chromium network emulation with 110 ms latency (the production round trip from this Mac), 10 Mbit/s up. [local browser run]

Sender, file selected to "sent": **5.0 s**, 23 requests, all one after another:

| Step | Requests | Time |
|---|---|---|
| Device proof before each attachment request (one per request, single-use) | 11 | 1.29 s |
| Chunk uploads (6 × 256 KiB) | 6 | 2.13 s |
| Contact bundle lookups (identity check before create, at start, before publish) | 3 | 0.35 s |
| create, status, complete | 3 | 0.36 s |
| Encryption and local work | | ~0.9 s |

Each chunk costs one proof round trip plus its upload, so a chunk is ~0.5 s at this latency.

What the rest of 10–11 s most likely is: upload bandwidth. 1.5 MB is 12 Mbit, which is 6 s at 2 Mbit/s or 1.2 s at 10 Mbit/s, on top of the round trips. A free Render instance adds server time per request. Not measured on production (that would need a real account there).

Changes and options:
- **Done:** upload progress now follows bytes sent (XMLHttpRequest `upload.onprogress` per chunk), not one step per chunk.
- **Done (Calls milestone, 2026-11-04):** the device proof for the next request is fetched while the current chunk uploads (`client/src/media/prefetchedHeaders.ts`). Proofs stay single-use; one older than 20 s is dropped. Same conditions, 2 runs each: **5.04–5.06 s before, 4.03–4.08 s after** (≈1.0 s saved for 1.5 MB).
- **Option (not done):** drop the third contact bundle lookup before publish when the first one is under a few seconds old (≈0.1 s).
