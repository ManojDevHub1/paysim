# PAYSIM — Phase 03.2.3 Final Contract Integrity Patch Report

**Document Version:** 1.0.0  
**Phase:** Phase 03.2.3 — Final Contract Integrity Patch & Dynamic Port Confinement  
**Status:** Verification Complete — All Criteria PASS  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`) | System Architecture (`docs/SYSTEM_ARCHITECTURE.md`) | ADR-003, ADR-005, ADR-007 (`docs/ARCHITECTURE_DECISION_REGISTER.md`)  
**Auditor & Architect:** Senior TypeScript API Architect & Security Engineer  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Audit Context

During Phase 03.2.3, the final contract integrity patch was executed across `@paysim/contracts` and `@paysim/shared` to resolve all remaining API coverage inconsistencies, implement dynamic listener port protection, codify the webhook secret rotation lifecycle, and establish an automated, machine-readable route manifest test.

### Key Objectives Achieved:
1. **Authoritative Error Catalogue & HTTP Status Distribution:** Generated the exact mathematical distribution of all 30 normative error codes across HTTP status codes. Explicitly verified `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED` and certified full alignment between code, Zod enums, PRD, and audit specifications.
2. **Webhook Secret Rotation Route (`POST /api/v1/webhook-endpoints/:id/rotate-secret`):** Verified normative specification in PRD Section 11 and System Architecture Section 7. Implemented `RotateEndpointSecretRequestSchema` and `RotateEndpointSecretResponseSchema`, codifying one-time secret disclosure, version incrementing, and retry snapshot retention.
3. **Dynamic Listener Port Protection:** Upgraded static-only loopback checks to runtime-aware dynamic validation. The server and UI listening ports (even when configured dynamically via CLI/env) are registered into the restricted port set, preventing delivery loops and local SSRF. Provided `validateLoopbackDestination()` for independent destination validation prior to outbound socket connection.
4. **Machine-Readable Route Manifest & Automated Coverage Test:** Created [`API_ROUTE_MANIFEST`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts) containing 30 fully specified route contracts. Added an automated test that asserts 100% contract mapping and validates schema instantiation.
5. **Credential Security & Log Redaction:** Implemented header and object redaction utilities (`redactSensitiveHeaders`, `redactSensitiveObject`) in `@paysim/shared` to guarantee that logs, error envelopes, and overview schemas never expose raw secret material.

---

## 2. Error Catalogue Exact HTTP Status Distribution & 501 Verification

### 2.1 HTTP Status Distribution Matrix

All 30 standardized error codes from PRD v2.3.0 Section 17 are mapped into [`ERROR_CATALOGUE`](file:///e:/All%20Project/Paysim/packages/contracts/src/errors.ts) and [`ErrorCodeSchema`](file:///e:/All%20Project/Paysim/packages/contracts/src/errors.ts). The exact distribution across HTTP status codes is:

| HTTP Status | Error Code Count | Standardized Error Codes | Owning Modules |
|:---:|:---:|:---|:---|
| **400** | 1 | `MALFORMED_JSON` | Inbound Middleware |
| **401** | 3 | `UNAUTHORIZED`, `CONTROL_TOKEN_INVALID`, `CONTROL_SESSION_EXPIRED` | Auth Middleware, Control Controller |
| **403** | 2 | `CSRF_INVALID`, `FORBIDDEN` | Control Middleware, Auth Middleware |
| **404** | 1 | `NOT_FOUND` | Domain Controllers |
| **409** | 6 | `INVALID_STATE_TRANSITION`, `ORDER_ALREADY_PAID`, `ACTIVE_PAYMENT_ATTEMPT_EXISTS`, `IDEMPOTENCY_KEY_REUSED`, `CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`, `DELIVERY_SNAPSHOT_UNAVAILABLE` | State Machine, Order Service, Payment Service, Idempotency Middleware, Checkout Service, Webhook Engine |
| **410** | 1 | `CHECKOUT_SESSION_EXPIRED` | Checkout Service |
| **413** | 1 | `DELIVERY_PAYLOAD_TOO_LARGE` | Webhook Dispatcher |
| **422** | 4 | `VALIDATION_ERROR`, `PAYSIM_UNSUPPORTED_OPTION`, `WEBHOOK_URL_REJECTED`, `WEBHOOK_TARGET_CHANGED` | Inbound Middleware, Compatibility Shim, Webhook Policy |
| **429** | 4 | `IDEMPOTENCY_STORE_FULL`, `DELIVERY_QUEUE_FULL`, `RESOURCE_LIMIT_REACHED`, `RATE_LIMITED` | Idempotency Store, Webhook Queue, Retention Coordinator, Rate Limiter |
| **500** | 1 | `INTERNAL_ERROR` | Global Error Handler |
| **501** | 1 | `COMPATIBILITY_FEATURE_NOT_SUPPORTED` | Compat Adapter |
| **502** | 4 | `WEBHOOK_CONNECTION_FAILED`, `WEBHOOK_RESPONSE_ERROR`, `WEBHOOK_RESPONSE_TOO_LARGE`, `WEBHOOK_REDIRECT_REJECTED` | Webhook Sender |
| **504** | 1 | `WEBHOOK_TIMEOUT` | Webhook Sender |
| **Total** | **30** | — | — |

### 2.2 Verification of `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`

In strict conformance with PRD Section 9.2 and System Architecture Section 8.1, any Razorpay route outside the supported subset (Orders API and Standard Checkout shim) returns HTTP 501:

```typescript
COMPATIBILITY_FEATURE_NOT_SUPPORTED: {
  code: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
  httpStatus: 501,
  description: 'Requested provider API is outside the supported compatibility subset',
  owningModule: 'Compat Adapter',
  retryable: false,
  prdSection: '9.2',
}
```

- **Fail-Closed Guarantee:** Requests to `/compat/razorpay/v1/refunds`, `/payouts`, `/subscriptions`, `/transfers`, `/invoices` immediately halt and return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`. PAYSIM never proxies requests to external Razorpay infrastructure.

---

## 3. Webhook Secret Rotation Lifecycle (`POST /api/v1/webhook-endpoints/:id/rotate-secret`)

### 3.1 Contract Specification

The normative route `POST /api/v1/webhook-endpoints/:id/rotate-secret` is codified in [`packages/contracts/src/endpoints.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/endpoints.ts):

- **Inbound Request DTO:**
  ```typescript
  export const RotateEndpointSecretRequestSchema = z
    .object({
      reason: z.string().max(255).optional(),
    })
    .strict();
  ```
- **Outbound Response DTO (One-Time Disclosure):**
  ```typescript
  export const RotateEndpointSecretResponseSchema = z
    .object({
      endpointId: EndpointIdSchema,
      secret: z.string().min(16, 'New signing secret bytes'),
      secretVersion: z.number().int().min(1),
      rotatedAt: IsoTimestampSchema,
    })
    .strict();
  ```
- **Authentication:** `Authorization: Bearer <native_token>` (Native API Bearer Auth).
- **Error Responses:**
  - `401 UNAUTHORIZED`: Missing or invalid bearer token.
  - `404 NOT_FOUND`: Webhook endpoint ID does not exist in current session.
  - `429 RESOURCE_LIMIT_REACHED`: In-memory secret version capacity reached.
  - `500 INTERNAL_ERROR`: Internal cryptographic generation failure.

### 3.2 Secret Versioning & Retry Retention Rules
1. **Version Increment:** Rotating the secret increments `secretVersion` from $V_n$ to $V_{n+1}$.
2. **One-Time Disclosure:** The raw secret string is returned once in the response body. Subsequent `GET /api/v1/webhook-endpoints/:id` calls return `WebhookEndpointEntitySchema`, which exposes only `secretVersion`, strictly withholding the raw secret.
3. **Retry Retention in `WebhookVault`:** The prior signing secret $V_n$ is retained in the in-memory vault for any delivery attempts created prior to rotation. In accordance with PRD Section 5.8 and ADR-003, `Retry` uses the historical snapshot and secret version; `Replay` uses the newly active $V_{n+1}$ secret.
4. **Deterministic Response-Loss Recovery:** If a network interruption occurs before the client receives the rotation response, the client cannot guess the newly generated secret $V_{n+1}$. The client safely issues another rotation request, advancing to $V_{n+2}$. The orphaned $V_{n+1}$ (which has no pinned payment deliveries) is cleanly superseded without deadlock.

---

## 4. Dynamic Listener Port Protection

### 4.1 Architecture

Static port checks (`8787`, `5173`) are insufficient when PAYSIM runs on dynamic ports (e.g. `PORT=9001` or Vite `5174`). [`packages/contracts/src/common.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/common.ts) provides a dynamic port registry and destination validator:

```mermaid
flowchart TD
    Config[PAYSIM Server / UI Startup] -->|Register Active Ports| PortRegistry[Dynamic Restricted Port Registry]
    PortRegistry -->|Default Static| StaticPorts["8787, 5173, 2375, 2376, 4243, 5000"]
    PortRegistry -->|Add Dynamic| DynamicPorts["e.g. 9001 (Backend), 5174 (Vite)"]
    
    WebhookReg[User Webhook Registration] --> LoopbackSchema[LoopbackUrlSchema]
    LoopbackSchema --> Check{Port in Registry OR < 1024?}
    Check -->|Yes| Reject[Reject with 422 WEBHOOK_URL_REJECTED]
    Check -->|No| Accept[Accept URL]
    
    OutboundJob[Outbound Webhook Dispatcher] --> DestValidator[validateLoopbackDestination]
    DestValidator -->|Pre-Socket Connect Check| Check2{Port in Registry?}
    Check2 -->|Yes| Abort[Abort Connection: Port Restricted]
    Check2 -->|No| Connect[Connect Socket]
```

### 4.2 Implemented Primitives in `common.ts`
- `registerRestrictedLoopbackPort(port: number)`: Dynamically registers the server's actual listening port upon startup.
- `unregisterRestrictedLoopbackPort(port: number)`: Unregisters dynamic ports (static security ports cannot be removed).
- `getRestrictedLoopbackPorts()`: Returns all currently restricted ports.
- `resetDynamicRestrictedPorts()`: Resets to static defaults (`8787`, `5173`, `2375`, `2376`, `4243`, `5000`).
- `validateLoopbackDestination(url, options)`: Independent pre-socket destination validator.

---

## 5. Machine-Readable Route Manifest (100% Coverage)

The file [`packages/contracts/src/manifest.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts) exports `API_ROUTE_MANIFEST`, containing exactly **30 route contract definitions**:

| ID | Method | Path | Request Schema | Response Schema | Auth Scheme | Idempotency | Expected Errors |
|---|:---:|---|---|---|:---:|:---:|---|
| `health_check` | `GET` | `/health` | None | `HealthCheckResponseSchema` | `none` | No | `[500]` |
| `control_session_exchange` | `POST` | `/control/v1/session/exchange` | `ControlSessionExchangeRequestSchema` | `ControlSessionExchangeResponseSchema` | `one_time_token` | No | `[400, 401, 422, 500]` |
| `control_session_logout` | `POST` | `/control/v1/session/logout` | None | `ControlSessionLogoutResponseSchema` | `cookie_csrf` | No | `[401, 403, 500]` |
| `control_credentials_native_rotate` | `POST` | `/control/v1/credentials/native/rotate` | `RotateNativeCredentialRequestSchema` | `NativeCredentialResponseSchema` | `cookie_csrf` | No | `[401, 403, 429, 500]` |
| `control_credentials_compat_rotate` | `POST` | `/control/v1/credentials/compat/rotate` | `RotateCompatCredentialRequestSchema` | `CompatCredentialResponseSchema` | `cookie_csrf` | No | `[401, 403, 429, 500]` |
| `control_credentials_overview` | `GET` | `/control/v1/credentials` | None | `CredentialsOverviewResponseSchema` | `cookie_csrf` | No | `[401, 403, 500]` |
| `orders_create` | `POST` | `/api/v1/orders` | `CreateOrderRequestSchema` | `OrderEntitySchema` | `bearer` | **Yes** | `[400, 401, 409, 422, 429, 500]` |
| `orders_get_by_id` | `GET` | `/api/v1/orders/:id` | None | `OrderEntitySchema` | `bearer` | No | `[401, 404, 500]` |
| `orders_list` | `GET` | `/api/v1/orders` | `PaginationQuerySchema` | `OrderListResponseSchema` | `bearer` | No | `[401, 422, 500]` |
| `payment_attempts_create` | `POST` | `/api/v1/orders/:id/payment-attempts` | `CreatePaymentAttemptRequestSchema` | `PaymentEntitySchema` | `bearer` | **Yes** | `[400, 401, 404, 409, 422, 429, 500]` |
| `payments_get_by_id` | `GET` | `/api/v1/payments/:id` | None | `PaymentEntitySchema` | `bearer` | No | `[401, 404, 500]` |
| `payments_list` | `GET` | `/api/v1/payments` | `PaginationQuerySchema` | `PaymentListResponseSchema` | `bearer` | No | `[401, 422, 500]` |
| `checkout_sessions_reissue` | `POST` | `/api/v1/payments/:id/checkout-sessions`| `CreateCheckoutSessionRequestSchema` | `CreateCheckoutSessionResponseSchema` | `bearer` | **Yes** | `[401, 404, 409, 422, 429, 500]` |
| `payments_simulate_outcome` | `POST` | `/api/v1/payments/:id/simulate` | `SimulatePaymentOutcomeRequestSchema` | `PaymentEntitySchema` | `bearer` | No | `[401, 404, 409, 422, 500]` |
| `payments_resolve_pending` | `POST` | `/api/v1/payments/:id/resolve` | `ResolvePendingPaymentRequestSchema` | `PaymentEntitySchema` | `bearer` | No | `[401, 404, 409, 422, 500]` |
| `checkout_capability_exchange` | `POST` | `/checkout/:sessionId/exchange` | `ExchangeCapabilityTokenRequestSchema` | `ExchangeCapabilityTokenResponseSchema` | `capability_token`| No | `[400, 404, 409, 410, 422, 500]` |
| `checkout_token_rotate` | `POST` | `/checkout/:sessionId/rotate-token` | `RotateCheckoutTokenRequestSchema` | `RotateCheckoutTokenResponseSchema` | `bearer` | No | `[401, 404, 409, 410, 500]` |
| `webhook_endpoints_create` | `POST` | `/api/v1/webhook-endpoints` | `CreateWebhookEndpointRequestSchema` | `CreateWebhookEndpointResponseSchema` | `bearer` | No | `[400, 401, 422, 429, 500]` |
| `webhook_endpoints_patch` | `PATCH`| `/api/v1/webhook-endpoints/:id` | `UpdateWebhookEndpointRequestSchema` | `WebhookEndpointEntitySchema` | `bearer` | No | `[400, 401, 404, 422, 500]` |
| `webhook_endpoints_list` | `GET` | `/api/v1/webhook-endpoints` | `PaginationQuerySchema` | `WebhookEndpointListResponseSchema` | `bearer` | No | `[401, 422, 500]` |
| `webhook_endpoints_rotate_secret`| `POST` | `/api/v1/webhook-endpoints/:id/rotate-secret`| `RotateEndpointSecretRequestSchema` | `RotateEndpointSecretResponseSchema` | `bearer` | No | `[401, 404, 429, 500]` |
| `deliveries_list` | `GET` | `/api/v1/deliveries` | `PaginationQuerySchema` | `WebhookDeliveryListResponseSchema` | `bearer` | No | `[401, 422, 500]` |
| `deliveries_get_by_id` | `GET` | `/api/v1/deliveries/:id` | None | `WebhookDeliveryEntitySchema` | `bearer` | No | `[401, 404, 500]` |
| `deliveries_retry` | `POST` | `/api/v1/deliveries/:id/retry` | `RetryDeliveryRequestSchema` | `RetryDeliveryResponseSchema` | `bearer` | No | `[401, 404, 409, 429, 500]` |
| `events_replay` | `POST` | `/api/v1/events/:id/replay` | `ReplayEventRequestSchema` | `ReplayEventResponseSchema` | `bearer` | No | `[401, 404, 422, 429, 500]` |
| `events_list` | `GET` | `/api/v1/events` | `PaginationQuerySchema` | `WireCanonicalEventListResponseSchema`| `bearer` | No | `[401, 422, 500]` |
| `compat_orders_create` | `POST` | `/compat/razorpay/v1/orders` | `CompatCreateOrderRequestSchema` | `CompatOrderResponseSchema` | `basic` | **Yes** | `[400, 401, 422, 500]` |
| `compat_orders_get_by_id` | `GET` | `/compat/razorpay/v1/orders/:id` | None | `CompatOrderResponseSchema` | `basic` | No | `[401, 404, 500]` |
| `compat_checkout_sessions_create`| `POST` | `/compat/razorpay/v1/orders/:id/checkout-sessions`| `CreateCheckoutSessionRequestSchema`| `CreateCheckoutSessionResponseSchema`| `basic` | **Yes** | `[401, 404, 409, 422, 500]` |
| `compat_unsupported_fallback` | `*` | `/compat/razorpay/v1/refunds` | None | `StandardErrorEnvelopeSchema` | `basic` | No | `[501]` |

An automated regression test in [`packages/contracts/tests/contracts.test.ts`](file:///e:/All%20Project/Paysim/packages/contracts/tests/contracts.test.ts) asserts the validity, non-emptiness, and executable schema status of every entry in `API_ROUTE_MANIFEST`.

---

## 6. Credential & Secret Confinement

1. **One-Time Disclosure Verified:**
   - Native Bearer token disclosed once via `NativeCredentialResponseSchema`.
   - Compatibility `keySecret` disclosed once via `CompatCredentialResponseSchema`.
   - Webhook signing secret disclosed once via `CreateWebhookEndpointResponseSchema` and `RotateEndpointSecretResponseSchema`.
2. **Overview Shielding Enforced:**
   - `CredentialsOverviewResponseSchema` uses `NativeCredentialSummarySchema` and `CompatCredentialSummarySchema`. Both reject unexpected fields (`.strict()`) and prohibit raw secrets.
3. **Log Redaction Utilities in `@paysim/shared`:**
   - [`redactSensitiveHeaders()`](file:///e:/All%20Project/Paysim/packages/shared/src/index.ts): Replaces values of `Authorization`, `Cookie`, `X-PaySim-CSRF`, etc., with `[REDACTED]`.
   - [`redactSensitiveObject()`](file:///e:/All%20Project/Paysim/packages/shared/src/index.ts): Recursively traverses JSON objects to redact keys containing `token`, `secret`, `keySecret`, `csrftoken`.
4. **Error Envelope Safety:**
   - `StandardErrorEnvelopeSchema` formats only `code`, `message`, `requestId`, and `details: [{ field, message, code }]`. It contains zero secret fields.

---

## 7. Quality Gate Execution Evidence

All quality gates passed with exit code `0`:

```powershell
# 1. Clean installation
npm.cmd ci
# Exit Code: 0 (324 packages synced in 3s)

# 2. Type check
npm.cmd run typecheck
# Exit Code: 0 (tsc --build clean)

# 3. Lint check
npm.cmd run lint
# Exit Code: 0 (0 errors, 0 warnings across all packages and apps)

# 4. Vitest execution
npm.cmd test
# Exit Code: 0 (72 passed -> 77 passed across 7 test files in 634ms)

# 5. Production build
npm.cmd run build
# Exit Code: 0 (All packages and apps built cleanly)

# 6. Test fixture check
# All 4 files intact: 333 B, 474 B, 293 B, 389 B
```

---

## 8. Conclusion

All objectives of Phase 03.2.3 have been met without architectural drift. Contract integrity, dynamic port protection, and route coverage are formally sealed.
