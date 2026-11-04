# PAYSIM v1.0.0 — Implementation Traceability Document

**Document Version:** 1.0.0
**Date:** 4 November 2026
**Status:** Released & Certified Baseline
**Authoritative Normative PRD:** [`docs/PRD_v2.3.md`](PRD_v2.3.md)
**Historical Predecessor:** [`docs/PRD_v2.3_RESOLUTION_REGISTER.md`](PRD_v2.3_RESOLUTION_REGISTER.md)
**Verified Test Baseline:** 546 tests passing across 49 test files (Vitest)
**System Doctor Diagnostics:** 8/8 checks passing

---

## 1. Purpose & Scope

This document provides requirement-by-requirement implementation traceability between the authoritative product specification (**[PRD v2.3.0](PRD_v2.3.md)**) and the concrete codebase released in **PAYSIM v1.0.0**.

In accordance with strict release engineering standards, a passing automated test suite is **not** conflated with universal requirement completion. Every functional requirement, compatibility contract, and architecture constraint is classified into one of four unambiguous categories:

1. **Implemented & Verified**: Fully implemented in `apps/` or `packages/` and covered by passing automated unit, integration, or E2E tests with explicit test names.
2. **Partially Implemented / Partially Verified**: Working functionality exists in v1.0.0 with documented caveats, client-only boundaries, browser-only verification (CDP journeys), or known contract code discrepancies.
3. **Not Implemented / Not Verified / Specification Conflict**: Requirements where implementation is absent, dedicated automated verification test cases are missing, or a structural conflict exists between normative PRD specifications and public schema contracts.
4. **Deferred Beyond v1.0.0**: Explicit post-MVP features formally scheduled for Phase 04 or Phase 05.

---

## 2. Requirement Traceability Matrix

### 2.1 Setup & Control Plane (`SET-*`)

| Req ID | Requirement Summary | PRD v2.3 Ref | Classification | Implementation Source | Test Verification (File & Test Case) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **SET-01** | One-command local startup without external services | § 7.1 | **Implemented & Verified** | `scripts/dev.mjs`, `scripts/start.mjs` | `tests/dev-startup.test.ts` :: `detects port collisions and exits gracefully with non-zero code`<br>`tests/smoke.test.ts` :: `verifies all workspace packages build and test clean` |
| **SET-02** | Ephemeral control token printed once to stdout | § 5.5, 7.1 | **Implemented & Verified** | `apps/server/src/application/services/control.service.ts`, `apps/server/src/index.ts` | `apps/server/tests/application/control-use-cases.test.ts` :: `exchanges one-time bootstrap token and issues session cookie and CSRF token` |
| **SET-03** | Atomic consumption of control token via `POST /control/v1/session/exchange` | § 5.10, 7.1 | **Implemented & Verified** | `apps/server/src/routes/control.routes.ts`, `apps/server/src/application/services/control.service.ts` | `apps/server/tests/integration/control-api.test.ts` :: `enforces SET-03 single-use consumption of bootstrap token` |
| **SET-04** | CSRF & Origin validation on mutating control endpoints | § 5.10, 7.1 | **Implemented & Verified** | `apps/server/src/middleware/auth.middleware.ts`, `apps/server/src/middleware/cors.middleware.ts` | `apps/server/tests/integration/control-api.test.ts` :: `enforces SET-04 CSRF protection on mutating control endpoints` |
| **SET-05** | Prominent simulation disclosures in UI & API responses | § 1.3, 7.1 | **Implemented & Verified** | `apps/web/src/components/`, `packages/contracts/src/manifest.ts` | `apps/server/tests/route-manifest-and-security.test.ts` :: `verifies exact 1:1 match for all 30 normative routes + 1 non-normative alias (31 total)`<br>`apps/web/tests/domain-api-integration.test.ts` :: `control.api: retrieves safe credentials overview without secrets` |
| **SET-06** | In-memory volatility & reset explanation in first-run and Settings | § 5.4, 7.1 | **Partially Implemented (Browser-Only)** | `apps/web/src/views/SettingsView.tsx`, `apps/web/src/views/OverviewView.tsx` | Visual inspection & Chrome CDP browser verification (`scripts/verify-browser-journeys.mjs`); not asserted in automated Vitest suite. |
| **SET-07** | Strict loopback bind (`127.0.0.1`, `::1`); reject `0.0.0.0` | § 5.3, 7.1 | **Implemented & Verified** | `apps/server/src/config.ts`, `apps/server/src/app.ts` | `apps/server/tests/configuration-and-listener-security.test.ts` :: `rejects invalid host configurations (e.g. 0.0.0.0) at startup per SET-07`<br>`apps/server/tests/configuration-and-listener-security.test.ts` :: `verifies default server bind address is strict local loopback (127.0.0.1)` |
| **SET-08** | Fast-fail port collision detection with actionable remediation | § 5.3, 7.1 | **Implemented & Verified** | `scripts/dev.mjs`, `apps/server/src/index.ts` | `tests/dev-startup.test.ts` :: `detects port collisions and exits gracefully with non-zero code`<br>`scripts/doctor.mjs` (Check 3 & 4) |
| **SET-09** | Revoke dashboard sessions from Settings | § 7.1 | **Partially Implemented** | `apps/server/src/routes/control.routes.ts`, `apps/web/src/views/SettingsView.tsx` | `apps/server/tests/integration/control-api.test.ts` :: `logs out and revokes active control session`. Session cleared via `/logout`; multi-tab revocation registry is session-scoped. |

---

### 2.2 Orders Domain (`ORD-*`)

| Req ID | Requirement Summary | PRD v2.3 Ref | Classification | Implementation Source | Test Verification (File & Test Case) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **ORD-01** | Create mock order with prefixed ID (`ord_ps_...`) | § 7.2, 13.1 | **Implemented & Verified** | `packages/domain/src/orders/order.factory.ts`, `apps/server/src/application/services/order.service.ts` | `packages/domain/tests/orders.test.ts` :: `creates a valid initial MockOrder in created state with version 1`<br>`apps/server/tests/integration/native-api.test.ts` :: `creates an order with 201 Created and retrieves it` |
| **ORD-02** | Retrieve mock order with related payment attempts | § 7.2 | **Implemented & Verified** | `apps/server/src/application/services/order.service.ts` | `apps/server/tests/integration/native-api.test.ts` :: `creates an order with 201 Created and retrieves it` |
| **ORD-03** | List orders with pagination, limit, and status filter | § 7.2 | **Implemented & Verified** | `apps/server/src/application/services/order.service.ts`, `packages/contracts/src/pagination.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates PaginationQuerySchema with defaults and bounds`<br>`apps/server/tests/integration/native-api.test.ts` |
| **ORD-04** | Validate amount: integer between 1 and `100_000_000` paise; reject floats | § 5.11, 7.2 | **Implemented & Verified** | `packages/contracts/src/orders.ts`, `packages/domain/src/orders/order.factory.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates amount boundaries in INR paise`<br>`packages/domain/tests/orders.test.ts` :: `rejects non-integer amount paise`<br>`packages/domain/tests/orders.test.ts` :: `rejects amounts exceeding 100_000_000 paise cap (₹10,00,000)` |
| **ORD-05** | Validate currency: `INR` only | § 7.2 | **Implemented & Verified** | `packages/contracts/src/orders.ts`, `packages/domain/src/orders/order.factory.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates supported currencies and rejects unsupported ones`<br>`packages/domain/tests/orders.test.ts` :: `rejects unsupported currencies` |
| **ORD-06** | Optional receipt field (max 40 chars, non-unique) | § 7.2 | **Implemented & Verified** | `packages/contracts/src/orders.ts`, `packages/domain/src/orders/order.factory.ts` | `packages/domain/tests/orders.test.ts` :: `rejects oversized receipt and description fields` |
| **ORD-07** | Bounded metadata (max 8 KB JSON object, reserved key shielding) | § 7.2 | **Implemented & Verified** | `packages/contracts/src/orders.ts`, `packages/domain/src/orders/order.factory.ts` | `packages/domain/tests/orders.test.ts` :: `rejects oversized note keys and values`<br>`apps/server/tests/metadata-boundary.test.ts` |
| **ORD-08** | Enforce `simulated: true` and `livemode: false` markers | § 7.2 | **Implemented & Verified** | `packages/domain/src/orders/order.factory.ts`, `packages/contracts/src/orders.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates OrderEntity lifecycle and constraints` |
| **ORD-09** | Enforce idempotency on order creation (`Idempotency-Key`) | § 7.2, 10 | **Implemented & Verified** | `apps/server/src/application/services/order.service.ts`, `packages/storage-memory/src/idempotency.ts` | `apps/server/tests/integration/native-api.test.ts` :: `enforces 5-tuple idempotency on order creation` |
| **ORD-10** | Independent order and payment attempt lifecycles | § 7.2, 8.1 | **Implemented & Verified** | `packages/domain/src/orders/order.state-machine.ts`, `packages/domain/src/payments/payment.state-machine.ts` | `packages/domain/tests/orders.test.ts` :: `evaluates permitted and prohibited transitions correctly`<br>`packages/domain/tests/matrix.test.ts` :: `evaluates all 36 state transitions according to normative state machine rules` |
| **ORD-11** | Prevent new payment attempts after order is `paid` | § 7.2, 8.1 | **Implemented & Verified** | `packages/domain/src/payments/payment.simulation.ts` | `packages/domain/tests/simulation.test.ts` :: `rejects adding payment attempt to an already paid order`<br>`packages/domain/tests/simulation.test.ts` :: `rejects auto-capture if order is already paid` |
| **ORD-12** | Search orders by receipt or order ID | § 7.2 | **Partially Implemented** | `apps/web/src/views/OrdersView.tsx` | Dashboard UI supports real-time text search and status filtering; backend API `/api/v1/orders` exposes cursor pagination and status filters. |

---

### 2.3 Payments & Simulation Lab (`PAY-*`)

| Req ID | Requirement Summary | PRD v2.3 Ref | Classification | Implementation Source | Test Verification (File & Test Case) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **PAY-01** | Separate payment attempt entity with unique ID (`pay_ps_...`) | § 7.2, 13.1 | **Implemented & Verified** | `packages/domain/src/payments/payment.factory.ts`, `packages/contracts/src/payments.ts` | `packages/domain/tests/payments.test.ts` :: `creates a valid initial payment attempt in created state with version 1 and captured false` |
| **PAY-02** | Independent status progression across sequential attempts | § 7.2, 8.1 | **Implemented & Verified** | `packages/domain/src/payments/payment.state-machine.ts` | `packages/domain/tests/payments.test.ts` :: `evaluates permitted transitions from created`<br>`packages/domain/tests/matrix.test.ts` :: `permits creating a subsequent payment attempt after cancellation` |
| **PAY-03** | Exactly one active attempt permitted per order at a time | § 7.2, 8.1 | **Implemented & Verified** | `packages/domain/src/payments/payment.simulation.ts` | `packages/domain/tests/payments.test.ts` :: `enforces concurrency constraint: rejects new attempt when active attempt exists (409 ACTIVE_PAYMENT_ATTEMPT_EXISTS)` |
| **PAY-04** | Opaque capability token transport in URL fragment | § 5.9, 7.3 | **Implemented & Verified** | `apps/server/src/application/services/checkout.service.ts` | `apps/server/tests/application/checkout-use-cases.test.ts` :: `creates a Checkout Session, returns capability token, and stores only its SHA-256 hash in RootState` |
| **PAY-05** | Deterministic simulation outcomes (`success`, `pending`, `failed`, `cancelled`) | § 7.2, 8.2 | **Implemented & Verified** | `packages/domain/src/payments/payment.simulation.ts` | `packages/domain/tests/simulation.test.ts` :: `simulates outcome: success via auto-capture`<br>`packages/domain/tests/simulation.test.ts` :: `simulates outcome: pending`<br>`packages/domain/tests/simulation.test.ts` :: `simulates outcome: failed with standardized failure reason`<br>`packages/domain/tests/simulation.test.ts` :: `simulates outcome: cancelled` |
| **PAY-06** | Asynchronous resolution of `pending` payments | § 7.2, 8.2 | **Implemented & Verified** | `packages/domain/src/payments/payment.simulation.ts`, `apps/server/src/application/services/payment.service.ts` | `packages/domain/tests/simulation.test.ts` :: `resolves pending payment to success via auto-capture`<br>`packages/domain/tests/simulation.test.ts` :: `resolves pending payment to failed`<br>`packages/domain/tests/simulation.test.ts` :: `resolves pending payment to cancelled` |
| **PAY-07** | Idempotent payment attempt creation | § 7.2, 10 | **Implemented & Verified** | `apps/server/src/application/services/payment.service.ts`, `packages/storage-memory/src/idempotency.ts` | `apps/server/tests/integration/native-api.test.ts` :: `creates payment attempt, reissues checkout session, and simulates outcome` |
| **PAY-08** | Reject invalid outcome state transitions with typed 409 error | § 7.2, 8.2 | **Implemented & Verified** | `packages/domain/src/payments/payment.state-machine.ts` | `packages/domain/tests/matrix.test.ts` :: `evaluates all 36 state transitions according to normative state machine rules` |
| **PAY-09** | Monetary immutability (amount & currency copied from order) | § 7.2 | **Implemented & Verified** | `packages/domain/src/payments/payment.factory.ts` | `packages/domain/tests/payments.test.ts` :: `creates a valid initial payment attempt in created state with version 1 and captured false` |
| **PAY-10** | Terminal immutability (`captured`, `failed`, `cancelled` cannot transition) | § 8.1 | **Implemented & Verified** | `packages/domain/src/payments/payment.state-machine.ts` | `packages/domain/tests/matrix.test.ts` :: `enforces terminal payment immutability`<br>`packages/domain/tests/simulation.test.ts` :: `rejects simulation command on already-terminal payment` |
| **PAY-15** | Reissue checkout session for `created` attempts after capability expiry | § 5.11, 7.2 | **Implemented & Verified** | `apps/server/src/application/services/checkout.service.ts` | `apps/server/tests/integration/native-api.test.ts` :: `creates payment attempt, reissues checkout session, and simulates outcome` |

---

### 2.4 Checkout UI & Handshake (`CHK-*`)

| Req ID | Requirement Summary | PRD v2.3 Ref | Classification | Implementation Source | Test Verification (File & Test Case) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **CHK-01** | Self-contained local checkout dialog; zero remote CDN dependencies | § 7.3 | **Implemented & Verified** | `apps/web/src/views/CheckoutSimulatorView.tsx` | `apps/web/tests/domain-api-integration.test.ts` :: `checkout.api: reissues session, exchanges capability token, and rotates token` |
| **CHK-02** | Persistent simulation warning header in checkout modal | § 7.3 | **Partially Implemented (Browser-Only)** | `apps/web/src/views/CheckoutSimulatorView.tsx` | Simulation banner visually verified in embedded iframe UI and screenshot pipeline (`docs/screenshots/checkout_simulator.png`); not asserted in automated Vitest suite. |
| **CHK-11** | Non-payable, non-scannable simulated UPI QR placeholder with warning | § 7.3 | **Partially Implemented (Browser-Only)** | `apps/web/src/views/CheckoutSimulatorView.tsx` | SVG mock QR code rendered with prominent non-payable disclaimer; verified in manual/visual test runs, not asserted in automated Vitest suite. |
| **CHK-13** | Nonce-bound `postMessage` protocol with concrete `targetOrigin` | § 5.9, 7.3 | **Partially Implemented** | `apps/server/src/application/services/checkout.service.ts`, `apps/web/src/views/CheckoutSimulatorView.tsx` | Validates `targetOrigin` and `parentOrigin`; uses capability token authentication rather than a separate nonce parameter; verified in `apps/server/tests/application/checkout-use-cases.test.ts`. |
| **CHK-15** | Fragment-only capability token transport with immediate `replaceState` | § 5.9, 7.3 | **Partially Implemented (Browser-Only)** | `apps/server/src/application/services/checkout.service.ts`, `apps/web/src/views/CheckoutSimulatorView.tsx` | Token transport tested via server response; URL fragment removal via `replaceState` verified in Chrome CDP browser automation (`scripts/verify-browser-journeys.mjs`), not in Vitest. |
| **CHK-16** | Ephemeral `sessionAccessToken` issued on capability exchange for Bearer auth | § 5.9 | **Implemented & Verified** | `apps/server/src/routes/checkout.routes.ts`, `apps/server/src/application/services/checkout.service.ts` | `apps/server/tests/integration/checkout-api.test.ts` :: `exchanges capability token for iframe session credentials` |
| **CHK-17** | Idempotent capability exchange during active 15m session | § 5.9, 5.11 | **Partially Implemented** | `apps/server/src/application/services/checkout.service.ts` | Idempotent re-exchange code path is implemented in `checkout.service.ts` (`exchangeCapabilityToken`), but lacks a dedicated automated Vitest assertion specifically verifying modal reopen re-exchange. |

---

### 2.5 Webhook Subsystem (`WH-*`, `DEL-*`, `RPL-*`)

| Req ID | Requirement Summary | PRD v2.3 Ref | Classification | Implementation Source | Test Verification (File & Test Case) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **WH-00** | Explicit mode (`native` \| `compatibility`) required at endpoint creation | § 7.4, 11.1 | **Implemented & Verified** | `packages/contracts/src/endpoints.ts`, `apps/server/src/application/services/webhook.service.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates WebhookEndpoint creation and mode union`<br>`apps/server/tests/integration/webhook-api.test.ts` :: `registers a valid loopback webhook endpoint with one-time secret disclosure` |
| **WH-01** | Strict loopback confinement (`127.0.0.1`, `[::1]`, unprivileged ports 1024-65535) | § 5.7, 12 | **Implemented & Verified** | `packages/contracts/src/common.ts`, `apps/server/src/webhook-engine/dispatcher-security.ts` | `packages/contracts/tests/contracts.test.ts` :: `validates strict literal loopback URLs across all 11 security vectors`<br>`apps/server/tests/webhook-engine/network-security.test.ts` :: `strictly rejects RFC 1918 private LAN 172.16.0.0/12` |
| **DEL-01** | Outbound HTTP POST with immutable raw body bytes | § 7.4, 11 | **Implemented & Verified** | `apps/server/src/webhook-engine/http-dispatcher.ts` | `apps/server/tests/webhook-engine/http-dispatcher.test.ts` :: `delivers native webhook to 127.0.0.1 receiver with exact HMAC-SHA256 signature and headers` |
| **DEL-02** | Constant-time HMAC-SHA256 signature (`X-PaySim-Signature` / `X-Razorpay-Signature`) | § 7.4, 11.1 | **Implemented & Verified** | `packages/crypto/src/index.ts` | `packages/crypto/tests/crypto.test.ts` :: `computes expected HMAC-SHA256 digest`<br>`packages/crypto/tests/crypto.test.ts` :: `performs constant-time string and buffer comparisons`<br>`apps/server/tests/sample-receiver.test.ts` :: `receives and verifies authentic PAYSIM webhook deliveries` |
| **DEL-06** | Redirects strictly disabled (`redirect_rejected` outcome) | § 7.4, 12 | **Implemented & Verified** | `apps/server/src/webhook-engine/http-dispatcher.ts` | `apps/server/tests/webhook-engine/http-dispatcher.test.ts` :: `rejects 3xx redirects without following (strict no-follow policy)` |
| **DEL-07** | Bounded queue (100 jobs) and 5 concurrent workers pool | § 7.4, 14 | **Implemented & Verified** | `apps/server/src/webhook-engine/delivery-queue.ts`, `apps/server/src/webhook-engine/delivery-worker-pool.ts` | `apps/server/tests/webhook-engine/http-dispatcher.test.ts` :: `enforces maximum capacity of 100 waiting jobs and rejects overflow`<br>`apps/server/tests/webhook-engine/webhook-audit-phase03-6-1.test.ts` :: `enforces queue capacity bounds and worker concurrency limits` |
| **DEL-09** | Bounded automatic retries (Immediate, 500ms, 2000ms; max 3 auto) | § 7.4 | **Implemented & Verified** | `apps/server/src/webhook-engine/retry-policy.ts` | `apps/server/tests/webhook-engine/delivery-lifecycle-and-retry.test.ts` :: `executes full 3-attempt backoff schedule (immediate, 500ms, 2000ms) to exhausted status` |
| **DEL-10** | Manual retry budget enforcement (up to 3 manual retries, max 6 total) | § 5.8, 7.4 | **Implemented & Verified** | `apps/server/src/webhook-engine/retry-policy.ts` | `apps/server/tests/webhook-engine/phase03-6-5-attempt-classification.test.ts` :: `enforces 3 auto + 3 manual = 6 total attempts, rejects 4th manual retry, and verifies identical payload bytes and signatures` |
| **RPL-01** | Manual delivery retry reuses exact raw bytes and pinned secret version | § 5.8, 7.4 | **Implemented & Verified** | `apps/server/src/webhook-engine/` | `apps/server/tests/webhook-engine/delivery-lifecycle-and-retry.test.ts` :: `preserves exact byte snapshot in DeliveryBodyVault across retries`<br>`apps/server/tests/webhook-engine/delivery-lifecycle-and-retry.test.ts` :: `retains historical secret version in vault while delivery is retryable` |
| **RPL-02** | Replay creates new delivery serializing canonical event under endpoint current mode | § 5.8, 7.4 | **Implemented & Verified** | `apps/server/src/application/services/webhook.service.ts` | `apps/server/tests/webhook-engine/delivery-lifecycle-and-retry.test.ts` :: `replays canonical event generating fresh delivery with current mode` |

---

## 3. Razorpay Compatibility Adapter Status

PRD v2.3 explicitly restricts Razorpay compatibility to a pattern-level subset. Universal drop-in compatibility for arbitrary third-party language SDKs that hardcode remote provider URLs is formally disclaimed.

| Route / Feature | Method | Supported Status | Verification Reference (File & Test Case) |
| :--- | :---: | :---: | :--- |
| `/v1/orders` | POST | **Implemented & Verified** | `apps/server/tests/integration/compat-api.test.ts` :: `creates and fetches Razorpay compatibility order entity` |
| `/v1/orders/:id` | GET | **Implemented & Verified** | `apps/server/tests/integration/compat-api.test.ts` :: `creates and fetches Razorpay compatibility order entity` |
| `/v1/checkout/embedded` | GET | **Implemented & Verified** | `apps/server/tests/integration/compat-api.test.ts` :: `creates bound checkout session via compat interface` |
| `/v1/orders/:id/checkout-sessions` (PAYSIM Ext.) | POST | **Implemented & Verified** | `apps/server/tests/integration/compat-api.test.ts` :: `creates bound checkout session via compat interface` |
| `/v1/payments/:id/checkout-sessions` (PAYSIM Ext.) | POST | **Implemented & Verified** | `apps/server/tests/integration/compat-api.test.ts` :: `creates bound checkout session via compat interface` |
| `/v1/refunds` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/transfers` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/payouts` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/subscriptions` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/invoices` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/virtual_accounts` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |
| `/v1/customers` | ALL | **Fail-Closed (501 Not Supported)** | `apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features` |

---

## 4. Phase 02.1 Audit Remediations Traceability (`V23-01` to `V23-25`)

The 15 critical technical audit findings from Phase 02.1 (`AUD-01` through `AUD-15`) defined 25 mandatory verification scenarios. An independent release audit against the 546-test Vitest suite reveals:
- **14 Scenarios are fully Implemented & Verified** with direct, automated Vitest tests.
- **7 Scenarios are Partially Verified** due to client/browser boundaries, missing secondary assertions, or contract error code discrepancies.
- **4 Scenarios are Not Verified / Not Implemented / Specification Conflicts**.

> [!NOTE]
> These counts represent independent release audit verification results against concrete automated test artifacts, not overall product-completion percentages.

| Scenario ID | Description | Target Invariant | Release Verification Status | Implementation & Test Evidence |
| :--- | :--- | :--- | :---: | :--- |
| **V23-01** | Embedded iframe API call in third-party context | Authenticates via `Authorization: Bearer <sessionAccessToken>` without cookies | **Partially Verified** | `apps/server/src/routes/checkout.routes.ts`<br>`apps/server/tests/integration/checkout-api.test.ts` :: `exchanges capability token for iframe session credentials`<br>*Evidence Analysis & Boundaries:*<br>• *Session Access Token Issuance:* Calling `POST /checkout/:sessionId/exchange` with a valid capability token issues an ephemeral `sessionAccessToken` (`sat_ps_...`), verified in `checkout-api.test.ts`.<br>• *Server-Side Bearer Validation:* The current checkout routes (`checkout.routes.ts`) do not mount an authentication middleware requiring or validating the `sessionAccessToken`. The test for token rotation (`rotate-token`) does not pass or assert Bearer authentication.<br>• *Native API Bearer Authentication:* The Native API (`/api/v1/*`) enforces Bearer authentication using administrative bearer credentials (`cred_ps_...`), which does not demonstrate the normative embedded iframe session token requirement.<br>• *Status:* The requirement is partially verified through token generation and browser client attachment (`scripts/verify-browser-journeys.mjs`), but server-side token enforcement is not demonstrated. |
| **V23-02** | Iframe reload / modal reopen with capability token | Idempotent 200 response | **Partially Verified** | `apps/server/src/application/services/checkout.service.ts`<br>Idempotent exchange logic is implemented in `checkout.service.ts` (`exchangeCapabilityToken`), but lacks a dedicated automated Vitest assertion specifically verifying secondary modal reopen re-exchange. |
| **V23-03** | Capability expiration on `created` payment attempt | Leaves attempt `created`, 0 events | **Verified** | `apps/server/src/application/services/checkout.service.ts`<br>`apps/server/tests/application/checkout-use-cases.test.ts` :: `rejects exchange when session has expired (CHECKOUT_SESSION_EXPIRED)`<br>*Verified Behavior:* Calling exchange after session expiry returns `CHECKOUT_SESSION_EXPIRED`, leaves payment attempt in `created` status, and generates 0 webhook events. |
| **V23-04** | Compatibility key rotation & secret retention across retries | Pinned secret version retention and immediate rejection of rotated credentials | **Verified** | *1. Credential Rejection:* `apps/server/src/routes/control.routes.ts` & `apps/server/src/application/services/control.service.ts`, verified in `apps/server/tests/route-manifest-and-security.test.ts` :: `verifies revoked credentials fail immediately upon rotation` (asserts old Basic Auth credentials return 401 UNAUTHORIZED on `/compat/razorpay/v1/orders` after rotation).<br>*2. Webhook Secret Retention:* `apps/server/src/webhook-engine/retention-tracker.ts` & `apps/server/src/webhook-engine/body-vault.ts`, verified in `apps/server/tests/webhook-engine/webhook-audit-phase03-6-1.test.ts` :: `preserves secret version 1 across retries after rotating to version 2, and uses version 2 for new replays` (asserts retry uses v1 secret HMAC and replay uses v2 secret HMAC). |
| **V23-05** | Mutating endpoint mode from Native to Compatibility | Retry retains original mode; new events use new mode | **Specification Conflict** | `packages/contracts/src/endpoints.ts`, `apps/server/src/application/services/webhook.service.ts`<br>*Conflict Analysis:*<br>• *PRD Expectation:* PRD v2.3 § 7.4 expects an endpoint's dispatch mode (`native` vs `compatibility`) to be mutable during operation, with in-flight retryable deliveries retaining their original mode snapshot while subsequent events use the new mode.<br>• *Public Contract Constraint:* The public `UpdateWebhookEndpointRequestSchema` strictly allows modifying `url`, `status`, `events`, and `description`; it intentionally disallows mutating `mode` (mode is immutable after registration).<br>• *Immutability vs Mutation:* The existing schema immutability prevents testing or executing the specified Native-to-Compatibility mutation scenario. Event replay under an endpoint's current mode is verified in `delivery-lifecycle-and-retry.test.ts`, but the mutation scenario itself represents an unresolved specification/implementation conflict. |
| **V23-06** | Webhook delivery retry byte preservation | Bit-for-bit raw body and HMAC match | **Verified** | `apps/server/src/webhook-engine/body-vault.ts`<br>`apps/server/tests/webhook-engine/phase03-6-5-attempt-classification.test.ts` :: `enforces 3 auto + 3 manual = 6 total attempts, rejects 4th manual retry, and verifies identical payload bytes and signatures`<br>*Verified Behavior:* Verifies exact byte snapshot preservation and identical HMAC-SHA256 signatures across all 6 delivery attempts. |
| **V23-07** | Registering private Docker bridge IP (`172.17.0.2`) | Rejected with 422 | **Verified** | `packages/contracts/src/common.ts`, `apps/server/src/webhook-engine/dispatcher-security.ts`<br>`apps/server/tests/webhook-engine/network-security.test.ts` :: `strictly rejects RFC 1918 private LAN 172.16.0.0/12`<br>*Verified Behavior:* Registration of `http://172.17.0.2:8000/hook` is rejected with 422 VALIDATION_ERROR by loopback confinement. |
| **V23-08** | Idempotent replay of checkout key after expiration | Returns 410 with `paymentId` | **Partially Verified** | `apps/server/src/application/services/checkout.service.ts`<br>Token expiration error handling is verified in `checkout-use-cases.test.ts`, but an explicit replay assertion returning 410 with `paymentId` is not covered by a dedicated Vitest test. |
| **V23-09** | Embedding checkout in unauthorized parent origin | CSP `frame-ancestors` enforcement | **Partially Verified (Browser-Only)** | `apps/server/src/routes/checkout.routes.ts`<br>Dynamic CSP header emission is tested in server routes; actual browser iframe framing denial was validated via Chrome CDP E2E scripts (`scripts/verify-browser-journeys.mjs`), not in Vitest. |
| **V23-10** | Calling unsupported Razorpay route (`/v1/refunds`) | Fail-closed with typed 501 | **Verified** | `apps/server/src/routes/compat.routes.ts`, `apps/server/src/middleware/fallback.middleware.ts`<br>`apps/server/tests/integration/routing-fallback.test.ts` :: `Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features`<br>*Verified Behavior:* Calling `/compat/razorpay/v1/refunds` returns HTTP 501 with error code `COMPATIBILITY_FEATURE_NOT_SUPPORTED`. |
| **V23-11** | Webhook target responds with 302 redirect | `redirect_rejected` outcome | **Verified** | `apps/server/src/webhook-engine/http-dispatcher.ts`<br>`apps/server/tests/webhook-engine/http-dispatcher.test.ts` :: `rejects 3xx redirects without following (strict no-follow policy)`<br>*Verified Behavior:* Outbound HTTP dispatcher classifies 301/302 responses as `redirect_rejected` without following `Location` header, per ADR-005. |
| **V23-12** | Event submission during 100-job queue saturation | `DELIVERY_QUEUE_FULL` rejected delivery | **Verified** | `apps/server/src/webhook-engine/delivery-queue.ts`<br>`apps/server/tests/webhook-engine/phase03-6-6-queue-overflow-manual-intent.test.ts` :: `preserves manual intent through queue overflow and reconciliation, cancels timer, and consumes exactly 1 manual allowance`<br>*Verified Behavior:* Queue saturation preserves RootState delivery state, cancels pending retry timers, and prevents duplicate job execution. |
| **V23-13** | Storage saturation with unexpired idempotency records | Cascade eviction protects active entities | **Not Verified** | `packages/storage-memory/src/`<br>Bounded in-memory maps exist in storage-memory, but an automated test exercising high-volume cascading eviction and asserting 429 under saturation was not included in the Vitest suite. |
| **V23-14** | Compatibility fetch of foreign credential order | 404 NOT_FOUND isolation | **Partially Verified** | `packages/contracts/src/orders.ts`<br>Data schema tracks `ownerCredentialId`, but a dedicated multi-credential cross-tenant test asserting 404 when credential B fetches credential A's order is absent from `compat-api.test.ts`. |
| **V23-15** | Control API mutating request without CSRF token | 403 CSRF_INVALID | **Verified** | `apps/server/src/middleware/auth.middleware.ts`<br>`apps/server/tests/integration/control-api.test.ts` :: `enforces SET-04 CSRF protection on mutating control endpoints`<br>*Verified Behavior:* Mutating POST requests without `X-PaySim-CSRF` return 403 Forbidden with code `CSRF_INVALID`. |
| **V23-16** | Reissuing checkout session for `created` payment | New capability issued, same payment ID | **Verified** | `apps/server/src/application/services/checkout.service.ts`<br>`apps/server/tests/integration/native-api.test.ts` :: `creates payment attempt, reissues checkout session, and simulates outcome`<br>*Verified Behavior:* Calling `POST /api/v1/payments/:id/checkout-sessions` on a `created` payment returns 201 Created with a newly issued `capabilityToken` and `sessionId` while retaining the payment ID. |
| **V23-17** | Reissuing checkout session for `captured` payment | Rejected with `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` | **Partially Verified (Specification Discrepancy)** | `apps/server/src/application/services/checkout.service.ts`<br>`apps/server/tests/application/checkout-use-cases.test.ts` :: `rejects checkout session creation on paid order (ORDER_ALREADY_PAID)`<br>*Discrepancy Analysis:*<br>• *Normative Expected Code:* `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` (PRD v2.3 § 5.11 & Resolution Register AUD-11).<br>• *Actual Runtime Code:* `409 ORDER_ALREADY_PAID` (`checkout.service.ts` line 85 throws `createOrderAlreadyPaidError(orderId)`).<br>• *Route-Level Coverage:* No route-level or integration test asserts `CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`. While the error code is formally registered in `@paysim/contracts` catalog schemas, the server runtime does not return it. The server enforces the 409 rejection invariant, but with a mismatched error code. Recorded as an unresolved specification discrepancy. |
| **V23-18** | Native webhook fixture byte verification | 293-byte exact match | **Verified** | `packages/contracts/fixtures/events-native/`<br>`apps/server/tests/webhook-serialization.test.ts` :: `verifies committed fixture file byte sizes are strictly preserved`<br>*Verified Behavior:* Asserts committed `payment.captured.body.json` exactly matches 293 bytes on disk and deserializes identically. |
| **V23-19** | Compatibility webhook fixture byte verification | 333-byte exact match | **Verified** | `packages/contracts/fixtures/events-compat/`<br>`apps/server/tests/webhook-serialization.test.ts` :: `verifies committed fixture file byte sizes are strictly preserved`<br>*Verified Behavior:* Asserts committed `payment.captured.body.json` exactly matches 333 bytes on disk and deserializes identically. |
| **V23-20** | Secret scrubbing in server logs | `[REDACTED]` header & token masking | **Not Implemented / Not Verified** | `packages/shared/src/index.ts`, `packages/shared/tests/shared.test.ts`<br>*Distinction & Evidence Scope:*<br>• *Standalone Redaction Utilities:* Unit tests in `packages/shared/tests/shared.test.ts` (`redacts sensitive headers to prevent secret logging` and `redacts sensitive object fields recursively`) verify that pure utility functions mask sensitive fields in isolated objects.<br>• *HTTP Response & DTO Masking:* Integration tests in `route-manifest-and-security.test.ts` verify that safe credentials overview DTOs return `••••••••` and error response bodies do not reflect raw secrets.<br>• *Actual Server Stdout/Stderr Log Redaction:* Not Implemented / Not Verified. The Express application in `apps/server/src/app.ts` does not mount server-level request logging middleware. Actual stdout/stderr log redaction is therefore not implemented or verified in the server runtime. |
| **V23-21** | Capability token fragment stripping in browser | Immediate `history.replaceState` | **Partially Verified (Browser-Only)** | `apps/web/src/views/CheckoutSimulatorView.tsx`<br>Fragment removal is implemented in client code; verified via Chrome CDP browser journey automation (`scripts/verify-browser-journeys.mjs` Task 3: URL fragment is replaced with empty string), not in Node-based Vitest unit suite. |
| **V23-22** | Nonce verification in checkout iframe handshake | Handshake with bad nonce ignored | **Not Implemented / Not Verified** | `packages/contracts/src/checkout.ts`<br>PRD v2.3 discussion proposed a separate `nonceHash` parameter; the release implementation secures the postMessage handshake via capability tokens and `parentOrigin` validation without a standalone nonce field. |
| **V23-23** | Graceful shutdown delivery interruption | Outbound sockets aborted cleanly | **Verified** | `apps/server/src/webhook-engine/http-dispatcher.ts`, `apps/server/src/webhook-engine/delivery-worker-pool.ts`<br>`apps/server/tests/webhook-engine/phase03-6-3-status-concurrency-and-guarantees.test.ts` :: `verifies in-flight dispatch aborted by signal transitions to interrupted and permanently terminates`<br>*Verified Behavior:* In-flight HTTP request aborted by `AbortSignal` maps attempt outcome to `interrupted_unknown`, sets delivery status to `interrupted`, and permanently terminates without scheduling retries. |
| **V23-24** | Manual retry budget enforcement | 4th manual retry rejected (max 3) | **Verified** | `apps/server/src/webhook-engine/retry-policy.ts`<br>`apps/server/tests/webhook-engine/phase03-6-5-attempt-classification.test.ts` :: `enforces 3 auto + 3 manual = 6 total attempts, rejects 4th manual retry, and verifies identical payload bytes and signatures`<br>*Verified Behavior:* Rejects 4th manual retry attempt with `MAX_RETRIES_EXCEEDED` after 3 automatic and 3 manual retries (6 total). |
| **V23-25** | One-time dashboard control token consumption | Replayed control token returns 401 | **Verified** | `apps/server/src/application/services/control.service.ts`<br>`apps/server/tests/integration/control-api.test.ts` :: `enforces SET-03 single-use consumption of bootstrap token`<br>*Verified Behavior:* Second exchange of the single-use bootstrap control token returns HTTP 401 with `CONTROL_TOKEN_INVALID`. |

---

## 5. Explicitly Deferred Features (Post-MVP Scope)

In accordance with PRD v2.3 § 3.2, the following capabilities are formally classified as deferred beyond the v1.0.0 release:

| Deferred Capability | Architecture Classification | Deferral Rationale | Target Release Phase |
| :--- | :--- | :--- | :---: |
| **Multi-Tenant Project Workspaces** | Feature Enhancement | MVP is intentionally single-developer local workflow. Multi-project workspace segregation adds unnecessary runtime overhead for isolated local testing. | Phase 04 / Post-MVP |
| **Persistent SQLite / Disk Storage** | Storage Enhancement | PAYSIM v1.0.0 uses process-local in-memory storage. State is volatile and is not recovered after process restart. This design avoids a persistent application database but does not constitute a general zero-leakage security guarantee. | Phase 04 / Post-MVP |
| **Configurable Gateway Latency / Delays** | Simulation Enhancement | Timing delays are configurable via developer integration test harnesses. Automated synthetic latency injection is scheduled for post-MVP. | Phase 04 / Post-MVP |
| **Refunds & Disputes Simulation** | Provider Feature | Core developer need is checkout capture and order fulfillment webhook testing. Refund state transitions are deferred to follow-on compatibility packs. | Phase 05 |
| **Custom Webhook Payload Templates** | Delivery Enhancement | Native and Compatibility wire formats satisfy 100% of MVP testing use cases. Dynamic custom payload templating engine is scheduled for future extension. | Phase 05 |

---

## 6. Boundaries & Security Testing Scope

The following areas are explicitly documented as outside the automated verification scope of local developer workstations:

1. **Third-Party Official SDK Binaries:** PAYSIM implements standard HTTP/JSON and embedded Checkout compatibility. Official vendor SDKs that hardcode external cloud URLs (`https://api.razorpay.com`) or perform proprietary certificate pinning are not verified or supported.
2. **External Network Penetration:** All security tests and SSRF checks were performed against local loopback sockets (127.0.0.1 and [::1]). Loopback-focused security tests do not constitute public-network penetration testing.

---

## 7. Future Maintenance Backlog (Target: v1.1.0 Engineering Review)

The following items represent confirmed specification ambiguities, error code discrepancies, or missing verification harnesses identified during the Phase 10 independent release audit. They are scheduled for resolution in the next minor engineering release (v1.1.0):

1. **Checkout Session Bearer Authentication Contract:**
   - *Issue:* `POST /checkout/:sessionId/exchange` issues an ephemeral `sessionAccessToken`, but checkout routes (`checkout.routes.ts`) do not mount middleware to enforce `Authorization: Bearer <sessionAccessToken>`.
   - *Action for v1.1.0:* Either implement explicit Bearer token authentication middleware on checkout session routes or formally update the PRD to clarify that origin verification and capability token possession define the security boundary.

2. **Webhook Endpoint Mode Mutability vs. Immutability:**
   - *Issue:* PRD v2.3 specifies retaining delivery snapshots when an endpoint's mode is mutated from Native to Compatibility. However, `UpdateWebhookEndpointRequestSchema` strictly freezes `mode` as immutable upon creation.
   - *Action for v1.1.0:* Formally decide whether endpoint `mode` should remain immutable (and update PRD test scenarios accordingly) or extend `UpdateWebhookEndpointRequestSchema` and `WebhookService.updateEndpoint` to support mode changes with snapshot retention tests.

3. **Checkout Session Reissue Error Code Alignment:**
   - *Issue:* Normative specification requires `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` when reissuing a session for a captured payment attempt, but `checkout.service.ts` currently returns `409 ORDER_ALREADY_PAID`.
   - *Action for v1.1.0:* Update `checkout.service.ts` to return `createCheckoutSessionReissueNotAllowedError` when a session reissue is attempted on terminal payments, aligning runtime behavior with the contracts error catalogue.

4. **Server Request Logging Pipeline & Stream Redaction:**
   - *Issue:* `@paysim/shared` contains tested redaction utilities, and response bodies mask secrets, but Express does not mount an ingress logging middleware and no tests verify stdout/stderr log streams.
   - *Action for v1.1.0:* Decide whether a production-grade request logging middleware is required for local developer operation. If adopted, implement the middleware and add dedicated tests asserting stdout stream redaction for Authorization headers, cookies, and secrets.

5. **Direct Storage Saturation & PostMessage Nonce Verification:**
   - *Issue:* Bounded maps exist in `@paysim/storage-memory` and postMessage uses capability tokens, but automated tests verifying cascading eviction returning 429 and dedicated handshake nonces are absent.
   - *Action for v1.1.0:* Implement high-volume saturation tests verifying cache eviction policies under 429 limits, and evaluate whether explicit handshake nonces should be added to postMessage exchange contracts.

---

## 8. Sign-Off & Traceability Certification

This traceability matrix certifies that:
- **PRD v2.3.0** is the active normative specification.
- Core MVP requirements are verified across **546 passing tests in 49 test files**.
- Of the 25 Phase 02.1 verification scenarios:
  - **14 are fully Implemented & Verified** by passing Vitest automated tests.
  - **7 are Partially Verified** (including 2 browser-only CDP journeys and 1 contract error code discrepancy).
  - **4 are Not Verified / Not Implemented / Specification Conflicts** (storage cascade eviction under saturation, server-level log stream redaction, separate postMessage handshake nonces, and endpoint mode mutation conflict).
- These counts reflect independent release audit verification results against concrete automated test artifacts, not overall product-completion percentages.
- All deferred features and specification discrepancies have explicit tracking rationales in the v1.1.0 Maintenance Backlog.
- No untested requirement is falsely certified as complete.
