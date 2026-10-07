# Web file and call usability pass 2

## File failure and boundaries

The verified browser path previously failed at backend attachment authorization. The shared fingerprint encoder used `window.btoa`; Node has no `window`. The exception was caught as an authorization rejection (403), and the Web adapter reduced it to an unclassified file failure. Standard `globalThis.btoa/atob` produce identical encoding and fingerprint bytes in Node and browsers. No primitive, pin, V2 binding or verification authority changes.

Per-chunk authority checks also use the pre-key lookup route. Its existing control admission limiter can reject a burst with 429. Both HTTP limiters now advertise their existing refill interval as `Retry-After`, exposed to allowed browser origins. The client retries only explicit 429 admission rejections, at most three times, respecting cancellation and delays of one to five seconds. Storage quotas, uncertain writes, 403, 409 and 503 are not automatically retried. File-session retry still queries server truth and reuses sealed cache objects; it never re-encrypts an already-produced object whose cache was lost. Limits remain 8 MiB per file and the existing per-account stored-byte/incomplete quotas. Large transfers can take longer because all identity checks and rate limits remain enforced.

Diagnostics use fixed stage codes for preflight, allocation, manifest upload, chunk upload, finalize, protected reference publication, recipient fetch, download, authentication and local output. Distinct fixed codes cover authorization rejection, conflict, expiry, cancellation, quota and rate admission. Logs contain only event and reason code. No raw exception, transfer identifier, filename, path, key, fingerprint, token, ciphertext or media is logged.

A new file workspace is idle, not a fictional interrupted transfer. Web workspace state resets on conversation change, downloads are projected only onto their matching file reference, and download progress does not replace composer upload state. Keys remain process-only, disk cache remains sealed, and unmount cancels and disposes the workflow. An interrupted transfer really requiring restart asks for the original file without claiming the app closed. Photo size is checked before starting, with a specific over-8-MiB message. Downloaded PNG/JPEG/WebP/GIF can preview locally after authenticated decryption; SVG and arbitrary file types do not become inline image content.

## Calls and local history

The Calls page previously treated every lifecycle label except `idle` as active. Terminal labels (`ended`, `cancelled`, failure, etc.) remained useful status copy, but incorrectly disabled future calls. The page now uses the same current-call active state as the call overlay, plus its short-lived launch promise. Terminal notifications clear the active call reference; a late terminal notification for a different call cannot clear a newer call.

Timeline entries are **local observations on one device**, stored in the existing encrypted local conversation history. They are not synchronized to the peer and are not server call records. Entries identify voice/video, missed incoming attempts, declined, canceled outgoing and failed calls. The locally connected interval is measured with a monotonic clock; a completed connected call includes its observed duration. A known local setup failure remains a failed entry even if cleanup uses an end signal. Duplicate terminal notifications produce one local entry. No message receipt or peer-viewing claim is implied.

Recorded entries survive normal reload/unlock. Abrupt closure before terminal persistence can leave an active attempt without a final entry. No reconstruction or cross-device synchronization is promised. Call signaling and authenticated control payloads are unchanged.

## Validation scope

The Playwright journeys run two independent Chromium storage contexts against the actual Web UI, real authenticated backend routes, and disposable Mongo. File downloads are saved and compared byte-for-byte by SHA-256. Call tests use browser synthetic microphone/camera devices and real WebRTC; they do not establish physical microphone quality or Android interoperability. Existing security regressions cover unverified, changed and missing authority rejection. The real Mongo file-ledger tests include database restart, atomic quotas, incomplete-finalization rejection and index safety.

## Future optimized-photo path

A future opt-in local path would decode the selected image under pixel/memory bounds, honor orientation, resize to a bounded resolution, strip metadata, and encode JPEG/WebP at bounded quality until under 8 MiB. Display the resulting size and require confirmation. Only then allocate a fresh transfer and encrypt the new bytes. Preserve original-file sending as a separate explicit choice. Never reuse a transfer's key/nonce for different plaintext. No server plaintext processing is needed. This pass does not implement compression or increase limits.

## Results (2026-10-07)

- Two-browser PDF, PNG, 1 MiB and 8 MiB minus 1 KiB transfers passed in both directions; saved bytes matched. The near-limit bidirectional case took 9.7 minutes under unchanged admission limits.
- Retry after injected storage failure reused the exact sealed chunk. Cancellation, a subsequent transfer, oversize photo copy and reload state passed.
- Both-direction voice/video calls, local/remote hangup, rejection, cancellation, permission-denied setup, immediate subsequent calls and local timeline persistence passed. Browser synthetic media does not establish physical audio quality.
- Focused regressions: 39 suites, 186 tests passed; one suite/two tests skipped. Full Jest: 139 suites, 732 tests passed; four suites/nine tests skipped.
- Disposable real-Mongo lifecycle integration: two tests passed, including restart. Client production build, service SDK build, backend TypeScript compilation, lint and whitespace checks passed. Vite retains its bundle-size warning.
- Deployment completion and physical/native Android interoperability are not established by these local tests.
