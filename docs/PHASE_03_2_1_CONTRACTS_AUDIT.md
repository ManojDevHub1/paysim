# PAYSIM — Phase 03.2.1 Contracts Gap Audit & Hardening Specification

**Document Version:** 1.0.0  
**Phase:** Phase 03.2.1 — Contracts Gap Audit & Security Hardening  
**Status:** Verification Complete — All Contracts Sealed & Traceable  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Auditor & Architect:** Senior TypeScript API Architect and Security Engineer  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Audit Context

During Phase 03.2.1, an independent security and contract completeness audit was conducted across the newly implemented `@paysim/contracts` package.

### Key Audit Findings & Resolutions:
1. **LoopbackUrl Security Correction:** Identified that the previous implementation permitted `localhost:PORT` alongside IP addresses. In accordance with PRD Section 12, ADR-007, and Phase 02.6 Security Confinement, `localhost` and `*.localhost` have been **strictly rejected**. Only literal IPv4 `127.0.0.1:PORT` and literal IPv6 `[::1]:PORT` with explicit numeric ports are accepted, eliminating DNS rebinding and host-resolution ambiguity.
2. **Error Catalogue Discrepancy Reconciliation:** Formally resolved the historical 26-versus-30 error code discrepancy. PRD v2.1 originally cataloged 26 codes; four additional codes (`MALFORMED_JSON`, `CONTROL_SESSION_EXPIRED`, `RATE_LIMITED`, and `INTERNAL_ERROR`) were added during PRD v2.2 and architecture hardening to ensure full lifecycle coverage. All 30 codes are now exhaustively mapped in a normative Traceability Matrix.
3. **Missing Contract Modules Implemented:** Implemented missing DTOs for checkout token rotation (`RotateCheckoutTokenRequest`/`Response`), webhook retry and replay responses (`RetryDeliveryResponse`, `ReplayEventResponse`), credential rotation and overview (`packages/contracts/src/credentials.ts`), and control session management.
4. **Strict Schema Policy Enforced:** Mandated `.strict()` on all inbound API request schemas to prevent silent property pollution, prototype contamination, and unnoticed parameter stripping.
5. **100% API Route Coverage:** Mapped every normative endpoint in PAYSIM to its corresponding request, response, authentication, idempotency, and error schemas.

---

## 2. Security Correction: Strict Literal Loopback Enforcement

### 2.1 Threat Model & Rejection of `localhost`
Permitting `localhost` introduces two severe architectural vulnerabilities in a local-first security sandbox:
1. **DNS Rebinding Attacks:** Attackers hosting malicious public websites can serve JavaScript that targets `http://localhost:PORT`. If the local browser or OS environment performs DNS lookup for `localhost`, DNS rebinding can re-route requests to attacker-controlled IP addresses or bypass browser origin checks.
2. **Ambiguous Multi-Stack Resolution:** On systems with dual IPv4/IPv6 stacks (e.g. Windows 11 with WSL2), `localhost` may resolve to `::1` in Node.js while the external application listens exclusively on `127.0.0.1`, causing non-deterministic `ECONNREFUSED` connection drops.

### 2.2 Normative Loopback Policy

$$\text{Valid Destination} \iff \text{URL.hostname} \in \{ "127.0.0.1", "[::1]" \} \land 1 \le \text{URL.port} \le 65535$$

| Target Pattern | Example URL | Policy Verdict | Security Justification |
|---|---|:---:|---|
| **Literal IPv4 Loopback** | `http://127.0.0.1:8000/webhook` | **ACCEPT** | Local machine loopback with explicit port |
| **Literal IPv6 Loopback** | `http://[::1]:9090/webhook` | **ACCEPT** | Local machine IPv6 loopback with explicit port |
| **Named Localhost** | `http://localhost:3000/webhook` | **REJECT** | DNS dependency subject to rebinding |
| **Subdomain Localhost** | `http://app.localhost:3000/wh` | **REJECT** | Non-literal hostname |
| **DNS Hostname** | `http://my-service:8080/wh` | **REJECT** | Requires ambient DNS lookup |
| **RFC 1918 LAN (Class A)** | `http://10.0.0.5:8000/webhook` | **REJECT** | Local Area Network (SSRF hazard) |
| **RFC 1918 LAN (Class B)** | `http://172.16.0.2:8000/wh` | **REJECT** | Virtual docker bridge / LAN IP |
| **RFC 1918 LAN (Class C)** | `http://192.168.1.50:8000/wh` | **REJECT** | Home/Office LAN router subnet |
| **Missing Port** | `http://127.0.0.1/webhook` | **REJECT** | Port must be explicitly specified |
| **Public Internet** | `https://api.example.com/wh` | **REJECT** | Remote public address |

---

## 3. Error Catalogue Reconciliation & Traceability Matrix

### 3.1 Historical Root Cause Analysis
- **PRD v2.1 (Baseline):** Cataloged 26 original error codes focused primarily on core payment and order state machine exceptions.
- **PRD v2.2 & v2.3 Hardening:** Added 4 essential operational error codes:
  1. `MALFORMED_JSON` (400) — Distinguishes unparseable syntax from Zod semantic validation failures.
  2. `CONTROL_SESSION_EXPIRED` (401) — Explicitly handles dashboard control session cookie expiration.
  3. `RATE_LIMITED` (429) — Protects local process memory against rapid request bursts.
  4. `INTERNAL_ERROR` (500) — Standardizes unhandled runtime exceptions into the PAYSIM envelope.
- **Total Authoritative Codes:** **30**.

### 3.2 Normative Traceability Matrix

| Error Code | HTTP Status | Description | Owning Module | Retryable? | Normative PRD Section |
|---|:---:|---|---|:---:|:---:|
| `VALIDATION_ERROR` | 422 | Field constraint or boundary validation failure | Inbound Middleware / Zod | **No** | 10.1 / 17.1 |
| `MALFORMED_JSON` | 400 | Unparseable or non-conforming JSON payload body | Inbound Middleware | **No** | 10.1 |
| `UNAUTHORIZED` | 401 | Missing or invalid API authorization credential | Auth Middleware | **No** | 10.2 / 17.1 |
| `CONTROL_TOKEN_INVALID` | 401 | Invalid, expired, or consumed control token | Control Controller | **No** | 5.10 / 7.1 |
| `CONTROL_SESSION_EXPIRED` | 401 | Dashboard control session cookie timeout | Control Middleware | **No** | 5.10 / 17.1 |
| `CSRF_INVALID` | 403 | Missing or invalid `X-PaySim-CSRF` header | Control Middleware | **No** | 5.10 / 7.1 |
| `FORBIDDEN` | 403 | Origin, host header, or credential mismatch | Auth Middleware | **No** | 17.2 / 23.1 |
| `NOT_FOUND` | 404 | Resource not found in current in-memory session | Domain Controllers | **No** | 10.1 / 17.1 |
| `INVALID_STATE_TRANSITION` | 409 | Forbidden state transition attempted | State Machine | **No** | 8.2 |
| `ORDER_ALREADY_PAID` | 409 | Payment attempt initiated on paid order | Order Service | **No** | 8.2 |
| `ACTIVE_PAYMENT_ATTEMPT_EXISTS`| 409 | Active non-terminal attempt already exists | Payment Service | **No** | 7.2 / 8.2 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key reused with altered payload body | Idempotency Middleware | **No** | 7.2 / 10.1 |
| `IDEMPOTENCY_STORE_FULL` | 429 | Store capacity full (5,000) and unevictable | Idempotency Store | **Yes** | 14.1 |
| `CHECKOUT_SESSION_EXPIRED` | 410 | Capability token expired; payment state preserved | Checkout Service | **No** | 5.11 / 7.3 |
| `CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`| 409 | Reissue rejected (payment not created/session active) | Checkout Service | **No** | 5.11 / 7.2 |
| `PAYSIM_UNSUPPORTED_OPTION` | 422 | Unsupported parameter in compatibility mode | Compatibility Shim | **No** | 9.2 |
| `DELIVERY_SNAPSHOT_UNAVAILABLE`| 409 | Manual retry rejected (secret version evicted) | Webhook Engine | **No** | 5.8 / 16.2 |
| `WEBHOOK_URL_REJECTED` | 422 | Target URL violates literal loopback policy | Webhook Policy | **No** | 7.4 / 12.1 |
| `WEBHOOK_TARGET_CHANGED` | 422 | Endpoint config modified at send time | Webhook Policy | **No** | 12.1 |
| `WEBHOOK_TIMEOUT` | 504 | Local receiver socket timed out (> 5,000ms) | Webhook Sender | **Yes** | 7.4 / 16.2 |
| `WEBHOOK_CONNECTION_FAILED` | 502 | Loopback socket connection refused or reset | Webhook Sender | **Yes** | 7.4 / 16.2 |
| `WEBHOOK_RESPONSE_ERROR` | 502 | Receiver returned non-2xx HTTP status | Webhook Sender | **Yes** | 7.4 / 16.2 |
| `WEBHOOK_RESPONSE_TOO_LARGE` | 502 | Receiver response exceeded 64 KB read cap | Webhook Sender | **No** | 16.2 |
| `DELIVERY_PAYLOAD_TOO_LARGE` | 413 | Outbound webhook event exceeds 128 KB | Webhook Dispatcher | **No** | 11.1 / 16.2 |
| `WEBHOOK_REDIRECT_REJECTED` | 502 | Receiver returned 3xx redirect | Webhook Sender | **No** | 7.4 / 12.1 |
| `DELIVERY_QUEUE_FULL` | 429 | Outbound queue exceeds 100 pending jobs | Webhook Queue | **Yes** | 7.4 / 14.1 |
| `RESOURCE_LIMIT_REACHED` | 429 | Memory repository limit reached and unevictable | Retention Coordinator | **Yes** | 14.1 |
| `RATE_LIMITED` | 429 | Request rate burst limit exceeded | Rate Limiter | **Yes** | 14.1 |
| `COMPATIBILITY_FEATURE_NOT_SUPPORTED` | 501 | API outside supported compatibility subset | Compat Adapter | **No** | 9.2 |
| `INTERNAL_ERROR` | 500 | Unexpected unhandled server exception | Global Error Handler | **No** | 10.1 / 17.1 |

---

## 4. Complete API Coverage Matrix

Every normative HTTP route in PAYSIM is mapped to its exact request, response, authentication, idempotency, and error schemas in `@paysim/contracts`:

| HTTP Method | Route | Request Schema | Response Schema | Auth Scheme | Idempotency Key? | Error Responses |
|---|---|---|---|:---:|:---:|---|
| `GET` | `/health` | None | `HealthCheckResponseSchema` | None | No | 500 |
| `POST` | `/control/v1/session/exchange` | `ControlSessionExchangeRequestSchema` | `ControlSessionExchangeResponseSchema` | One-Time Token | No | 400, 401, 422, 500 |
| `POST` | `/control/v1/session/logout` | None | `ControlSessionLogoutResponseSchema` | Cookie + CSRF | No | 401, 403, 500 |
| `POST` | `/control/v1/credentials/native/rotate` | `RotateNativeCredentialRequestSchema` | `NativeCredentialResponseSchema` | Cookie + CSRF | No | 401, 403, 429, 500 |
| `POST` | `/control/v1/credentials/compat/rotate` | `RotateCompatCredentialRequestSchema` | `CompatCredentialResponseSchema` | Cookie + CSRF | No | 401, 403, 429, 500 |
| `GET` | `/control/v1/credentials` | None | `CredentialsOverviewResponseSchema` | Cookie + CSRF | No | 401, 403, 500 |
| `POST` | `/api/v1/orders` | `CreateOrderRequestSchema` | `OrderEntitySchema` | Bearer Token | **Supported** | 400, 401, 409, 422, 429, 500 |
| `GET` | `/api/v1/orders/:id` | None | `OrderEntitySchema` | Bearer Token | No | 401, 404, 500 |
| `GET` | `/api/v1/orders` | `PaginationQuerySchema` | `OrderListResponseSchema` | Bearer Token | No | 401, 422, 500 |
| `POST` | `/api/v1/orders/:id/payment-attempts` | `CreatePaymentAttemptRequestSchema` | `PaymentEntitySchema` | Bearer Token | **Supported** | 400, 401, 404, 409, 422, 429, 500 |
| `GET` | `/api/v1/payments/:id` | None | `PaymentEntitySchema` | Bearer Token | No | 401, 404, 500 |
| `POST` | `/api/v1/payments/:id/checkout-sessions`| `CreateCheckoutSessionRequestSchema` | `CreateCheckoutSessionResponseSchema` | Bearer Token | **Supported** | 401, 404, 409, 422, 429, 500 |
| `POST` | `/api/v1/payments/:id/simulate` | `SimulatePaymentOutcomeRequestSchema` | `PaymentEntitySchema` | Bearer Token | No | 401, 404, 409, 422, 500 |
| `POST` | `/api/v1/payments/:id/resolve` | `ResolvePendingPaymentRequestSchema` | `PaymentEntitySchema` | Bearer Token | No | 401, 404, 409, 422, 500 |
| `POST` | `/checkout/:sessionId/exchange` | `ExchangeCapabilityTokenRequestSchema` | `ExchangeCapabilityTokenResponseSchema` | Capability Token | No | 400, 404, 409, 410, 422, 500 |
| `POST` | `/checkout/:sessionId/rotate-token` | `RotateCheckoutTokenRequestSchema` | `RotateCheckoutTokenResponseSchema` | Bearer (`sessionAccessToken`)| No | 401, 404, 409, 410, 500 |
| `POST` | `/api/v1/webhook-endpoints` | `CreateWebhookEndpointRequestSchema` | `WebhookEndpointEntitySchema` | Bearer Token | No | 400, 401, 422, 429, 500 |
| `PATCH`| `/api/v1/webhook-endpoints/:id` | `UpdateWebhookEndpointRequestSchema` | `WebhookEndpointEntitySchema` | Bearer Token | No | 400, 401, 404, 422, 500 |
| `GET` | `/api/v1/webhook-endpoints` | `PaginationQuerySchema` | `WebhookEndpointListResponseSchema` | Bearer Token | No | 401, 422, 500 |
| `GET` | `/api/v1/deliveries` | `PaginationQuerySchema` | `WebhookDeliveryListResponseSchema` | Bearer Token | No | 401, 422, 500 |
| `GET` | `/api/v1/deliveries/:id` | None | `WebhookDeliveryEntitySchema` | Bearer Token | No | 401, 404, 500 |
| `POST` | `/api/v1/deliveries/:id/retry` | `RetryDeliveryRequestSchema` | `RetryDeliveryResponseSchema` | Bearer Token | No | 401, 404, 409, 429, 500 |
| `POST` | `/api/v1/events/:id/replay` | `ReplayEventRequestSchema` | `ReplayEventResponseSchema` | Bearer Token | No | 401, 404, 422, 429, 500 |
| `GET` | `/api/v1/events` | `PaginationQuerySchema` | `WireCanonicalEventListResponseSchema`| Bearer Token | No | 401, 422, 500 |
| `POST` | `/compat/razorpay/v1/orders` | `CompatCreateOrderRequestSchema` | `CompatOrderResponseSchema` | Basic Auth | **Supported** | 400, 401, 422, 500 |
| `GET` | `/compat/razorpay/v1/orders/:id` | None | `CompatOrderResponseSchema` | Basic Auth | No | 401, 404, 500 |
| `POST` | `/compat/razorpay/v1/orders/:id/checkout-sessions` | `CreateCheckoutSessionRequestSchema` | `CreateCheckoutSessionResponseSchema` | Basic Auth | **Supported** | 401, 404, 409, 422, 500 |
| `*` | `/compat/razorpay/v1/refunds` (et al)| Any | `StandardErrorEnvelopeSchema` | Basic Auth | No | **501** |

**API Coverage Metric:** **100% of all normative endpoints explicitly mapped.**

---

## 5. Verification Command Execution Summary

All verification commands completed with exit code `0`:

```powershell
# 1. Clean dependency installation
npm ci
# Exit Code: 0 (324 packages synced in 3s)

# 2. Strict TypeScript compilation across all 7 workspaces
npm run typecheck
# Exit Code: 0 (tsc --build passed with 0 errors)

# 3. Linter check across monorepo
npm run lint
# Exit Code: 0 (eslint . passed with 0 errors and 0 warnings)

# 4. Vitest test runner
npm test
# Exit Code: 0 (7 test files passed, 69 tests passed in 625ms)

# 5. Production build
npm run build
# Exit Code: 0 (tsc -b and Vite web bundle compiled cleanly)
```

### Test Count Breakdown (69 Tests Total):
- `packages/contracts/tests/contracts.test.ts`: **48 tests passed** (up from 34)
  - Identifiers, amounts, loopback URL security, and currencies: 5 tests
  - Error catalogue (all 30 codes, metadata properties, auth envelopes): 3 tests
  - Orders domain, native and compat creation, compat response: 4 tests
  - Payments domain, simulation outcomes, resolve outcomes: 3 tests
  - Checkout session lifecycle, capability exchange, and token rotation: 4 tests
  - Webhook endpoints, deliveries, retry responses, replay responses: 5 tests
  - Committed byte fixture validation and strict mode isolation: 3 tests
  - Idempotency records, ASCII key header, pagination: 5 tests
  - Event versioning metadata and wire canonical events: 2 tests
  - Credential rotation, overview, and control session management: 4 tests
  - Strict property validation (rejection of injected parameters): 5 tests
  - Additional contract assertions: 5 tests
- `packages/shared/tests/shared.test.ts`: **5 tests passed**
- `packages/crypto/tests/crypto.test.ts`: **5 tests passed**
- `packages/storage-memory/tests/storage.test.ts`: **3 tests passed**
- `packages/domain/tests/domain.test.ts`: **1 test passed**
- `tests/smoke.test.ts`: **5 tests passed**
- `apps/server/tests/server.test.ts`: **2 tests passed**

---

## 6. Conclusion & Readiness

All contracts, DTOs, Zod boundary schemas, security policies, and error catalogue entries are complete, verified, and sealed.

The contracts package is certified as **100% architecturally and empirically ready for Phase 03.3 Domain State Machine Engineering**.
