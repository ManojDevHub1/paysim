# PAYSIM — Phase 03.2.6 Final Contract Freeze Audit Report

**Document Version:** 1.0.0  
**Phase:** Phase 03.2.6 — Final Contract Freeze Audit  
**Status:** Complete & Certified  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`) | System Architecture (`docs/SYSTEM_ARCHITECTURE.md`) | ADR-003, ADR-005, ADR-007 (`docs/ARCHITECTURE_DECISION_REGISTER.md`)  
**Auditor & Architect:** Principal TypeScript API Architect  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Audit Context

Phase 03.2.6 conducts the final contract freeze audit for [`@paysim/contracts`](file:///e:/All%20Project/Paysim/packages/contracts) and associated storage/cryptographic infrastructure. This audit resolves all remaining edge cases:
- Reconciles HTTP 405 status behavior without inventing non-normative error codes.
- Enforces multi-dimensional idempotency partition scoping (`scope:principalId:method:resourcePath:key`) to prevent cross-endpoint key collisions.
- Validates that request fingerprints account for path parameters and canonical request bodies.
- Certifies secret recovery mechanics and memory isolation between `WebhookSecretVault` and `IdempotencyStore`.
- Classifies `GET /control/v1/credentials/overview` as a non-normative convenience alias, establishing the authoritative normative route count at exactly 30 concrete routes.
- Formalizes secret version retention across all 7 delivery lifecycle states.
- Implements exact segment boundary matching for compatibility fallback routing.

---

## 2. HTTP 405 Reconciliation

### 2.1 Error Catalogue Audit
An exhaustive audit of PRD v2.3.0 Section 17 and `SYSTEM_ARCHITECTURE.md` Section 22 confirms:
- The normative error catalogue contains **exactly 30 standardized error codes**.
- `METHOD_NOT_ALLOWED` (HTTP 405) is **NOT** present in the normative error catalogue.
- **Rule Enforced:** No new normative error code may be introduced without an approved formal PRD amendment.

### 2.2 Reconciled Routing & Error Envelope Policy
To align HTTP transport behavior with normative domain contracts:
1. **Domain Contract Level:** The domain error catalogue remains strictly locked at 30 standardized error codes. Any unmapped endpoint or unhandled route defaults to `404 NOT_FOUND` with standard `StandardErrorEnvelope` (`error: { code: 'NOT_FOUND', message: '...' }`).
2. **HTTP Transport Level (RFC 9110):** When an HTTP server or gateway receives an unsupported HTTP method on a known route (e.g. `PUT /api/v1/orders`), the transport layer produces an HTTP 405 response with a mandatory `Allow` header listing permitted methods (e.g. `Allow: GET, POST`).
3. **Fallback Policy Specification:** In [`COMPAT_UNSUPPORTED_FALLBACK_POLICY`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts), the precedence order is formally defined:
   - **Step 1:** Known unsupported compatibility feature prefix -> `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`
   - **Step 2:** Unknown/unmapped path -> `404 NOT_FOUND`
   - **Step 3:** Unsupported HTTP method on known route -> Transport 405 with `Allow` header (or fail-closed 404 domain error)

---

## 3. Idempotency Scope Isolation & Fingerprinting

### 3.1 Five-Tuple Partition Scoping
In [`packages/storage-memory/src/idempotency.ts`](file:///e:/All%20Project/Paysim/packages/storage-memory/src/idempotency.ts), partition keys are constructed using the full execution context:

$$\text{PartitionKey} = \text{scope} \parallel \text{":"} \parallel \text{principalId} \parallel \text{":"} \parallel \text{method} \parallel \text{":"} \parallel \text{resourcePath} \parallel \text{":"} \parallel \text{key}$$

**Example:**
- Endpoint 1: `webhook_secret_rotation:cred_ps_test:POST:/api/v1/webhook-endpoints/we_ps_001/rotate-secret:ik_daily`
- Endpoint 2: `webhook_secret_rotation:cred_ps_test:POST:/api/v1/webhook-endpoints/we_ps_002/rotate-secret:ik_daily`

**Collision Guarantee:** Because the concrete resource path containing the endpoint ID is embedded in the partition key, two distinct webhook endpoints using the same idempotency key and principal **cannot collide**.

### 3.2 Canonical Fingerprint Calculation
The utility `computeIdempotencyFingerprint(pathParams, body)` enforces:
1. Alphabetical sorting of path parameters (`{ endpointId: 'we_ps_001' }`).
2. Recursive key-sorting of the request body (`canonicalJsonStringify`).
3. SHA-256 hex digest computation over the combined structure.

Modifying either the target endpoint ID or any body attribute produces a distinct fingerprint, triggering `409 IDEMPOTENCY_KEY_REUSED` on replay.

---

## 4. Secret Recovery & Memory Isolation

### 4.1 Zero-Leakage Idempotency Records
Inspection of [`IdempotencyStore`](file:///e:/All%20Project/Paysim/packages/storage-memory/src/idempotency.ts) certifies:
- `StoredIdempotencyRecord` stores only safe metadata (`endpointId`, `secretVersion`, `rotatedAt`) and an opaque `disclosureRef`.
- **Raw secret bytes or strings are NEVER stored in IdempotencyStore.**

### 4.2 Lifecycle & Recovery Verification
1. **Opaque References:** Created in `WebhookSecretVault` as unguessable tokens (`disc_ps_<randomHex24>`) with a 60-second recovery TTL window.
2. **Recovery Within TTL (0–60s):** An identical request matching the key and fingerprint calls `vault.resolveDisclosure(ref)`, retrieves the raw secret `Buffer`, reconstructs the response, and returns `200 OK`.
3. **Recovery After TTL (>60s):** The disclosure reference is purged. Recovery returns `{ type: 'EXPIRED' }`, preventing delayed raw secret leakage.
4. **Server Restart:** Because all vaults and idempotency records reside in volatile process memory (`@paysim/storage-memory`), restarting PAYSIM wipes all records with zero disk residue.
5. **Concurrent Repeated Requests:** Simultaneous identical requests serialize through the Node.js event loop: the first request executes rotation and records disclosure; concurrent requests resolve from the vault via `disclosureRef` without re-rotating.

---

## 5. Route Classification & Non-Normative Alias

### 5.1 Normative Route Inventory (30 Concrete Routes)
PRD v2.3.0 Section 10 (line 1094) explicitly specifies:
`GET /control/v1/credentials` (Purpose: "List key metadata; never return full secrets").

`GET /control/v1/credentials/overview` is **NOT** mentioned in PRD v2.3.0. It is a convenience alias added for dashboard UI routing.

### 5.2 Authoritative Manifest Separation
In [`packages/contracts/src/manifest.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts):
- [`API_ROUTE_MANIFEST`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts): Contains **exactly 30 normative concrete routes**:
  - `system`: 1
  - `control`: 5
  - `native`: 19
  - `checkout`: 2
  - `compat`: 3
  - **Sum: 30**
- [`NON_NORMATIVE_ROUTE_ALIASES`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts): Contains `control_credentials_overview_alias` (`GET /control/v1/credentials/overview`).
- [`ALL_AVAILABLE_ROUTES`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts): Contains 31 total route handlers ($30 + 1 = 31$).

---

## 6. Secret Version Retention Across All 7 Delivery States

In [`SecretVersionRetentionTracker`](file:///e:/All%20Project/Paysim/packages/storage-memory/src/vaults.ts), delivery eligibility is audited across all 7 lifecycle states:

| Delivery Status | Manual Retries Remaining | Eligible Reference? | Eviction Policy | Rationale |
|:---|:---:|:---:|:---|:---|
| **`pending`** | Any ($\ge 0$) | **YES** | **RETAINED** | Queued for initial network transmission |
| **`in_progress`** | Any ($\ge 0$) | **YES** | **RETAINED** | In-flight HTTP socket transmission |
| **`failed`** | Any ($\ge 0$) | **YES** | **RETAINED** | Eligible for automatic backoff retry |
| **`exhausted`** | $> 0$ | **YES** | **RETAINED** | Manual operator retry budget remaining |
| **`exhausted`** | $= 0$ | **NO** | **EVICTABLE** | Terminal exhaustion; retry budget depleted |
| **`succeeded`** | Any | **NO** | **EVICTABLE** | Terminal delivery success |
| **`rejected`** | Any | **NO** | **EVICTABLE** | Terminal SSRF/port policy rejection |
| **`interrupted`** | Any | **NO** | **EVICTABLE** | Unrecoverable system termination |

- **Active Version Invariant:** $V_{\text{active}}$ is **never evicted**, regardless of reference count.
- **Replay Invariant:** Replays strictly bind to $V_{\text{active}}$ via `assertReplaySecretBinding()`.

---

## 7. Exact Segment Boundary Fallback Routing

In [`packages/contracts/src/manifest.ts`](file:///e:/All%20Project/Paysim/packages/contracts/src/manifest.ts):
```typescript
export function matchUnsupportedCompatibilityDomain(
  pathname: string,
  unsupportedDomains: readonly string[] = COMPAT_UNSUPPORTED_FALLBACK_POLICY.unsupportedDomains
): boolean {
  for (const domain of unsupportedDomains) {
    if (pathname === domain || pathname.startsWith(`${domain}/`)) {
      return true;
    }
  }
  return false;
}
```
- `/compat/razorpay/v1/refunds` -> **MATCH** (501)
- `/compat/razorpay/v1/refunds/rfnd_123` -> **MATCH** (501)
- `/compat/razorpay/v1/refunds_extra` -> **NO MATCH** (404, prevents false prefix collision)
- `/compat/razorpay/v1/orders` -> **NO MATCH** (Supported route, not fallback)

---

## 8. Monorepo Verification & Runtime Status

### 8.1 Test Execution Evidence
```
 RUN  v2.1.9 E:/All Project/Paysim

 ✓ packages/crypto/tests/crypto.test.ts (5 tests) 3ms
 ✓ packages/domain/tests/domain.test.ts (1 test) 2ms
 ✓ packages/shared/tests/shared.test.ts (7 tests) 24ms
 ✓ packages/storage-memory/tests/storage.test.ts (18 tests) 7ms
 ✓ tests/smoke.test.ts (5 tests) 3ms
 ✓ apps/server/tests/server.test.ts (2 tests) 27ms
 ✓ packages/contracts/tests/contracts.test.ts (55 tests) 28ms

 Test Files  7 passed (7)
      Tests  93 passed (93)
   Duration  655ms
```

### 8.2 Accurate Runtime Status Classification
- **Static URL Validation:** **PASS** (Pure contracts logic, 11 vectors tested)
- **Runtime Port Validation:** **PASS** (Declarative factory tested)
- **Destination Socket Pre-Flight:** **PASS** (Pure synchronous validator tested)
- **Express Route Registration:** **DEFERRED** (Pending Phase 03.4)
- **Outbound Dispatcher Interceptor:** **DEFERRED** (Pending Phase 03.3/03.4)

### 8.3 Fixture Byte Sizes
All event fixture files remain 100% byte-exact:
- `fixtures/events-compat/payment.captured.body.json`: 333 B
- `fixtures/events-compat/payment.captured.json`: 474 B
- `fixtures/events-native/payment.captured.body.json`: 293 B
- `fixtures/events-native/payment.captured.json`: 389 B
