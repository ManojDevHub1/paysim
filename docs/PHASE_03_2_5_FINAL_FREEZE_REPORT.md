# PAYSIM — Phase 03.2.5 Final Contract Freeze & Security Corrections Report

**Document Version:** 1.0.0  
**Phase:** Phase 03.2.5 — Final Contract Freeze & Security Corrections  
**Status:** Certified & Package Frozen  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`) | System Architecture (`docs/SYSTEM_ARCHITECTURE.md`) | ADR-003, ADR-005, ADR-007 (`docs/ARCHITECTURE_DECISION_REGISTER.md`)  
**Auditor & Architect:** Principal Software Architect & Security Engineer  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Freeze Context

Phase 03.2.5 establishes the definitive engineering freeze for [`@paysim/contracts`](file:///e:/All%20Project/Paysim/packages/contracts) and implements memory-isolated cryptographic storage primitives in [`@paysim/storage-memory`](file:///e:/All%20Project/Paysim/packages/storage-memory). All remaining route manifest discrepancies, secret vault boundaries, version retention lifecycles, and route error status mappings have been programmatically reconciled and audited against the normative baseline.

### Key Architectural Resolutions:
1. **Route Manifest Exact Counting & Category Reconciliation:**
   - Programmatically verified 31 concrete routes in [`API_ROUTE_MANIFEST`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts).
   - Validated category-wise breakdown: `system: 1`, `control: 6`, `native: 19`, `checkout: 2`, `compat: 3` (Sum: 31).
   - Reconciled the historical 30-vs-31 count: Phase 03.2.3 counted 30 entries (including a wildcard fallback route, but missing `webhook_endpoints_get_by_id` and the credentials overview alias). Phase 03.2.4 extracted the wildcard policy (-1) and added the two missing routes (+2), arriving at exactly 31 concrete routes.
2. **Cryptographic Secret Storage Separation (`WebhookSecretVault` vs `IdempotencyStore`):**
   - Implemented [`WebhookSecretVault`](file:///e:/All%20Project/Paysim/packages/storage-memory/src/vaults.ts): holds raw secrets in `Buffer` instances, creates short-lived opaque disclosure references (`disc_ps_...`), enforces 60-second recovery TTL, and provides best-effort memory zeroization (`zeroizeBuffer`).
   - Implemented [`IdempotencyStore`](file:///e:/All%20Project/Paysim/packages/storage-memory/src/idempotency.ts): stores request fingerprints (SHA-256), response metadata, and opaque disclosure references while **never storing raw secrets**.
   - Valid identical retries reconstruct the rotation response via the vault disclosure reference; conflicting fingerprints return `409 IDEMPOTENCY_KEY_REUSED`.
3. **Dynamic Secret Version Retention Lifecycle:**
   - Replaced fixed two-version retention with dynamic reference tracking across delivery states.
   - Versions are retained while referenced by:
     - Queued deliveries (`status === 'pending'`)
     - In-flight deliveries (`status === 'in_progress'`)
     - Failed retry-eligible deliveries (`status === 'failed'`)
     - Exhausted deliveries with remaining manual retry budget (`status === 'exhausted' && manualRetriesRemaining > 0`)
   - Eviction occurs if and only if `version !== activeVersion` and eligible reference count is 0.
   - Enforced Replay Secret Binding: replaying an event always creates a delivery bound strictly to the endpoint's **currently active** secret version.
4. **Route Status & Fallback Policy Corrections:**
   - Codified `successStatus` across all 31 routes.
   - `GET /health`: `successStatus: 200`, `expectedErrorStatuses: [500]`.
   - `POST /api/v1/webhook-endpoints/:id/rotate-secret`: includes `409 IDEMPOTENCY_KEY_REUSED` and all normative error statuses (`[400, 401, 404, 409, 422, 429, 500]`).
   - `COMPAT_UNSUPPORTED_FALLBACK_POLICY`: returns 501 for 8 known unsupported Razorpay features; specifies 404 for unmapped paths and 405 for disallowed HTTP methods.
5. **Runtime Boundary Classification:**
   - Strictly separated contracts/schema validation (**PASS**) from deferred runtime implementations (**DEFERRED**).
6. **Automated Test Suite Expansion:**
   - Added 13 new unit tests across storage, retention, vault zeroization, and idempotency recovery, bringing total test count from 77 to 90 passing tests across 7 suites.

---

## 2. Route Manifest Audit & Exact Category Counts

### 2.1 Concrete Route Count Verification

All 31 routes in [`API_ROUTE_MANIFEST`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts) are strictly unique in `id` and `(method, path)`:

```typescript
const categoryCounts: Record<string, number> = {};
for (const route of API_ROUTE_MANIFEST) {
  categoryCounts[route.category] = (categoryCounts[route.category] || 0) + 1;
}
// Yields: { system: 1, control: 6, native: 19, checkout: 2, compat: 3 }
// Sum: 31 concrete routes
```

| Category | Route Count | Endpoints Included |
|:---|:---:|:---|
| **`system`** | 1 | `GET /health` (`health_check`) |
| **`control`** | 6 | `POST /control/v1/session/exchange`, `POST /control/v1/session/logout`, `POST /control/v1/credentials/native/rotate`, `POST /control/v1/credentials/compat/rotate`, `GET /control/v1/credentials` (canonical), `GET /control/v1/credentials/overview` (alias) |
| **`native`** | 19 | `POST /api/v1/orders`, `GET /api/v1/orders/:id`, `GET /api/v1/orders`, `POST /api/v1/orders/:id/payment-attempts`, `GET /api/v1/payments/:id`, `GET /api/v1/payments`, `POST /api/v1/payments/:id/checkout-sessions`, `POST /api/v1/payments/:id/simulate`, `POST /api/v1/payments/:id/resolve`, `POST /api/v1/webhook-endpoints`, `GET /api/v1/webhook-endpoints/:id`, `PATCH /api/v1/webhook-endpoints/:id`, `GET /api/v1/webhook-endpoints`, `POST /api/v1/webhook-endpoints/:id/rotate-secret`, `GET /api/v1/deliveries`, `GET /api/v1/deliveries/:id`, `POST /api/v1/deliveries/:id/retry`, `POST /api/v1/events/:id/replay`, `GET /api/v1/events` |
| **`checkout`** | 2 | `POST /checkout/:sessionId/exchange`, `POST /checkout/:sessionId/rotate-token` |
| **`compat`** | 3 | `POST /compat/razorpay/v1/orders`, `GET /compat/razorpay/v1/orders/:id`, `POST /compat/razorpay/v1/orders/:id/checkout-sessions` |
| **Total** | **31** | — |

### 2.2 Historical 30 vs 31 Reconciliation

- **Phase 03.2.3 Count (30):** Included 1 system, 5 control, 18 native, 2 checkout, and 4 compat (which included a catch-all wildcard `* /compat/razorpay/v1/*`). Total = 30.
- **Phase 03.2.4 Corrections:**
  1. Removed the wildcard route from concrete definitions to prevent HTTP method type corruption: $30 - 1 = 29$.
  2. Codified `GET /api/v1/webhook-endpoints/:id` (`webhook_endpoints_get_by_id`) per PRD Section 11 line 1100: $29 + 1 = 30$ (Native: 18 -> 19).
  3. Codified `GET /control/v1/credentials/overview` (`control_credentials_overview_alias`) to support dashboard alias routing: $30 + 1 = 31$ (Control: 5 -> 6).
- **Result:** Exactly 31 concrete routes, plus 1 separate fallback policy (`COMPAT_UNSUPPORTED_FALLBACK_POLICY`).

---

## 3. Webhook Secret Rotation Security & Vault Storage Architecture

### 3.1 Strict Storage Boundary Separation

```
[Incoming Request: POST /api/v1/webhook-endpoints/:id/rotate-secret]
                         │
                         ▼
             [Idempotency Partition]
            scope: "webhook_secret_rotation"
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
[IdempotencyStore]             [WebhookSecretVault]
 - Key: ik_rotate_001           - Buffer: [0xa1, 0xb2, ...]
 - RequestFingerprint           - Version: 2
 - ResponseMetadata (Safe)      - DisclosureRef: "disc_ps_..."
   { endpointId, v: 2 }           (TTL: 60s, Auto-Expires)
 - disclosureRef: "disc_ps_..." - Zeroization: Buffer.fill(0)
 - NO RAW SECRETS STORED
```

### 3.2 Recovery Protocol

1. **New Request:** Server generates secret $S_2$, stores it in `WebhookSecretVault`, creates a 60-second disclosure reference `disc_ps_...`, stores metadata + `disclosureRef` in `IdempotencyStore`, and returns one-time disclosure response.
2. **Identical Replay (Within 60s):**
   - Fingerprint matches.
   - `IdempotencyStore` resolves `disclosureRef` against `WebhookSecretVault`.
   - Vault returns secret `Buffer`.
   - Server reconstructs response and returns `200 OK` with secret.
3. **Mismatched Replay:**
   - Fingerprint differs.
   - `IdempotencyStore` rejects request with `409 IDEMPOTENCY_KEY_REUSED`.
4. **Replay After Disclosure Expiry (Post-60s):**
   - Vault purged the disclosure reference.
   - Idempotency recovery returns `EXPIRED`; client cannot re-read raw secret, but version $S_2$ remains active in vault.

---

## 4. Webhook Secret Version Retention Lifecycle

### 4.1 Dynamic Reference Invariant Matrix

| Delivery Status | Manual Retries Remaining | Eligible Reference? | Secret Retention Behavior |
|:---|:---:|:---:|:---|
| `pending` (Queued) | Any ($\ge 0$) | **YES** | **RETAINED** in vault; required for attempt 1 |
| `in_progress` (In-flight) | Any ($\ge 0$) | **YES** | **RETAINED** in vault; currently signing/verifying |
| `failed` (Auto-retry eligible) | Any ($\ge 0$) | **YES** | **RETAINED** in vault; required for automatic backoff |
| `exhausted` | $> 0$ (Budget remaining) | **YES** | **RETAINED** in vault; manual retry operation allowed |
| `exhausted` | $= 0$ (Budget depleted) | **NO** | **EVICTABLE**; delivery reached terminal exhaustion |
| `succeeded` (Delivered) | Any | **NO** | **EVICTABLE**; attempt succeeded |
| `rejected` (SSRF/Config) | Any | **NO** | **EVICTABLE**; terminal failure |
| `interrupted` | Any | **NO** | **EVICTABLE**; unrecoverable terminal state |

### 4.2 Eviction & Replay Invariants
1. **Active Version Invariant:** The currently active `secretVersion` of an endpoint is **NEVER** evicted, regardless of whether any deliveries reference it.
2. **Safe Eviction Condition:** A version $V$ can be evicted if and only if:
   $$V \neq V_{\text{active}} \quad \land \quad \sum_{\text{deliveries}} \mathbb{I}(\text{endpointId}, V, \text{eligible}) = 0$$
3. **Zeroization:** Eviction triggers `zeroizeBuffer()`, zeroing the underlying Buffer memory before garbage collection.
4. **Replay Binding:** Event replay creates a brand-new delivery that strictly binds to $V_{\text{active}}$. Replays never bind to historical versions.

---

## 5. Route Status & Fallback Routing Corrections

### 5.1 Route Status Audit

- **`GET /health`:**
  - `successStatus: 200`
  - `expectedErrorStatuses: [500]`
- **`POST /api/v1/webhook-endpoints/:id/rotate-secret`:**
  - `successStatus: 200`
  - `expectedErrorStatuses: [400, 401, 404, 409, 422, 429, 500]`
  - Standard error codes mapped: `MALFORMED_JSON` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `IDEMPOTENCY_KEY_REUSED` (409), `VALIDATION_ERROR` (422), `RESOURCE_LIMIT_REACHED` (429), `INTERNAL_ERROR` (500).

### 5.2 Compatibility Fallback Routing Matrix

In [`COMPAT_UNSUPPORTED_FALLBACK_POLICY`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts):
- **Known Unsupported Provider Domains (501):**
  Requests matching `/compat/razorpay/v1/{refunds, payouts, subscriptions, transfers, invoices, virtual_accounts, items, customers}` return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`.
- **Unmapped Provider Paths (404):**
  Requests to `/compat/razorpay/v1/*` outside the supported subset and outside known unsupported domains return `404 NOT_FOUND` (`unmappedPathStatus: 404`, `unmappedErrorCode: 'NOT_FOUND'`).
- **Disallowed HTTP Methods (405):**
  Requests using an invalid HTTP method on supported endpoints return `405 METHOD_NOT_ALLOWED` (`methodNotAllowedStatus: 405`).

---

## 6. Runtime Boundary Classifications

To ensure strict engineering integrity, all architectural subsystems are classified into their current implementation state:

| Architectural Subsystem | Owning Package / Layer | Current Status | Notes |
|:---|:---|:---:|:---|
| **Static URL Validation** (`LoopbackUrlSchema`) | `@paysim/contracts` | **PASS** | Fully implemented, declarative, 11-vector test suite passing |
| **Runtime Listener Port Validation** (`createLoopbackUrlSchema`) | `@paysim/contracts` | **PASS** | Fully implemented factory, tested with dynamic port bindings |
| **Destination Pre-Flight Validator** (`validateOutboundSocketDestination`) | `@paysim/contracts` | **PASS** | Pure synchronous validator implemented and tested |
| **Express Route Registration** | `apps/server` | **DEFERRED** | Deferred to Phase 03.4; server contains only minimal health check scaffold |
| **Outbound HTTP Dispatcher Socket Confinement** | `packages/domain` / `engine` | **DEFERRED** | Dispatcher hook will be wired during webhook delivery engine implementation |
| **Cryptographic Secret Vault** (`WebhookSecretVault`) | `@paysim/storage-memory` | **PASS** | Implemented, tested with disclosure refs and zeroization |
| **Idempotency Store** (`IdempotencyStore`) | `@paysim/storage-memory` | **PASS** | Implemented, tested with fingerprint conflict & recovery |
| **Secret Retention Coordinator** (`SecretVersionRetentionTracker`) | `@paysim/storage-memory` | **PASS** | Implemented, tested across all delivery status permutations |

---

## 7. Automated Test Suite Results

```
 RUN  v2.1.9 E:/All Project/Paysim

 ✓ packages/crypto/tests/crypto.test.ts (5 tests) 3ms
 ✓ packages/domain/tests/domain.test.ts (1 test) 2ms
 ✓ packages/storage-memory/tests/storage.test.ts (15 tests) 5ms
 ✓ packages/shared/tests/shared.test.ts (7 tests) 29ms
 ✓ tests/smoke.test.ts (5 tests) 3ms
 ✓ apps/server/tests/server.test.ts (2 tests) 27ms
 ✓ packages/contracts/tests/contracts.test.ts (55 tests) 30ms

 Test Files  7 passed (7)
      Tests  90 passed (90)
   Duration  631ms
```

### Key Test Categories Verified:
1. **Route Category Counts:** Programmatically verified 1 system, 6 control, 19 native, 2 checkout, 3 compat = 31 total concrete routes.
2. **Secret Disclosure Vault:** Verified storage of raw Buffer secrets, generation and resolution of short-lived `disc_ps_...` references, and TTL expiry.
3. **Secret Cleanup & Zeroization:** Verified that evicting a version zeroes out underlying Buffer memory.
4. **Idempotency Response Recovery:** Verified that valid replays recover the rotation response without raw secrets being stored in `IdempotencyStore`.
5. **409 Idempotency Conflict:** Verified that mismatched request payloads with the same key return `IDEMPOTENCY_KEY_REUSED`.
6. **Secret Version Reference Tracking:** Verified retention across `pending`, `in_progress`, `failed`, and `exhausted` (budget > 0) deliveries. Verified eviction when budget is 0 or delivery is `succeeded`.
7. **Replay Active Secret Binding:** Verified rejection when trying to bind an event replay to a stale historical secret version.
8. **Health Endpoint Status Mapping:** Verified 200 success and 500 failure status codes.
9. **Fixture Byte Sizes:** Verified exact byte counts (`333 B`, `474 B`, `293 B`, `389 B`).

---

## 8. Remaining Limitations & Contracts Package Freeze Recommendation

### 8.1 Remaining Limitations (Out of Scope for Contracts Freeze)
1. **Express Route Handlers:** No domain controllers or HTTP route handlers currently exist in `apps/server` (deferred to Phase 03.4).
2. **Single RootState Atomic Engine:** Transactional clone-and-swap domain commit loop will be implemented in Phase 03.3.
3. **Dispatcher Socket Hook:** Outbound HTTP request interceptor to call `validateOutboundSocketDestination()` before connecting will be wired in Phase 03.3.

### 8.2 Contracts Package Freeze Recommendation
- All 31 API routes, DTOs, Zod boundary schemas, error codes, and fallback policies are complete, mutually consistent, and mathematically verified.
- **RECOMMENDATION:** **FREEZE `@paysim/contracts`**. No further schema modifications are required. Proceed to Phase 03.3 (Domain State Machine & In-Memory Storage Integration) upon user authorization.
