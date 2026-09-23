# Phase 8L-8 Offline Crypto Fix Report

## Browser execution

The Mongo-backed Chromium offline replay scenario was run with `K3NCRYPT_TEST_ONLY_DIAGNOSTICS=true`. The recipient reconnects and receives the retained envelope, but the message remains rejected by inbound Vodozemac processing and is not displayed.

## Diagnostic result

No pre-key mismatch was proven. The environment variable alone does not inject the guarded `__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__` browser-global flag or collect the active restored account snapshot. The new test-only adapter hook is therefore not reached by the existing Playwright harness.

## Classification

The failure remains unclassified between the requested key-state categories because the active browser account's public derived key identifiers were not captured. There is no evidence for a missing selected key, a consumed key, or an identity mismatch.

## No production fix applied

No encryption, Vodozemac validation, pre-key publication, session creation, trust check, or mailbox behavior was changed. Implementing any of the possible fixes without the missing comparison would be speculative and could weaken the fail-closed boundary.

## Required next step

Extend the Playwright harness to inject the guarded browser-global flag before conversation construction and retrieve a test-only public snapshot from the active `ModernConversation` runtime. Compare derived identifiers from that snapshot with the server bundle's selected key identifier at the rejected inbound call. Only then can a minimal, evidence-based correction be selected.

## Status

The permanent offline-replay regression remains failing. Android work must remain blocked.
