# PAYSIM — Phase 03.2.4 Final API & Contract Integrity Patch

**Document Version:** 1.0.0  
**Phase:** Phase 03.2.4 — Final API & Contract Integrity Patch  
**Status:** Complete & Fully Validated  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`) | System Architecture (`docs/SYSTEM_ARCHITECTURE.md`) | ADR-003, ADR-005, ADR-007 (`docs/ARCHITECTURE_DECISION_REGISTER.md`)  
**Auditor & Architect:** Principal TypeScript API Architect & Security Engineer  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Audit Context

Phase 03.2.4 resolves the final architectural and contract inconsistencies identified in Phase 03.2.3 across `@paysim/contracts` and `@paysim/shared`. This engineering patch enforces declarative purity in contract schemas, eliminates mutable module-level state, separates wildcard route fallbacks from concrete API endpoints, reconciles control credential paths, codifies the webhook endpoint retrieval endpoint, establishes the operational mechanics of webhook secret rotation idempotency recovery, and executes an exhaustive 11-vector URL security validation suite.

### Key Architectural Resolutions:
1. **Purity of Contract Schemas:** Eliminated mutable global `Set` state (`dynamicRestrictedPorts`) and mutator functions (`registerRestrictedLoopbackPort`). Contract schemas are now pure and declarative. Runtime listener ports are passed via `RuntimeListenerConfig` to the schema factory `createLoopbackUrlSchema()` and socket validator `validateOutboundSocketDestination()`.
2. **Elimination of Wildcard HTTP Method & Fallback Policy Separation:** Removed `"*"` from `HttpMethod` (`'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'`). Wildcard fallback behavior for unsupported Razorpay routes is decoupled from `API_ROUTE_MANIFEST` into a dedicated declarative interface [`COMPAT_UNSUPPORTED_FALLBACK_POLICY`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts), returning `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED` across 8 unsupported Razorpay domains.
3. **Route Manifest Additions & Path Reconciliations:**
   - Codified `GET /api/v1/webhook-endpoints/:id` (`webhook_endpoints_get_by_id`) returning `WebhookEndpointEntitySchema` in conformance with PRD Section 11 line 1100.
   - Reconciled `/control/v1/credentials` (canonical, `control_credentials_overview`) and `/control/v1/credentials/overview` (dashboard alias, `control_credentials_overview_alias`), both using `cookie_csrf` auth and returning `CredentialsOverviewResponseSchema`.
   - Set `supportsIdempotency: true` on `POST /api/v1/webhook-endpoints/:id/rotate-secret`.
   - Certified that all 31 routes in `API_ROUTE_MANIFEST` possess unique route IDs and unique `(method, path)` pairs.
4. **Boundary and Scope Integrity:** Explicitly recorded that runtime Express route registration does not yet exist (deferred to server implementation), and outbound socket protection will be enforced by the webhook engine dispatcher upon its construction.
5. **Webhook Secret Rotation Response-Loss Recovery Specification:** Defined exact mechanics for idempotency key scoping, body fingerprinting, short-lived in-memory response caching, secret version incrementation, and vault retention for pending/in-flight deliveries.
6. **11-Vector URL Security Confinement:** Implemented and verified tests covering literal IPv4, literal IPv6, IPv4-mapped IPv6, IPv6 zone identifiers, port boundaries, userinfo, unsupported protocols, fragments, malformed URLs, static restricted ports, and dynamic runtime-configured ports.

---

## 2. Route Manifest Architecture & Concrete Endpoint Inventory

### 2.1 Decoupling Fallback Policy from Concrete Routes

In earlier revisions, the route manifest contained a catch-all entry with `method: '*'`. This conflated concrete API routing contracts with middleware fallback policies and compromised the type safety of `HttpMethod`.

In Phase 03.2.4:
- `HttpMethod` is strictly defined as:
  ```typescript
  export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  ```
- Unsupported compatibility domain fallback is modeled as a standalone policy object:
  ```typescript
  export interface FallbackRoutePolicy {
    readonly id: string;
    readonly pathPattern: string;
    readonly handlerDescription: string;
    readonly responseSchema: z.ZodTypeAny;
    readonly httpStatus: 501;
    readonly errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED';
    readonly unsupportedDomains: readonly string[];
  }

  export const COMPAT_UNSUPPORTED_FALLBACK_POLICY: FallbackRoutePolicy = Object.freeze({
    id: 'compat_unsupported_fallback_policy',
    pathPattern: '/compat/razorpay/v1/*',
    handlerDescription: 'Fail-closed 501 handler for unsupported Razorpay API domains',
    responseSchema: StandardErrorEnvelopeSchema,
    httpStatus: 501,
    errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
    unsupportedDomains: Object.freeze([
      '/compat/razorpay/v1/refunds',
      '/compat/razorpay/v1/payouts',
      '/compat/razorpay/v1/subscriptions',
      '/compat/razorpay/v1/transfers',
      '/compat/razorpay/v1/invoices',
      '/compat/razorpay/v1/virtual_accounts',
      '/compat/razorpay/v1/items',
      '/compat/razorpay/v1/customers',
    ]),
  });
  ```

### 2.2 Complete Authoritative Route Inventory (31 Concrete Routes)

All 31 concrete routes defined in [`packages/contracts/src/manifest.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts) are strictly unique in both `id` and `(method, path)`:

| # | Route ID | Method | Path | Auth Scheme | Idempotent | Expected Statuses | Category |
|:---:|:---|:---:|:---|:---|:---:|:---|:---|
| 1 | `health_check` | `GET` | `/health` | `none` | No | 500 | `system` |
| 2 | `control_session_exchange` | `POST` | `/control/v1/session/exchange` | `one_time_token` | No | 400, 401, 422, 500 | `control` |
| 3 | `control_session_logout` | `POST` | `/control/v1/session/logout` | `cookie_csrf` | No | 401, 403, 500 | `control` |
| 4 | `control_credentials_native_rotate` | `POST` | `/control/v1/credentials/native/rotate` | `cookie_csrf` | No | 401, 403, 429, 500 | `control` |
| 5 | `control_credentials_compat_rotate` | `POST` | `/control/v1/credentials/compat/rotate` | `cookie_csrf` | No | 401, 403, 429, 500 | `control` |
| 6 | `control_credentials_overview` | `GET` | `/control/v1/credentials` | `cookie_csrf` | No | 401, 403, 500 | `control` |
| 7 | `control_credentials_overview_alias` | `GET` | `/control/v1/credentials/overview` | `cookie_csrf` | No | 401, 403, 500 | `control` |
| 8 | `orders_create` | `POST` | `/api/v1/orders` | `bearer` | **Yes** | 400, 401, 409, 422, 429, 500 | `native` |
| 9 | `orders_get_by_id` | `GET` | `/api/v1/orders/:id` | `bearer` | No | 401, 404, 500 | `native` |
| 10 | `orders_list` | `GET` | `/api/v1/orders` | `bearer` | No | 401, 422, 500 | `native` |
| 11 | `payment_attempts_create` | `POST` | `/api/v1/orders/:id/payment-attempts` | `bearer` | **Yes** | 400, 401, 404, 409, 422, 429, 500 | `native` |
| 12 | `payments_get_by_id` | `GET` | `/api/v1/payments/:id` | `bearer` | No | 401, 404, 500 | `native` |
| 13 | `payments_list` | `GET` | `/api/v1/payments` | `bearer` | No | 401, 422, 500 | `native` |
| 14 | `checkout_sessions_reissue` | `POST` | `/api/v1/payments/:id/checkout-sessions` | `bearer` | **Yes** | 401, 404, 409, 422, 429, 500 | `native` |
| 15 | `payments_simulate_outcome` | `POST` | `/api/v1/payments/:id/simulate` | `bearer` | No | 401, 404, 409, 422, 500 | `native` |
| 16 | `payments_resolve_pending` | `POST` | `/api/v1/payments/:id/resolve` | `bearer` | No | 401, 404, 409, 422, 500 | `native` |
| 17 | `checkout_capability_exchange` | `POST` | `/checkout/:sessionId/exchange` | `capability_token` | No | 400, 404, 409, 410, 422, 500 | `checkout` |
| 18 | `checkout_token_rotate` | `POST` | `/checkout/:sessionId/rotate-token` | `bearer` | No | 401, 404, 409, 410, 500 | `checkout` |
| 19 | `webhook_endpoints_create` | `POST` | `/api/v1/webhook-endpoints` | `bearer` | No | 400, 401, 422, 429, 500 | `native` |
| 20 | `webhook_endpoints_get_by_id` | `GET` | `/api/v1/webhook-endpoints/:id` | `bearer` | No | 401, 404, 500 | `native` |
| 21 | `webhook_endpoints_patch` | `PATCH` | `/api/v1/webhook-endpoints/:id` | `bearer` | No | 400, 401, 404, 422, 500 | `native` |
| 22 | `webhook_endpoints_list` | `GET` | `/api/v1/webhook-endpoints` | `bearer` | No | 401, 422, 500 | `native` |
| 23 | `webhook_endpoints_rotate_secret` | `POST` | `/api/v1/webhook-endpoints/:id/rotate-secret` | `bearer` | **Yes** | 401, 404, 429, 500 | `native` |
| 24 | `deliveries_list` | `GET` | `/api/v1/deliveries` | `bearer` | No | 401, 422, 500 | `native` |
| 25 | `deliveries_get_by_id` | `GET` | `/api/v1/deliveries/:id` | `bearer` | No | 401, 404, 500 | `native` |
| 26 | `deliveries_retry` | `POST` | `/api/v1/deliveries/:id/retry` | `bearer` | No | 401, 404, 409, 429, 500 | `native` |
| 27 | `events_replay` | `POST` | `/api/v1/events/:id/replay` | `bearer` | No | 401, 404, 422, 429, 500 | `native` |
| 28 | `events_list` | `GET` | `/api/v1/events` | `bearer` | No | 401, 422, 500 | `native` |
| 29 | `compat_orders_create` | `POST` | `/compat/razorpay/v1/orders` | `basic` | **Yes** | 400, 401, 422, 500 | `compat` |
| 30 | `compat_orders_get_by_id` | `GET` | `/compat/razorpay/v1/orders/:id` | `basic` | No | 401, 404, 500 | `compat` |
| 31 | `compat_checkout_sessions_create` | `POST` | `/compat/razorpay/v1/orders/:id/checkout-sessions` | `basic` | **Yes** | 401, 404, 409, 422, 500 | `compat` |

> [!IMPORTANT]
> **Runtime Route Registration Boundary:** The route manifest defines the normative contract boundary. Concrete Express router bindings do not yet exist in `apps/server` and will be implemented during Phase 03.4.

---

## 3. Webhook Endpoint Verification & Path Reconciliation

### 3.1 Verification of `GET /api/v1/webhook-endpoints/:id`

In PRD v2.3.0 Section 11 (line 1100), the webhook management API specifies single-endpoint retrieval. This endpoint was verified and added to the manifest:
- **Route ID:** `webhook_endpoints_get_by_id`
- **Method & Path:** `GET /api/v1/webhook-endpoints/:id`
- **Authentication:** `bearer` (Native API Bearer Token)
- **Request Schema:** `null`
- **Response Schema:** [`WebhookEndpointEntitySchema`](file:///e:/All%20Project/Paysim/packages/contracts/src/endpoints.ts)
- **Expected Error Statuses:** `[401, 404, 500]`
- **Secret Disclosure:** Zero. The returned entity exposes only `id`, `url`, `mode`, `events`, `status`, `secretVersion`, `createdAt`, and `updatedAt`. The signing secret is never returned on GET operations.

### 3.2 Credentials Overview Route Reconciliation

To maintain backwards compatibility with dashboard routing conventions while adhering to REST canonical path standards:
- **Canonical Route:** `GET /control/v1/credentials` (`control_credentials_overview`)
- **Dashboard Alias:** `GET /control/v1/credentials/overview` (`control_credentials_overview_alias`)
- Both endpoints:
  - Are strictly authenticated via `cookie_csrf` (Session cookie + `X-PAYSIM-CSRF-TOKEN` header).
  - Enforce `supportsIdempotency: false`.
  - Validate response through [`CredentialsOverviewResponseSchema`](file:///e:/All%20Project/Paysim/packages/contracts/src/credentials.ts).
  - Expose only masked key prefixes (`keyId`, `redactedSecret`, `tokenPrefix`) and zero raw secrets.

---

## 4. Pure Dynamic Listener Port Protection Architecture

### 4.1 Separation of Validation Layers

Global mutable state in schema definitions violates functional purity and risks test pollution. In Phase 03.2.4, port security is decoupled into four clean layers:

```
[Layer 1: Static Contract Validation]
  LoopbackUrlSchema (Pure declarative schema with static constants)
         │
[Layer 2: Runtime Listener Configuration]
  RuntimeListenerConfig (Read-only object containing active ports)
         │
[Layer 3: Runtime Destination Authorization]
  createLoopbackUrlSchema(config) (Factory returning bound Zod schema)
         │
[Layer 4: Outbound Socket Dispatch Validation]
  validateOutboundSocketDestination(url, config) (Pre-connection socket gate)
```

### 4.2 Layer Specifications

1. **Static URL Validation (`LoopbackUrlSchema`):**
   - Pure, immutable Zod schema.
   - Enforces literal IPv4 (`127.0.0.1`) or IPv6 (`[::1]`).
   - Requires explicit numeric port within unprivileged range `[1024, 65535]`.
   - Rejects static reserved ports: `8787` (server), `5173` (web UI), `2375`, `2376`, `4243`, `5000` (Docker/host daemons).
   - Rejects userinfo, fragments, and DNS hostnames.

2. **Runtime Listener Configuration (`RuntimeListenerConfig`):**
   ```typescript
   export interface RuntimeListenerConfig {
     readonly backendPort?: number;
     readonly frontendPort?: number;
     readonly additionalRestrictedPorts?: readonly number[];
   }
   ```

3. **Runtime Destination Authorization (`createLoopbackUrlSchema`):**
   - Factory function producing a declarative Zod schema configured with the active listener ports of the running process.
   - Enables dynamic CLI or environment port overrides (`--port 9001`) without global state mutation.

4. **Final Outbound Socket Validation (`validateOutboundSocketDestination`):**
   - Pure synchronous validation function returning `{ valid: boolean, error?: string, port?: number, hostname?: string }`.
   - To be invoked by the HTTP dispatcher immediately prior to establishing the outbound TCP socket connection.

> [!NOTE]
> Outbound socket dispatcher protection is not claimed to be active until the dispatcher engine is implemented in Phase 03.3.

---

## 5. Webhook Secret Rotation Response-Loss Recovery Specification

### 5.1 The Edge Case & Risk
When rotating a webhook signing secret (`POST /api/v1/webhook-endpoints/:id/rotate-secret`), the server generates a new cryptographic secret, increments the version, and returns the raw secret in a one-time disclosure response. If the client experiences a network disconnect or client crash before receiving the response:
- The secret has been rotated on the server.
- The client does not possess the new secret.
- In-flight deliveries signed with the new secret will fail verification on the client.
- Re-requesting rotation without idempotency would orphan the secret again and advance the version unnecessarily.

### 5.2 Normative Idempotency Recovery Mechanics

To ensure crash-resilient secret rotation, `webhook_endpoints_rotate_secret` is configured with `supportsIdempotency: true`:

1. **Idempotency Key Scoping:**
   $$\text{Scope} = \text{credentialId} \parallel \text{":"} \parallel \text{routePath} \parallel \text{":"} \parallel \text{idempotencyKey}$$
   Ensures that an idempotency key cannot collide across different endpoints, credentials, or HTTP verbs.

2. **Request Fingerprinting:**
   $$\text{Fingerprint} = \text{SHA-256}(\text{canonicalSortedJSON}(\text{body}))$$
   Guarantees that a replay with a modified payload (e.g. different rotation reason) is rejected with `409 IDEMPOTENCY_KEY_REUSED`.

3. **Short-Lived Cached Response Recovery:**
   - On initial execution, the server generates secret $S_{v+1}$, stores it in `WebhookVault`, commits the new `secretVersion`, and caches the exact response envelope in the in-memory `IdempotencyStore` for the standard TTL window (60 seconds).
   - If a retry request arrives with the identical `Idempotency-Key` and fingerprint within the TTL window, the server returns the **cached response containing $S_{v+1}$** without re-rotating or modifying state.

4. **Secret Versioning in `WebhookVault`:**
   - `WebhookVault` retains historical secret versions $(S_v, S_{v-1}, \dots)$ for all active, queued, and retryable webhook deliveries.
   - Deliveries created prior to rotation continue to be signed or verified using the secret version active at event creation time, preventing retry delivery corruption (`DELIVERY_SNAPSHOT_UNAVAILABLE`).

---

## 6. URL Security Validation Results (11 Vectors)

All 11 URL security vectors mandated by Step 5 were implemented in [`packages/contracts/tests/contracts.test.ts`](file:///e:/All%20Project/Paysim/packages/contracts/tests/contracts.test.ts) and executed via Vitest:

| # | Security Vector | Test Input Example | Expected Outcome | Result |
|:---:|:---|:---|:---:|:---:|
| 1 | **IPv4 Loopback** | `http://127.0.0.1:8080/webhook` | ACCEPT | **PASS** |
| 2 | **IPv6 Loopback** | `http://[::1]:8080/webhook` | ACCEPT | **PASS** |
| 3 | **IPv4-Mapped IPv6** | `http://[::ffff:127.0.0.1]:8080/webhook` | REJECT | **PASS** |
| 4 | **IPv6 Zone Identifiers** | `http://[::1%eth0]:8080/webhook` | REJECT | **PASS** |
| 5 | **Invalid Port Boundaries** | Missing port, `port=0`, `port=80`, `port=1023`, `port=65536` | REJECT | **PASS** |
| 6 | **Embedded Userinfo** | `http://user:pass@127.0.0.1:8080/webhook` | REJECT | **PASS** |
| 7 | **Unsupported Protocols** | `ftp:`, `ws:`, `wss:`, `gopher:` | REJECT | **PASS** |
| 8 | **URL Fragments** | `http://127.0.0.1:8080/webhook#section` | REJECT | **PASS** |
| 9 | **Malformed / Named URLs** | `http://localhost:8080`, `http://`, `http://192.168.1.100` | REJECT | **PASS** |
| 10 | **Static Restricted Ports** | `8787`, `5173`, `2375`, `2376`, `4243`, `5000` | REJECT | **PASS** |
| 11 | **Runtime Listener Ports** | Configured `backendPort: 9001`, `frontendPort: 5174` | REJECT | **PASS** |

---

## 7. Files Modified & Diffs Summary

### 7.1 Packages & Files Modified
- [`packages/contracts/src/common.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/common.ts):
  - Removed mutable global `dynamicRestrictedPorts` set and mutating helper functions.
  - Added pure `validateOutboundSocketDestination(rawUrl, runtimeConfig)` function.
  - Added declarative factory `createLoopbackUrlSchema(runtimeConfig)`.
  - Added `RuntimeListenerConfig` interface.
- [`packages/contracts/src/manifest.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts):
  - Restricted `HttpMethod` to `'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'`.
  - Separated `COMPAT_UNSUPPORTED_FALLBACK_POLICY` from concrete `API_ROUTE_MANIFEST`.
  - Added `webhook_endpoints_get_by_id` (`GET /api/v1/webhook-endpoints/:id`).
  - Added `control_credentials_overview_alias` (`GET /control/v1/credentials/overview`).
  - Set `supportsIdempotency: true` on `webhook_endpoints_rotate_secret`.
- [`packages/contracts/tests/contracts.test.ts`](file:///e:/All%20Project/Paysim/packages/contracts/tests/contracts.test.ts):
  - Updated imports to use pure validators and fallback policy.
  - Added exhaustive 11-point URL security validation test.
  - Updated route manifest test to verify 31 unique routes, unique `(method, path)` pairs, fallback policy, and idempotency flags.
- [`packages/shared/src/index.ts`](file:///e:/All%20Project/Paysim/packages/shared/src/index.ts):
  - Implemented `redactSensitiveHeaders` and `redactSensitiveObject`.
- [`packages/shared/tests/shared.test.ts`](file:///e:/All%20Project/Paysim/packages/shared/tests/shared.test.ts):
  - Tested header and object redaction utilities (7 passing tests).

---

## 8. Monorepo Verification Results

| Verification Check | Target | Execution Command | Result |
|:---|:---|:---|:---:|
| **Dependency Integrity** | Monorepo Root | `npm.cmd ci` | **PASS** |
| **Typecheck** | All Workspaces | `npm.cmd run typecheck` (`tsc --build`) | **PASS** |
| **Linting** | All Workspaces | `npm.cmd run lint` (`eslint .`) | **PASS** |
| **Unit & Contract Tests** | 7 Test Suites | `npm.cmd test` (`vitest run`) | **PASS** (77/77 tests) |
| **Build Pipeline** | Packages & Web UI | `npm.cmd run build` | **PASS** |
| **Fixture Byte Sizes** | `fixtures/` | `Get-ChildItem -Recurse fixtures` | **PASS** (333B, 474B, 293B, 389B) |

---

## 9. Gate Review & Authorization Status

Phase 03.2.4 completes the contracts package hardening. In accordance with release governance guidelines:
- **Phase 03.2.4 Status:** `PASS`
- **Phase 03.3 Execution:** `DEFERRED` — Awaiting explicit user authorization before commencing domain and state machine implementation.
