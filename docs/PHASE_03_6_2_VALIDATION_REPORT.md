# PAYSIM — Phase 03.6.2 Validation Report
## Exhausted Delivery, Manual Retry & Resource Retention Verification

**Timestamp:** 2026-11-03T13:45:00+05:30
**Phase:** 03.6.2
**Role:** Principal Backend Reliability Engineer
**Runtime:** Node.js 24.0.0, Express 4.21.1, Native `http`/`https`, Vite 5.4.10, React 18.3.1
**Normative Baseline:** PRD v2.3.0 (§5.8, §7.4, §16.2), System Architecture, ADR-003, ADR-005, ADR-006, ADR-007, ADR-008, Frozen Contracts (`packages/contracts/`)
**Status:** COMPLETE, AUDITED & APPROVED (SEALED)

---

### 1. Executive Summary

Phase 03.6.2 performed an exhaustive, evidence-based verification and hardening of webhook delivery state transitions, manual retry eligibility, payload body retention, and cryptographic secret-version retention in PAYSIM.

The audit verified and resolved the critical interaction between terminal delivery statuses and resource retention:
1. **Exhausted vs Permanently Terminated Distinction:** An `exhausted` delivery that has completed its 3 automatic backoff attempts is **not** immediately terminal if manual retries remain (`manualRetriesRemaining > 0`). Its raw UTF-8 serialized payload in `DeliveryBodyVault` and historical signing secret in `WebhookSecretVault` are preserved.
2. **Permanent Deletion Boundary:** Only when `manualRetriesRemaining === 0` (or if the delivery reaches `succeeded` or `rejected`) is the delivery considered permanently terminated. At that boundary, references in `DeliveryReferenceTracker` are released, unreferenced historical secret buffers are zeroized (`0x00`), and the cached body in `DeliveryBodyVault` is purged.
3. **Attempt Counter & Backoff Policy (PRD §5.8, §7.4, §16.2):**
   - Automatic retries: exactly 3 attempts (Attempt 1: immediate, Attempt 2: 500ms backoff, Attempt 3: 2000ms backoff $\to$ `exhausted`).
   - Manual retries: up to 3 manual retries allowed (Attempts 4, 5, 6).
   - Each manual retry executes 1 immediate attempt with zero automatic backoff cycles.
   - Max total attempts per delivery = 6. Attempting a 4th manual retry is rejected with `Maximum manual retries (3) exhausted for this delivery`.
4. **Volatile In-Memory & Delivery Guarantees:** Bounded in-process delivery attempts (up to 3 auto + 3 manual retries); duplicate requests may occur; receiver-side Event ID deduplication is required; successful delivery is not guaranteed; queue and retry state are not durable across process termination.
5. **Contract Freeze:** Zero lines modified in `packages/contracts/` (`git diff` is completely empty).
6. **Monorepo Test Suite:** Monorepo test coverage expanded to **506 passing tests across 41 test files** (100% passing).

```
================================================================================
PHASE 03.6.2 RELIABILITY & RETENTION VERIFICATION SUMMARY
================================================================================
Monorepo Unit/Integ Test Suites: 41 test suites (All passed)
Total Passing Tests:             506 / 506 tests (100% passing)
Test Execution Time:             7.39s
13-Step Critical Reproduction:   100% passing (exhausted-delivery-and-retention.test.ts)
Manual Retry Attempt Quota:      Enforced: 3 auto + 3 manual = max 6 attempts
Concurrent Manual Retry Guard:   Pessimistic transaction lock + 'pending' rejection
Body Retention Invariance:       Bit-for-bit raw UTF-8 byte identical across retries
Secret Eviction Zeroization:     Historical secret zeroized (0x00) only after retry exhaustion
Volatile Delivery Guarantees:    In-memory bounded; receiver event_id deduplication documented
TypeScript Compilation:          Clean (tsc --build exited 0)
ESLint Status:                   Clean (0 errors, 0 warnings)
Frozen Contracts Diff:           0 lines (packages/contracts/ pristine)
================================================================================
```

---

### 2. Normative Compliance Matrix

| Audit ID | Boundary Description | Normative Baseline | Verification Evidence | Status |
|:---|:---|:---|:---|:---:|
| **REL-01** | Delivery Status Semantics & Transitions | PRD §5.8, §7.4 | All 7 delivery statuses (`pending`, `in_progress`, `retry_pending`, `exhausted`, `failed`, `rejected`, `succeeded`) have formal, unambiguous state semantics. | **PASS** |
| **REL-02** | Automatic vs Manual Retry Eligibility | PRD §5.8, §7.4 | Only `retry_pending` is automatic retry eligible. Only `failed` and `exhausted` (with `manualRetriesRemaining > 0`) are manual retry eligible. `pending`, `in_progress`, `rejected`, and `succeeded` strictly reject manual retries. | **PASS** |
| **REL-03** | 13-Step Critical Scenario Reproduction | PRD §7.4, ADR-006, ADR-008 | Deterministic integration test executes complete 13-step lifecycle: v1 creation, auto failure $\to$ `exhausted`, secret rotation to v2, v1 retained, manual retry with v1 and original bytes, replay with v2, release and zeroization after manual retry exhaustion. | **PASS** |
| **REL-04** | Delivery Body Vault Retention & Deferred Pruning | ADR-006 | `DeliveryBodyVault.pruneTerminalBodies()` and worker pool terminal logic retain body bytes while `manualRetriesRemaining > 0`. Body deleted only when permanently exhausted. | **PASS** |
| **REL-05** | Bit-for-Bit Payload & HMAC Invariance | ADR-006 | Raw body bytes stored in `DeliveryBodyVault` are reused without re-serialization or schema drift. HMAC signature computed on manual retry matches Attempt 1 bit-for-bit. | **PASS** |
| **REL-06** | Manual Retry Attempt Counter Reconciliation | PRD §5.8, §7.4, §16.2 | 3 automatic attempts + up to 3 manual retries (6 total attempts max). Each manual retry executes 1 immediate attempt without backoff loops. 4th manual retry rejected. | **PASS** |
| **REL-07** | Concurrent Manual Retry Prevention | ADR-003, ADR-005 | Manual retry requests acquire pessimistic transaction locks on `delivery:<id>`. If status is already `pending` or `in_progress`, subsequent requests are rejected. | **PASS** |
| **REL-08** | Secret-Version Retention & Memory Zeroization | ADR-006 | Active version is never evictable. Historical version v1 remains referenced while `manualRetriesRemaining > 0`. Zeroization (`0x00`) executes when all deliveries reach permanent termination. | **PASS** |
| **REL-09** | Volatile Delivery Boundary Clarification | PRD §7.1, ADR-003 | Fully documented in implementation and validation reports: volatile in-memory delivery guarantees, at-least-once in-process delivery, no recovery across restart, receiver Event ID deduplication. | **PASS** |
| **REL-10** | Contract Freeze Compliance | Frozen Contracts | `git diff packages/contracts/` confirmed clean (0 lines modified). | **PASS** |

---

### 3. Detailed Verification Findings

#### Task 1 — Delivery Status Semantics & Retry Eligibility

The delivery engine defines seven distinct statuses for a `WebhookDelivery`:

| Status | Meaning | Automatic Retry Eligible? | Manual Retry Eligible? | Description |
|:---|:---|:---:|:---:|:---|
| `pending` | Newly enqueued or re-queued | No (in queue) | **No** (already queued) | Freshly committed delivery or manual retry awaiting worker dispatch. |
| `in_progress` | Currently being dispatched by worker | No (active) | **No** (in flight) | HTTP socket request actively transmitting or awaiting response headers. |
| `retry_pending` | Temporary failure; backoff timer active | **Yes** (automatic) | **No** (managed by scheduler) | Attempt failed with retryable status (e.g. 500, network error) and attempts < 3. |
| `exhausted` | All automatic attempts exhausted | **No** (auto finished) | **Yes** (if manual remaining > 0) | Delivery failed 3 automatic attempts. Eligible for up to 3 manual retries. |
| `failed` | Non-retryable error outcome | **No** (fatal error) | **Yes** (if manual remaining > 0) | Explicit terminal failure (e.g. socket timeout, manual retry attempt failed). |
| `rejected` | Security violation or invalid destination | **No** (terminal) | **No** (fatal security violation) | Blocked port, non-loopback IP, 3xx redirect detected, SSRF attempt. Permanent termination. |
| `succeeded` | Receiver responded with 2xx HTTP code | **No** (complete) | **No** (already delivered) | Successfully delivered and acknowledged. Permanent termination. |

*Note on "interrupted":* The internal state machine model maps process shutdown or dropped worker locks to `failed` or leaves pending records in `RootState`. It is not an exposed wire status.

#### Task 2 & Task 4 — Critical Reproduction Scenario

The 13-step critical scenario was implemented in `apps/server/tests/webhook-engine/exhausted-delivery-and-retention.test.ts` and executed deterministically:

1. **Endpoint Creation:** Webhook endpoint registered with secret `whsec_v1_test_secret_initial_001` (Version 1).
2. **Event Trigger:** Order authorized event triggers delivery `del_001`.
3. **Attempt 1 Fails:** Receiver returns HTTP 500. Worker schedules backoff (500ms); status becomes `retry_pending`.
4. **Attempt 2 Fails:** Receiver returns HTTP 500. Worker schedules backoff (2000ms); status becomes `retry_pending`.
5. **Attempt 3 Fails:** Receiver returns HTTP 500. Automatic attempts (3) exhausted; status transitions to `exhausted`. `manualRetriesRemaining` is 3.
6. **Secret Rotation:** Secret rotated to Version 2 (`whsec_v2_rotated_secret_version_002`).
7. **Secret Reference Verification:** `SecretVersionRetentionTracker` confirms Version 1 retains an active reference because `del_001` has `status: 'exhausted'` and `manualRetriesRemaining: 3`.
8. **Eviction Immunity:** `canEvictSecretVersion(..., v1, ...)` returns `false`. Version 1 cannot be evicted or zeroized.
9. **Manual Retry #1:** Developer triggers `POST /api/v1/webhook-deliveries/:id/retry`. Status transitions to `pending` $\to$ `in_progress`.
10. **Bit-for-Bit & Version 1 Verification:** Manual retry delivers to receiver. Request payload is bit-for-bit identical to Attempt 1. Signature header `X-PaySim-Signature` matches HMAC-SHA256 computed using **Version 1** secret.
11. **Event Replay:** Original event is replayed via `POST /api/v1/events/:id/replay`, producing new delivery `del_002`.
12. **Version 2 Verification for Replay:** `del_002` signs its payload using **Version 2** secret.
13. **Exhaustion & Zeroization:** Subsequent manual retries are executed until `del_001` reaches 6 attempts total (`manualRetriesRemaining === 0`). At this exact point:
    - `referenceTracker.releaseReference('del_001')` releases the reference.
    - `evaluateSecretVersionEviction()` determines Version 1 has 0 references.
    - Version 1's secret buffer in `WebhookSecretVault` is zeroized with `0x00`.
    - `DeliveryBodyVault.deleteBody('del_001')` purges the cached body.

#### Task 3 — Delivery Body Retention Audit

Inspection of `DeliveryBodyVault` revealed that an earlier implementation marked any `exhausted` status as terminal for body pruning.

**Defect Identified & Corrected:**
- *Problem:* If `DeliveryBodyVault.pruneTerminalBodies()` immediately pruned payloads upon reaching `exhausted`, subsequent manual retries would fail or require reconstructing the payload from canonical events (risking schema drift or timestamp discrepancies).
- *Correction:* Updated `pruneTerminalBodies()` and worker pool completion:
  ```typescript
  const isTerminal =
    d.status === 'succeeded' ||
    d.status === 'rejected' ||
    (d.status === 'exhausted' && (d.manualRetriesRemaining === undefined || d.manualRetriesRemaining === 0));
  ```
- *Outcome:* Bodies are retained throughout the entire manual retry window and pruned only when all retries are permanently exhausted.

#### Task 5 — Volatile Delivery Boundary Clarification

PAYSIM is designed strictly as a local development simulator and testing laboratory. In accordance with ADR-003 and PRD §7.1:
1. **Bounded In-Process Delivery Attempts:** Webhook deliveries are limited to 3 automatic attempts plus up to 3 manual retries (maximum 6 attempts total).
2. **Automatic and Manual Retry Support:** Transient network or 5xx server errors trigger automatic backoff (500ms, 2000ms); manual retries are accepted for failed/exhausted deliveries with remaining allowance.
3. **Duplicate Requests May Occur:** Network re-transmissions, timeouts, or manual retry invocations may result in duplicate webhook deliveries.
4. **Receiver-Side Event ID Deduplication is Required:** Webhook receivers must implement idempotency using the canonical `event_id` (present in both native `payload.event_id` and Razorpay-compatible `payload.event.id`).
5. **Successful Delivery is Not Guaranteed:** Deliveries to unreachable, redirecting, or fatal 4xx receivers terminate as `failed`, `exhausted`, or `rejected`.
6. **In-Memory Volatility (No Durable Restart Recovery):** All queues, delivery histories, and vault buffers exist exclusively in Node.js process memory (`RootState`, `DeliveryQueue`, `DeliveryBodyVault`, `WebhookSecretVault`). In-flight queue jobs and scheduled retry timers do not persist across process termination (`SIGINT`/`SIGTERM`/exit). State resets on restart.

---

### 4. Test Suite Execution Evidence

The complete monorepo test suite was executed via `vitest run`:

```
 RUN  v2.1.9 E:/All Project/Paysim

 ✓ apps/web/tests/domain-api-integration.test.ts (10 tests)
 ✓ packages/contracts/tests/contracts.test.ts (56 tests)
 ✓ packages/storage-memory/tests/storage.test.ts (21 tests)
 ✓ packages/domain/tests/payments.test.ts (16 tests)
 ✓ packages/domain/tests/simulation.test.ts (25 tests)
 ✓ packages/domain/tests/matrix.test.ts (61 tests)
 ✓ packages/storage-memory/tests/coordinator.test.ts (7 tests)
 ✓ packages/storage-memory/tests/failure-injection.test.ts (16 tests)
 ✓ packages/storage-memory/tests/read-write-isolation.test.ts (9 tests)
 ✓ packages/storage-memory/tests/concurrency-integrity.test.ts (14 tests)
 ✓ apps/server/tests/application/payment-use-cases.test.ts (16 tests)
 ✓ packages/storage-memory/tests/repositories.test.ts (17 tests)
 ✓ packages/domain/tests/orders.test.ts (17 tests)
 ✓ apps/server/tests/webhook-serialization.test.ts (7 tests)
 ✓ apps/server/tests/webhook-engine/network-security.test.ts (24 tests)
 ✓ apps/server/tests/application/webhook-use-cases.test.ts (11 tests)
 ✓ packages/storage-memory/tests/locks.test.ts (13 tests)
 ✓ apps/server/tests/application/checkout-use-cases.test.ts (9 tests)
 ✓ apps/server/tests/webhook-engine/http-dispatcher.test.ts (8 tests)
 ✓ apps/server/tests/webhook-engine/webhook-audit-phase03-6-1.test.ts (19 tests)
 ✓ apps/server/tests/application/order-use-cases.test.ts (10 tests)
 ✓ apps/web/tests/api-client.test.ts (8 tests)
 ✓ apps/server/tests/route-manifest-and-security.test.ts (7 tests)
 ✓ packages/shared/tests/shared.test.ts (7 tests)
 ✓ apps/server/tests/integration/webhook-api.test.ts (6 tests)
 ✓ apps/server/tests/application/control-use-cases.test.ts (6 tests)
 ✓ apps/server/tests/integration/native-api.test.ts (8 tests)
 ✓ packages/crypto/tests/crypto.test.ts (5 tests)
 ✓ packages/storage-memory/tests/sequencer.test.ts (4 tests)
 ✓ apps/server/tests/integration/control-api.test.ts (7 tests)
 ✓ apps/server/tests/webhook-engine/delivery-lifecycle-and-retry.test.ts (15 tests)
 ✓ apps/server/tests/configuration-and-listener-security.test.ts (5 tests)
 ✓ apps/server/tests/integration/routing-fallback.test.ts (9 tests)
 ✓ apps/web/tests/formatters.test.ts (6 tests)
 ✓ apps/server/tests/integration/compat-api.test.ts (5 tests)
 ✓ tests/smoke.test.ts (5 tests)
 ✓ apps/server/tests/integration/checkout-api.test.ts (4 tests)
 ✓ packages/domain/tests/domain.test.ts (1 test)
 ✓ apps/server/tests/server-lifecycle.test.ts (1 test)
 ✓ apps/server/tests/server.test.ts (2 tests)
 ✓ apps/server/tests/webhook-engine/exhausted-delivery-and-retention.test.ts (9 tests)

 Test Files  41 passed (41)
      Tests  506 passed (506)
   Duration  7.39s
```

---

### 5. Sign-Off & Phase Transition Guard

Phase 03.6.2 is formally complete, verified, and sealed.
- All 10 compliance items in the verification matrix have passed without exceptions.
- 0 frozen contract lines modified.
- In strict adherence to operational guidelines, Phase 03.7 will not begin automatically without explicit user direction.
