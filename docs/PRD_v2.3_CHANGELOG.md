# PAYSIM PRD v2.3.0 — Changelog

**Date:** 3 November 2026
**Document Status:** Normative Product Specification Baseline
**Classification:** Product Specification Update (Phase 02.1 Architecture Hardening)
**Supersedes:** PRD v2.2.0 (`docs/PRD.md`)

---

## Purpose

Version 2.3.0 represents the hardened, definitive product specification for the PAYSIM MVP. It incorporates the architectural and security remediations established during the Phase 02.1 architectural audit, formally resolves the residual contradiction in Section 21.1 regarding capability expiry, eliminates reliance on third-party cookies in cross-origin checkout iframes, establishes complete state-machine consistency matrices, and locks Razorpay compatibility boundaries.

---

## Summary of Changes

### 1. Dual-Authentication Scheme for Embedded Checkout Iframe
- **Replaced Cookie-Only Iframe Authentication:** In cross-origin contexts (e.g. parent on `http://127.0.0.1:3000`, iframe on `http://127.0.0.1:8787`), modern browsers drop or block `SameSite=Strict` and `SameSite=Lax` cookies on subrequests.
- **Added Ephemeral Session Access Token:** The initial capability exchange `POST /checkout/:sessionId/exchange` now issues an ephemeral `sessionAccessToken` in the response body.
- **In-Memory Bearer Transport:** The checkout iframe retains this access token in window process memory and sends `Authorization: Bearer <sessionAccessToken>` on all internal simulation API calls (`/checkout/:id/state`, `/checkout/:id/simulate`, etc.).
- **Cookie Fallback:** The server continues setting the path-scoped cookie (`SameSite=Lax`) solely as an optional fallback when developers open the checkout URL directly in a browser tab.

### 2. Idempotent Capability Exchange and Iframe Session Recovery
- **Session-Bound Bearer Capability:** Replaced the fragile "single-use destructive token" model with an unexpired session capability valid for the 15-minute lifetime of the session.
- **Idempotent Exchange:** Replaying the capability exchange with the same valid capability token returns the existing active session state and a valid `sessionAccessToken`.
- **Iframe Reload & Reopen Resilience:** Developers can reload their web application or close and reopen the checkout modal without causing `409 CHECKOUT_SESSION_ALREADY_CONSUMED` errors.
- **Terminal State Protection:** Exchange returns `409 PAYMENT_ALREADY_TERMINAL` if the payment attempt has already reached a terminal state (`captured`, `failed`, `cancelled`), or `410 CHECKOUT_SESSION_EXPIRED` if the 15-minute window has elapsed.

### 3. Resolution of Section 21.1 Contradiction on Checkout Expiry
- **Removed Stale v2.1 Phrasing:** Formally deleted the lingering sentence in Section 21.1 claiming that checkout expiry cancels `created` payments.
- **Aligned Normative Invariant:** Reaffirmed across all sections that **checkout capability expiration invalidates only the capability token, does not cancel the payment attempt, does not change order state, and emits zero domain events**.
- **Reissue Route Semantics:** A payment attempt in `created` state whose checkout session has expired can receive a new checkout session via `POST /api/v1/payments/:id/checkout-sessions` (or compatibility counterpart) with a new idempotency key, retaining the same payment ID.

### 4. Ephemeral Compatibility Secret Retention & Purging
- **Credential Version Pinning:** Every payment attempt created under compatibility mode records `compatibilityCredentialId` and `compatibilityCredentialVersion`.
- **Vault Retention Invariant:** When a compatibility key is rotated, the raw secret buffer in `CompatibilitySecretVault` is retained **only** while any payment attempt created under that version remains in a non-terminal state (`created`, `pending`, `authorized`).
- **Automated Memory Zeroization:** Once all payment attempts linked to that version reach terminal states, the raw secret buffer is zeroized and purged from memory.
- **Fail-Closed Verification:** If a callback signature is requested for an evicted secret version, the callback fails closed with `500 CREDENTIAL_VERSION_UNAVAILABLE` rather than falling back to an incorrect key.

### 5. Webhook Endpoint Delivery-Mode Snapshotting & Byte Preservation
- **Single Mode Per Endpoint:** Reaffirmed that an endpoint has exactly one mode: `native` or `compatibility`.
- **Immutable Delivery Snapshots:** Every `WebhookDelivery` snapshots the endpoint mode, serialized body bytes, and secret version at creation time.
- **Mode Mutation Isolation:** Patching an endpoint's mode increments `configVersion` and affects only future deliveries and Replay. Retries strictly preserve original mode, body bytes, and secret version.
- **No Dynamic Timestamps in Signed Body:** Clarified that the timestamp inside the webhook payload is strictly the canonical domain event timestamp; dynamic HTTP send timestamps are excluded from signed bodies to guarantee bit-for-bit identical HMAC signatures across retries.

### 6. Strict Loopback Networking & SSRF Hardening for Docker/WSL
- **Private IP Rejection:** Formally prohibited all RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) for webhook destinations.
- **Docker/WSL Port Forwarding:** Mandated that Docker containers publish ports to host loopback (`-p 127.0.0.1:PORT:PORT`). Private container bridge IPs are rejected with `422 WEBHOOK_URL_REJECTED`.

### 7. Explicit Razorpay Compatibility Matrix & Deferrals
- **Pattern-Level Orders & Checkout Compatibility:** Clarified that PAYSIM provides pattern-level compatibility for Orders API and Standard Checkout, not drop-in universal compatibility with official provider language SDKs.
- **Fail-Closed Unsupported Features:** Explicitly codified that Refunds, Transfers, Subscriptions, Invoices, Virtual Accounts, and Cards return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`.

---

## Verification & Status

- **Normative Document:** `docs/PRD_v2.3.md` is the authoritative specification baseline for PAYSIM.
- **Historical Archives:** `PRD.md` (v2.2.0 baseline), `PRD_v2.1_ARCHIVE.md`, `PRD_v2.0_ARCHIVE.md`, and `PRD_v1.0_ARCHIVE.md` remain immutable.
- **Implementation Status:** Authoritative normative specification for PAYSIM v1.0.0. Implementation and verification status for individual requirements is documented in [IMPLEMENTATION_TRACEABILITY.md](IMPLEMENTATION_TRACEABILITY.md).
