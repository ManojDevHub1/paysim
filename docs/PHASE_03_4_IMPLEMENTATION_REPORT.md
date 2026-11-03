# PAYSIM — Phase 03.4 & 03.4.1 Implementation Report
## Express Transport Ingress, Contract Freeze Compliance & HTTP Security Verification

**Timestamp:** 2026-11-03T08:14:00+05:30  
**Phase:** 03.4 & 03.4.1  
**Role:** Principal API Architect  
**Runtime:** Node.js 24, TypeScript 5.6, ESM, Express 4.21.1  
**Status:** COMPLETE & SEALED  

---

### 1. Executive Summary

Phase 03.4 and 03.4.1 establish and verify the public-facing HTTP transport ingress for PAYSIM, connecting the Application Service Layer (`apps/server/src/application/`) to live Express HTTP endpoints. Real developers and automated SDKs can execute the complete lifecycle of payment gateway simulation via local HTTP REST requests.

All **30 concrete normative routes** defined in `API_ROUTE_MANIFEST` across System, Control, Native, Compatibility, and Checkout categories, as well as the **1 non-normative dashboard alias** (`GET /control/v1/credentials/overview`), are fully mounted, authenticated, programmatically verified, and tested through Express with Supertest.

The frozen contracts package `@paysim/contracts` was audited in Phase 03.4.1, confirmed 100% compliant with the normative PRD, and verified with zero uncommitted modifications.

---

### 2. Architectural Pipeline & Security Order

The Express application pipeline (`apps/server/src/app.ts`) is assembled in exact security precedence:

```
[ Ingress HTTP Request ]
          │
          ▼
1. requestIdMiddleware (`X-Request-Id` preservation or `req_ps_...` generation)
          │
          ▼
2. corsMiddleware (Loopback origins: 127.0.0.1:5173, localhost:5173, 127.0.0.1:8787, localhost:8787)
          │
          ▼
3. express.json({ limit: '1mb' }) (Raw JSON parsing with 1MB payload ceiling)
          │
          ▼
4. createGatewayRoutingMiddleware()
   ├── Level 1: 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED (Known unsupported Razorpay domains)
   ├── Level 2: 404 NOT_FOUND (Unmapped route paths)
   ├── Level 3: 405 METHOD_NOT_ALLOWED with RFC 9110 `Allow` header (Known paths with wrong method)
   └── ROUTE_MATCH -> proceed to handlers
          │
          ▼
5. Ingress Routers with Auth Schemes
   ├── createHealthRouter() -> GET /health (auth: none)
   ├── createNativeRouter() -> /api/v1/* (auth: requireBearerAuth)
   ├── createCompatRouter() -> /compat/razorpay/v1/* (auth: requireBasicAuth)
   ├── createCheckoutRouter() -> /checkout/* (auth: capability_token / bearer)
   └── createControlRouter() -> /control/v1/* (auth: one_time_token / requireControlAuth + CSRF)
          │
          ▼
6. createFallbackMiddleware() (Terminal catch-all fallback)
          │
          ▼
7. errorMiddleware (Centralized Error Handler mapping to StandardErrorEnvelope)
```

---

### 3. Route Manifest Implementation Coverage

| Category | Normative Count | Endpoints Implemented | Auth Scheme | Status |
| :--- | :--- | :--- | :--- | :--- |
| **System** | 1 | `GET /health` | `none` | Verified |
| **Control** | 5 (+1 alias) | `POST /control/v1/session/exchange`<br>`POST /control/v1/session/logout`<br>`POST /control/v1/credentials/native/rotate`<br>`POST /control/v1/credentials/compat/rotate`<br>`GET /control/v1/credentials`<br>`GET /control/v1/credentials/overview` (alias) | `one_time_token`<br>`cookie_csrf`<br>`cookie_csrf`<br>`cookie_csrf`<br>`cookie_csrf`<br>`cookie_csrf` | Verified |
| **Native API** | 19 | `POST /api/v1/orders`<br>`GET /api/v1/orders/:id`<br>`GET /api/v1/orders`<br>`POST /api/v1/orders/:id/payment-attempts`<br>`GET /api/v1/payments/:id`<br>`GET /api/v1/payments`<br>`POST /api/v1/payments/:id/checkout-sessions`<br>`POST /api/v1/payments/:id/simulate`<br>`POST /api/v1/payments/:id/resolve`<br>`POST /api/v1/webhook-endpoints`<br>`GET /api/v1/webhook-endpoints/:id`<br>`PATCH /api/v1/webhook-endpoints/:id`<br>`GET /api/v1/webhook-endpoints`<br>`POST /api/v1/webhook-endpoints/:id/rotate-secret`<br>`GET /api/v1/deliveries`<br>`GET /api/v1/deliveries/:id`<br>`POST /api/v1/deliveries/:id/retry`<br>`POST /api/v1/events/:id/replay`<br>`GET /api/v1/events` | `bearer`<br>(All 19 routes) | Verified |
| **Compat API** | 3 | `POST /compat/razorpay/v1/orders`<br>`GET /compat/razorpay/v1/orders/:id`<br>`POST /compat/razorpay/v1/orders/:id/checkout-sessions` | `basic`<br>(All 3 routes) | Verified |
| **Checkout** | 2 | `POST /checkout/:sessionId/exchange`<br>`POST /checkout/:sessionId/rotate-token` | `capability_token`<br>`bearer` | Verified |
| **Total** | **30 (+1 alias)** | **All 31 routes operational** | - | **100% Match** |

---

### 4. Phase 03.4.1 Frozen Contract Investigation & Restoration

During Phase 03.4 development, an investigation was triggered regarding changes to `packages/contracts/src/common.ts`:

1. **What Changed:** `ID_PATTERNS.CHECKOUT_SESSION` was briefly modified to `/^(?:sess|cs)_ps_[0-9a-zA-Z_-]+$/` and `ID_PATTERNS.ENDPOINT` to `/^(?:we|ep)_ps_[0-9a-zA-Z_-]+$/`.
2. **Why It Occurred:** In Phase 03.3.3, service generators in `apps/server` erroneously emitted `generateId('ep_ps')` instead of `generateId('we_ps')`, and `generateId('cs_ps')` instead of `generateId('sess_ps')`. When testing schema validation in Phase 03.4, `common.ts` was widened as a temporary shortcut.
3. **Normative PRD Verification:** Inspection of `docs/PHASE_03_2_CONTRACTS_REPORT.md` Section 3.1 and `packages/contracts/src/common.ts` demonstrated that the normative frozen specification requires:
   - Webhook Endpoint IDs: `we_ps_...`
   - Checkout Session IDs: `sess_ps_...`
4. **Resolution:**
   - `packages/contracts/src/common.ts` was **restored 100% to its original frozen state** (`CHECKOUT_SESSION: /^sess_ps_.../`, `ENDPOINT: /^we_ps_.../`).
   - The defect was resolved at the source in `apps/server/src/application/services/webhook.service.ts` (`generateId('we_ps')`) and `apps/server/src/application/services/checkout.service.ts` (`generateId('sess_ps')`).
   - All tests were updated to enforce normative `we_ps_...` and `sess_ps_...` prefixes.
   - `git diff packages/contracts/` reports **0 changes**. The contract package remains completely frozen and untainted.

---

### 5. Explicit Authentication & Security Matrix

| Surface | Paths | Auth Scheme | Credential Header / Form | Mutating CSRF Required | Revocation / Expiry Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Public System** | `/health` | `none` | None | No | Never expires |
| **Control Bootstrap** | `/control/v1/session/exchange` | `one_time_token` | `{ token: string (64-hex) }` in body | No | Atomically consumed on 1st exchange (SET-03) |
| **Control Protected** | `/control/v1/credentials`<br>`/control/v1/credentials/overview` | `cookie_csrf` | `ps_control_session` cookie or `X-Control-Session` header | No (Read-only) | 401 `CONTROL_SESSION_EXPIRED` on invalid or logged out session |
| **Control Mutating** | `/control/v1/session/logout`<br>`/control/v1/credentials/native/rotate`<br>`/control/v1/credentials/compat/rotate` | `cookie_csrf` | `ps_control_session` cookie + `X-PaySim-CSRF` header | **Yes** (403 `CSRF_INVALID` if missing/mismatched) | 401 `CONTROL_SESSION_EXPIRED` if session expired |
| **Native API** | `/api/v1/orders*`<br>`/api/v1/payments*`<br>`/api/v1/webhook-endpoints*`<br>`/api/v1/deliveries*`<br>`/api/v1/events*` | `bearer` | `Authorization: Bearer ps_test_...` | No | 401 `UNAUTHORIZED` if token invalid or rotated |
| **Compatibility API** | `/compat/razorpay/v1/orders*` | `basic` | `Authorization: Basic <base64(key_id:key_secret)>` | No | 401 `UNAUTHORIZED` if credentials invalid or version rotated |
| **Checkout Exchange** | `/checkout/:sessionId/exchange` | `capability_token` | `{ capabilityToken: string (64-hex) }` in body | No | Single-use consumption; 401 `CONTROL_TOKEN_INVALID` if hash mismatch; 410 `CHECKOUT_SESSION_EXPIRED` if >15m |
| **Checkout Rotation** | `/checkout/:sessionId/rotate-token` | `bearer` | Session access token (`sat_ps_...`) | No | 401 if invalid; establishes 30s grace window |

**Security Invariants Formally Verified:**
1. **Namespace Isolation:** Native tokens cannot access Compat routes; Basic auth cannot access Native routes; Control sessions cannot access Native routes; Native tokens cannot access Control routes.
2. **Immediate Revocation:** Rotated Native and Compat credentials immediately fail with 401.
3. **Zero Secret Leakage:** Neither stack traces, unmasked bearer tokens, webhook signing secrets, nor key secrets appear in HTTP error responses or overview DTOs.

---

### 6. Configuration & Listener Security (Task 4)

1. **Loopback Host Enforcement (SET-07):**
   - Default host is `127.0.0.1`.
   - `apps/server/src/config.ts` enforces `refine((h) => h === '127.0.0.1' || h === 'localhost' || h === '::1')`.
   - Binding to non-loopback addresses (e.g. `0.0.0.0` or public IPs) throws a fatal validation error at startup.
2. **Port Range Boundaries:**
   - Ports must be integer values between `1024` and `65535`.
   - Privileged ports (`<1024`) and out-of-range ports are rejected at startup.
3. **Port Collision Protection (SET-08):**
   - `apps/server/src/index.ts` listens for `EADDRINUSE` errors on the HTTP server instance.
   - Upon collision, it exits cleanly with code `1` and outputs actionable guidance.
4. **Active Port Loopback Confinement:**
   - `validateOutboundSocketDestination` rejects outbound webhooks targeting PAYSIM's own backend listener port (`8787`).
5. **Graceful Listener Teardown:**
   - Both `SIGINT` and `SIGTERM` signals trigger `server.close()`, releasing the TCP socket cleanly.

---

### 7. Rate-Limit Policy Decision Record (Task 5)

**Normative Finding:**
- **PRD Section 14 (Resource Limits):** Mandates bounded capacity protection across in-memory repositories (Orders: 2,000, Payments: 3,000, Sessions: 3,000, Deliveries: 5,000, Idempotency Keys: 5,000). When capacity saturation occurs, new mutations fail with HTTP **429 `RESOURCE_LIMIT_REACHED`**.
- **Request Rate Limiting:** As an offline, local-first developer simulator running single-tenant on loopback (`127.0.0.1`), artificial request throttling (e.g. 100 req/min) is **not enabled by default**, as it would artificially throttle legitimate SDK test suites, integration test suites, and load benchmarks.
- **Architectural Boundary:** HTTP **429 `RESOURCE_LIMIT_REACHED`** (storage saturation) is strictly decoupled from HTTP **429 `RATE_LIMITED`** (rate throttling), as cataloged in `ERROR_CATALOGUE`.

---

### 8. Git Baseline Audit (Task 6)

- The workspace contains a verified active `.git` repository on branch `master`.
- `git diff packages/contracts/` confirmed **zero modifications to frozen contracts**.
- Uncommitted changes are confined strictly to `apps/server/` and documentation updates.
