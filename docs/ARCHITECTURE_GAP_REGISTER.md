# PAYSIM — Architecture Gap Register (Phase 02.1)

**Document Version:** 1.0.0  
**Status:** Audit Complete — All Gaps Remediated in PRD v2.3.0 & Architecture Baseline  
**Date:** November 2026  
**Auditor:** Principal Software Architect, Security Architect, and Technical Reviewer  
**Classification:** Technical Risk & Architectural Gap Catalog  

---

## Executive Summary

This Architecture Gap Register documents all technical discrepancies, security vulnerabilities, edge-case ambiguities, and specification contradictions identified during the independent technical audit of PRD v2.2.0 and the Phase 02 Architecture baseline.

Every identified gap has been evaluated for architectural severity, root cause, security impact, normative resolution in PRD v2.3.0, and required verification criteria.

---

## Gap Summary Table

| Gap ID | Severity | Category | Title | Status |
|---|---|---|---|---|
| **GAP-01** | **CRITICAL** | Browser Security | Cross-Origin Embedded Iframe Authentication & SameSite Cookie Blocking | **RESOLVED in PRD v2.3** |
| **GAP-02** | **HIGH** | UX / State | Checkout Session Iframe Reload and Modal Reopen Failure | **RESOLVED in PRD v2.3** |
| **GAP-03** | **HIGH** | State Machine | Textual Contradiction in Section 21.1 Regarding Capability Expiry Cancellation | **RESOLVED in PRD v2.3** |
| **GAP-04** | **HIGH** | Secret Lifecycle | Compatibility Raw Key Secret Retention Scope during Callback Signing | **RESOLVED in PRD v2.3** |
| **GAP-05** | **MEDIUM** | Webhook Engine | Endpoint Mode Mutation Semantics on In-Flight and Historical Deliveries | **RESOLVED in PRD v2.3** |
| **GAP-06** | **MEDIUM** | Webhook Engine | Delivery Attempt Timestamps in Webhook Payload HMAC Verification | **RESOLVED in PRD v2.3** |
| **GAP-07** | **HIGH** | Network Security | Docker & WSL2 Private Bridge IP Exposure & SSRF Vulnerability | **RESOLVED in PRD v2.3** |
| **GAP-08** | **HIGH** | Idempotency | Token Leakage in Idempotency Snapshots & Capability Tombstone Retention | **RESOLVED in PRD v2.3** |
| **GAP-09** | **CRITICAL** | Security Boundary | Unvalidated Parent Origin & PostMessage Target Origin Exposure | **RESOLVED in PRD v2.3** |
| **GAP-10** | **MEDIUM** | Compatibility | Overstated Razorpay SDK Compatibility Boundaries & Feature Drift | **RESOLVED in PRD v2.3** |

---

## Detailed Gap Analysis & Remediations

### GAP-01: Cross-Origin Embedded Iframe Authentication & SameSite Cookie Blocking

* **Severity:** **CRITICAL (P0)**
* **Category:** Browser Security & Authentication
* **Affected Sections:** PRD v2.2.0 Sections 5.9, 12.6, 13.3; System Architecture Section 5.2, 12.2
* **Root Cause:**
  When a developer's application runs at `http://127.0.0.1:3000` and embeds PAYSIM's checkout iframe from `http://127.0.0.1:8787`, browsers treat the iframe as a **third-party, cross-site context** (different ports constitute different web origins).
  PRD v2.2.0 mandated an `HttpOnly, SameSite=Strict` cookie for iframe session authentication. Modern browsers (Chromium, Firefox, Safari) strictly refuse to attach `SameSite=Strict` (and in many configurations, `SameSite=Lax`) cookies to requests originating from or within a third-party embedded iframe. This causes subsequent fetch calls made by the iframe to PAYSIM API (`/checkout/:id/simulate`, etc.) to fail with `401 UNAUTHORIZED`.
* **Security & Operational Impact:**
  The checkout iframe fails to authenticate in standard cross-origin local development environments, breaking simulated payments.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. The one-time capability token exchange route `POST /checkout/:sessionId/exchange` now issues an ephemeral `sessionAccessToken` in the JSON response body.
  2. The iframe JavaScript retains this token purely in process window memory (never in `localStorage` or `sessionStorage`).
  3. All iframe API calls send `Authorization: Bearer <sessionAccessToken>`.
  4. The server also sets the path-scoped cookie (`SameSite=Lax`) solely as an optional fallback for developers who open the checkout URL directly in a browser tab.
  5. The iframe no longer relies on third-party cookies for internal simulation API communication.
* **Verification Criterion:**
  V23-01: An embedded iframe on origin A (`127.0.0.1:3000`) successfully authenticates to PAYSIM on origin B (`127.0.0.1:8787`) using `Bearer <sessionAccessToken>` without sending third-party cookies.

---

### GAP-02: Checkout Session Iframe Reload and Modal Reopen Failure

* **Severity:** **HIGH (P0)**
* **Category:** Lifecycle & UX State Management
* **Affected Sections:** PRD v2.2.0 Sections 5.9, 5.11, 10.6, 13.3
* **Root Cause:**
  PRD v2.2.0 stated that capability tokens are "single-use: consumed once and cannot be used again". If the developer modal is dismissed and reopened, or if the developer's React app re-renders and recreates the `<iframe>` DOM element with the original `checkout_url#token`, the exchange route rejected the request with `409 CHECKOUT_SESSION_ALREADY_CONSUMED`.
* **Security & Operational Impact:**
  Developers cannot refresh their application or close and reopen the checkout modal within the 15-minute window without the payment flow crashing.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. The capability token is defined as a **session-bound bearer capability** valid for the entire 15-minute lifetime of the checkout session or until payment reaches a terminal state.
  2. The exchange endpoint `POST /checkout/:sessionId/exchange` is **idempotent**: re-submitting the same valid capability token for an unexpired, non-terminal payment attempt re-issues a valid `sessionAccessToken`.
  3. Re-exchange does not create a new payment attempt or emit any domain events.
  4. If the payment attempt has reached a terminal state (`captured`, `failed`, `cancelled`), exchange returns `409 PAYMENT_ALREADY_TERMINAL`.
  5. If the 15-minute session expired, exchange returns `410 CHECKOUT_SESSION_EXPIRED`.
* **Verification Criterion:**
  V23-02: Reloading or recreating an embedded checkout iframe with the same valid capability token succeeds idempotently while the payment remains non-terminal and unexpired.

---

### GAP-03: Textual Contradiction in Section 21.1 Regarding Capability Expiry Cancellation

* **Severity:** **HIGH (P0)**
* **Category:** Domain State Machine Invariants
* **Affected Sections:** PRD v2.2.0 Section 21.1 (Line 2374) vs Sections 5.11, 7.5, 8.4, 8.5, 10.3, 10.8, 13.3, 17, and Resolution Register V22-08
* **Root Cause:**
  Section 21.1 in PRD v2.2.0 retained an unremoved sentence from the v2.1 archive: *"Checkout expiry while payment is `created` atomically cancels and emits one `payment.cancelled`"*. This directly contradicted the locked normative decision across all other sections stating that **capability expiry invalidates the capability only, does not cancel the payment attempt, and emits no events**.
* **Security & Operational Impact:**
  Ambiguity for test implementers; risks creating conflicting state-machine logic where payments are prematurely terminated.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. Section 21.1 in PRD v2.3.0 is formally corrected: the contradictory sentence is eliminated.
  2. Unit and contract test requirements explicitly mandate that **capability expiration leaves `created` payments in `created` state** and emits **zero domain events**.
  3. Reissue semantics are reaffirmed: `POST /api/v1/payments/:id/checkout-sessions` issues a new checkout session referencing the same payment ID.
* **Verification Criterion:**
  V23-03: Triggering checkout capability expiration updates session status to `expired`, purges token vault, leaves payment in `created` state, and produces zero records in `EventRepository`.

---

### GAP-04: Compatibility Raw Key Secret Retention Scope during Callback Signing

* **Severity:** **HIGH (P0)**
* **Category:** Cryptographic Secret Management
* **Affected Sections:** PRD v2.2.0 Sections 5.5, 13.2, 18.3; System Architecture Section 18.2
* **Root Cause:**
  When a compatibility credential is rotated, the old key secret must be retained to compute synthetic callback HMACs for in-flight attempts. PRD v2.2.0 did not clearly define what happens if an attempt's checkout session expires while the payment remains `created`, or if an attempt remains in `pending` across multiple key rotations.
* **Security & Operational Impact:**
  Premature secret purging causes subsequent callback signing to fail with unhandled errors; excessive retention causes memory leaks of raw cryptographic buffers.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. Every payment attempt created in compatibility mode records `compatibilityCredentialId` and `compatibilityCredentialVersion`.
  2. The raw secret in `CompatibilitySecretVault` is retained if and only if:
     $\exists \text{ PaymentAttempt } P \text{ where } P.\text{status} \in \{\text{created, pending, authorized}\} \land P.\text{compatKeyVersion} == V$.
  3. Session expiration alone **does not** purge the secret if the payment attempt remains non-terminal.
  4. Once all payment attempts linked to version $V$ transition to terminal states (`captured`, `failed`, `cancelled`), version $V$'s buffer is zeroized and evicted.
  5. If a callback signature is requested for a purged version, PAYSIM returns `500 CREDENTIAL_VERSION_UNAVAILABLE` without falling back to a newer key.
* **Verification Criterion:**
  V23-04: Rotate compatibility key twice while an attempt remains `created`. Verify that callback HMAC signing for the attempt succeeds using the original pinned secret version until terminal capture.

---

### GAP-05: Webhook Endpoint Mode Mutation Semantics on In-Flight and Historical Deliveries

* **Severity:** **MEDIUM (P1)**
* **Category:** Webhook Delivery Subsystem
* **Affected Sections:** PRD v2.2.0 Sections 5.8, 7.9, 11.4, 13.5, 13.6
* **Root Cause:**
  PRD v2.2.0 allowed an endpoint's `mode` (`native` vs `compatibility`) to be patched via `PATCH /control/v1/webhook-endpoints/:id`. However, the behavior of queued, in-flight, or retried deliveries created prior to the mode change was not explicitly codified in data models.
* **Security & Operational Impact:**
  A mode change could cause an in-flight retry to accidentally switch wire formats or signature headers mid-attempt, corrupting receiver verification.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. `WebhookDelivery` snapshot explicitly includes `mode: WebhookMode`.
  2. The serializer generates the exact body bytes at delivery creation time and binds them to `bodySnapshotRef`.
  3. Mode mutations on the endpoint update `endpoint.mode` and increment `endpoint.configVersion`.
  4. All retries (automatic or manual) strictly execute using `delivery.mode` and `delivery.bodySnapshotRef`.
  5. Only explicit **Replay** adopts the endpoint's current `mode`.
* **Verification Criterion:**
  V23-05: Create native delivery; mutate endpoint to compatibility mode; execute manual retry. Verify retry sends Native body and `X-PaySim-Signature`.

---

### GAP-06: Delivery Attempt Timestamps in Webhook Payload HMAC Verification

* **Severity:** **MEDIUM (P1)**
* **Category:** Cryptographic Verification & Webhooks
* **Affected Sections:** PRD v2.2.0 Sections 11.2, 11.3, 11.4, 11.8, 11.9
* **Root Cause:**
  Lack of explicit prohibition on injecting dynamic HTTP send timestamps (e.g. `sent_at`, `attempt_timestamp`) into the signed JSON payload during retries.
* **Security & Operational Impact:**
  If an implementation modifies any payload field on retry, receiver signature verification breaks unless the receiver re-hashes against altered bytes.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. The signed body is 100% frozen at delivery creation.
  2. The timestamp inside the payload (`createdAt` in native, `created_at` in compatibility) is the **canonical domain event creation timestamp**.
  3. No delivery attempt timestamp is ever injected into the signed payload.
  4. Network timing is exposed strictly via outer HTTP transport headers (`Date`) and internal `WebhookDeliveryAttempt` metadata records.
* **Verification Criterion:**
  V23-06: Verify that SHA-256 body digest and HMAC signature on Attempt 1 and Attempt 3 of a retried delivery are bit-for-bit identical.

---

### GAP-07: Docker & WSL2 Private Bridge IP Exposure & SSRF Vulnerability

* **Severity:** **HIGH (P0)**
* **Category:** Network Security & SSRF Defense
* **Affected Sections:** PRD v2.2.0 Sections 5.7, 12.1, 12.4
* **Root Cause:**
  Developers using Docker or WSL2 often attempt to point PAYSIM webhooks to container bridge IPs (`172.17.0.2`, `172.28.x.x`). Allowing private subnet ranges creates an SSRF attack vector where malicious configurations scan developer LANs or internal containers.
* **Security & Operational Impact:**
  Breach of PAYSIM's local-only threat model; enables local network probing.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. PAYSIM strictly rejects all RFC 1918 private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  2. Only literal `127.0.0.1` and `[::1]` with explicit ports are accepted.
  3. Docker containers must publish ports to the host (`-p 127.0.0.1:PORT:PORT`).
  4. WSL2 applications must bind to Windows loopback forwarding or use portproxy.
  5. The UI and documentation provide copy-ready commands and display descriptive validation errors when non-loopback IPs are submitted.
* **Verification Criterion:**
  V23-07: Attempt to create webhook endpoint pointing to `http://172.17.0.2:3000/webhook`. Verify immediate rejection with `422 WEBHOOK_URL_REJECTED`.

---

### GAP-08: Token Leakage in Idempotency Snapshots & Capability Tombstone Retention

* **Severity:** **HIGH (P0)**
* **Category:** Idempotency & Secret Confinement
* **Affected Sections:** PRD v2.2.0 Sections 10.6, 13.8, 14
* **Root Cause:**
  When a payment attempt or checkout session is created, the response includes an opaque capability token in the URL. If the raw response is cached in the idempotency store, replaying the idempotency key after token consumption or expiration could leak an invalid or reusable token.
* **Security & Operational Impact:**
  Token leakage across time boundaries; replay confusion.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. Idempotency store caches strictly **token-free metadata snapshots**.
  2. Replaying an idempotency key while capability is valid reconstructs the checkout URL dynamically from `TokenVault`.
  3. Replaying after token consumption returns `409 CHECKOUT_SESSION_ALREADY_CONSUMED`.
  4. Replaying after session expiry returns `410 CHECKOUT_SESSION_EXPIRED` with the existing `payment_id`.
  5. Expired checkout session records are retained as lightweight token-free tombstones until linked idempotency records expire.
* **Verification Criterion:**
  V23-08: Idempotent replay of checkout session creation key returns 409 after consumption and 410 after expiry, without ever exposing capability tokens.

---

### GAP-09: Unvalidated Parent Origin & PostMessage Target Origin Exposure

* **Severity:** **CRITICAL (P0)**
* **Category:** Browser Sandbox & Cross-Window Security
* **Affected Sections:** PRD v2.2.0 Sections 5.9, 12.6, 21.9 (V22-11, V22-12)
* **Root Cause:**
  If the parent application origin is not strictly validated, malicious websites running on another local port could frame the PAYSIM checkout and intercept synthetic payment details or clickjack the simulator.
* **Security & Operational Impact:**
  Cross-origin data leakage and unauthorized payment triggering.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. `parentOrigin` is mandatory during checkout session creation.
  2. Validated against literal loopback format: `http://127.0.0.1:<port>` or `http://[::1]:<port>`.
  3. Checkout iframe response sets dynamic CSP: `Content-Security-Policy: frame-ancestors 'self' <parentOrigin>;`.
  4. `postMessage` calls from parent and iframe strictly require exact `targetOrigin`; wildcard `*` is banned in lint and build rules.
  5. Cryptographic per-session nonce validated on all handshake messages.
* **Verification Criterion:**
  V23-09: Embed checkout iframe in unauthorized origin (`http://127.0.0.1:4000` when `3000` was registered). Verify browser blocks framing via CSP `frame-ancestors`.

---

### GAP-10: Overstated Razorpay SDK Compatibility Boundaries & Feature Drift

* **Severity:** **MEDIUM (P1)**
* **Category:** Integration Clarity & Contract Scope
* **Affected Sections:** PRD v2.2.0 Sections 5.2, 9.2, 9.3, 9.4, 9.8
* **Root Cause:**
  Vague marketing claims in early drafts could lead developers to assume drop-in compatibility with official Razorpay Python, Java, or PHP SDKs that hardcode `https://api.razorpay.com`.
* **Security & Operational Impact:**
  Developer frustration and integration bugs when official SDKs fail to connect to local PAYSIM instances.
* **Normative Remediation (PRD v2.3.0 & Architecture):**
  1. PRD v2.3 explicitly declares compatibility as **pattern-level compatibility for Orders API and Standard Checkout**, NOT binary SDK drop-in.
  2. Developers must configure custom `baseURL` or use the PAYSIM bridge.
  3. Explicit matrix documents that Refunds, Subscriptions, Invoices, and Transfers return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`.
  4. The checkout constructor explicitly requires the PAYSIM `checkout_url` extension.
* **Verification Criterion:**
  V23-10: Call unsupported route `POST /compat/razorpay/v1/refunds`. Verify deterministic `501` response with descriptive compatibility envelope.

---

## Conclusion

All 10 identified architectural gaps are formally resolved and incorporated into **PRD v2.3.0** and the **Final Architecture Audit Specification**. Zero open P0 architectural gaps remain.
