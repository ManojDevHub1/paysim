# PAYSIM PRD v2.2.0 — Changelog

**Date:** 3 November 2026  
**Status:** Normative product specification; implementation and runtime tests have not been performed.

## Purpose

Version 2.2.0 closes the follow-up audit gaps discovered after PRD v2.1.0. It preserves the previous documents as immutable archives and makes v2.2.0 the sole normative specification.

## Changes

### 1. Dashboard control session
- Added a complete one-time control-token exchange request/response contract.
- Defined token consumption, no-store response behavior, HttpOnly/SameSite cookie, CSRF issuance, expiry, and login rate limits.

### 2. Compatibility checkout-session lifecycle
- Added `POST /compat/razorpay/v1/orders/:orderId/checkout-sessions` as a clearly labeled PAYSIM-specific extension.
- Defined server-side Basic authentication, order-ownership validation, idempotency, attempt/session atomicity, and exact response shape.
- Added required `checkout_url` constructor option; browser never receives `key_secret`.
- Defined the `parent_origin` binding, same-origin checkout iframe, and exact-origin `postMessage` handshake.

### 3. Compatibility credential rotation
- Clarified that the old compatibility key version is rejected for new authenticated requests immediately after rotation.
- Retained its raw signing secret only in ephemeral memory while a linked non-terminal payment attempt may still require a synthetic callback signature.
- Purge occurs after linked attempts are terminal and linked checkout sessions are no longer usable.

### 4. Checkout capability expiry
- Expiry now invalidates only the checkout capability.
- Expiry does not cancel a payment attempt, change order state, or emit a payment event.
- A `created` payment can receive a new checkout session without creating a second payment attempt or a duplicate `payment.created` event.
- Added deterministic `410 CHECKOUT_SESSION_EXPIRED` and `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` semantics.

### 5. Webhook endpoint modes and payloads
- Made `native` or `compatibility` mode a required endpoint setting.
- Added mode to endpoint update behavior and delivery snapshots.
- Canonical events remain mode-neutral; each delivery serializes a deterministic mode-specific body.
- Retry reuses exact delivery bytes; Replay creates a new body for the selected endpoint's current mode.
- Added committed native and compatibility captured-payment JSON fixtures.

### 6. Data, API, and acceptance-test contracts
- Added internal `ownerCredentialId` to orders to enforce compatibility order ownership without exposing internal ownership data.
- Expanded v2.2 contract regression tests for control authentication, credential rotation, checkout reissue, webhook mode changes, byte-preserving retry, replay, and origin validation.
- Updated repository structure and document cross-references.

## Compatibility and migration notes

- v2.2.0 is a specification revision, not an implemented software release.
- API route and payload contracts described as PAYSIM extensions are not asserted to be official provider contracts.
- The checkout capability expiry behavior intentionally differs from v2.1.0: payment state is preserved when the checkout capability expires.
- Implementers must use `PRD.md` as the normative source and must not combine archived v2.0/v2.1 requirements with v2.2 requirements.

## Validation

- Markdown/section consistency checks: run during document generation.
- JSON syntax validation: run against both committed webhook fixtures.
- Application builds, unit tests, integration tests, browser tests, and security tests: **not run; no application implementation is included in this documentation update**.

### 7. Follow-up consistency closure
- Removed the remaining stale payment-cancellation-on-session-expiry rows from the state machine and payment rules.
- Defined compatibility checkout-session reissue for an existing payment attempt and the active-session predicate.
- Bound compatibility credential versions to payment attempts so callback-signing secret retention is traceable.
- Added exact compact byte fixtures, deterministic JavaScript key-order definition, and a `410` entry in the HTTP status table.
- Made the PAYSIM `paysim.strictOptions` constructor extension explicit and aligned manual Retry eligibility across API, UI, and webhook semantics.

### 8. Checkout continuation and session idempotency
- Defined one-time capability exchange into a path-scoped HttpOnly, SameSite=Strict checkout-session cookie; the checkout session remains valid until expiry/revocation even after token consumption.
- Documented that the parent page can inspect the `checkout_url` capability passed to the shim; the token is not hidden from page JavaScript, but it is not forwarded in callbacks, `postMessage`, storage, referrers, or logs.
- Extended idempotency to checkout-session creation and reissue, added checkout-session resource references/tombstones, and distinguished consumed-capability (`409`) from expired/revoked capability (`410`).
- Added a Compatibility payment-level checkout-session reissue route and made reissue require a new idempotency key.


### 9. Contract traceability closure
- Expanded the Resolution Register to map every v2.2 regression test ID (`V22-01` through `V22-22`) to its normative requirements and verification scenario.
- Expanded the Validation Report to record checkout/session, credential, webhook-mode, deterministic serializer, event-ordering, retry/replay, idempotency-retention, fixture-byte, archive, and ZIP-integrity checks.
- Kept static documentation/fixture checks separate from application test claims; no code build or runtime test is represented as completed.
