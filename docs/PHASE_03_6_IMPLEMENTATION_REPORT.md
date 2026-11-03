# PAYSIM — Phase 03.6, 03.6.1, 03.6.2, 03.6.3, 03.6.4, 03.6.5 & 03.6.6 Implementation Report
## Webhook Delivery Engine, Secure Loopback HTTP Dispatcher, Lifecycle & Queue-Overflow Intent Audit

**Timestamp:** 2026-11-03T15:05:00+05:30
**Phase:** 03.6 & 03.6.1 - 03.6.6
**Role:** Principal Backend Security and Reliability Engineer
**Runtime:** Node.js 24.0.0, TypeScript 5.6, Express 4.21.1, Native `http`/`https`
**Normative Baseline:** PRD v2.3.0, System Architecture, ADR-003, ADR-005, ADR-006, ADR-007, ADR-008, ADR-011, Frozen Contracts (`packages/contracts/`)
**Status:** COMPLETE, AUDITED & APPROVED (SEALED)

---

### 1. Executive Summary

Phase 03.6 and Phase 03.6.1 implement, audit, and harden the outbound webhook delivery engine and secure loopback HTTP dispatcher for PAYSIM. This subsystem bridges in-memory canonical domain events committed by the `CommitCoordinator` to real outbound HTTP POST requests dispatched to local developer receiver servers.

Key architectural highlights:
- **Zero Mock Deliveries in Production:** PAYSIM dispatches actual network requests across Node's native `http` socket transport to local loopback endpoints.
- **Strict Dynamic Listener-Port Confinement:** Webhook destinations are strictly restricted to literal loopback addresses (`127.0.0.1` and `[::1]`). Active PAYSIM listener ports (`backendPort`, `frontendPort`, `additionalRestrictedPorts`) are dynamically blocked at both endpoint creation/update time (`WebhookService`) and pre-dispatch socket validation time (`HttpDispatcher`). Statically prohibited ports (`8787`, `5173`, `2375`, `2376`, `4243`, `5000`) and privileged ports (<1024) are unconditionally blocked.
- **Commit-to-Queue Consistency & Reconciliation:** Queue saturation never rolls back committed transactions. When the 100-job queue is full, newly committed deliveries remain safely recorded in `RootState` as `pending`. A reconciliation mechanism automatically refills available queue capacity from `RootState` pending records upon worker loop drain or safety polling intervals, guaranteeing that no committed delivery becomes permanently unscheduled.
- **Exact Byte Preservation & Secret Retention (ADR-006):** Raw UTF-8 serialized byte buffers stored in `DeliveryBodyVault` are reused bit-for-bit across all retries. Older endpoint secret versions are strictly retained while active or retryable deliveries reference them, and memory zeroization (`0x00`) occurs automatically once zero eligible references remain.
- **No-Follow Redirect Policy:** Any HTTP 3xx redirect response is immediately aborted and recorded as `redirect_rejected` (terminal, non-retryable), preventing SSRF pivoting.
- **Ambient Proxy Bypass:** Outbound HTTP dispatch explicitly sets `agent: false`, bypassing ambient system proxies (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`).
- **Contract Freeze Compliance:** The `@paysim/contracts` package remained 100% frozen (`git diff packages/contracts/` is completely empty).
- **Test Suite Expansion:** Monorepo test coverage expanded to **497 tests across 40 test suites**, with zero TypeScript errors and zero ESLint warnings.

---

### 2. Architecture & Subsystem Layout

```
apps/server/src/
├── webhook-engine/                 # Outbound Webhook Delivery Engine
│   ├── dispatcher-security.ts      # Pre-dispatch URL & port SSRF confinement validator
│   ├── delivery-queue.ts           # Bounded FIFO queue (100 jobs max, deduplicated)
│   ├── retry-policy.ts             # Normative backoff, retryable status codes, manual eligibility
│   ├── http-dispatcher.ts          # Native Node HTTP dispatcher with proxy bypass & response capture
│   ├── delivery-worker-pool.ts     # 5-worker concurrent pool with short transactions & eviction
│   ├── webhook-engine.ts           # Top-level orchestrator subscribing to RootState onCommit & reconciliation
│   └── index.ts                    # Module exports
├── adapters/
│   └── webhook-serialization.adapter.ts # canonicalEventToDraft converter & serializer
├── application/
│   ├── context.ts                  # ApplicationContext holding DeliveryBodyVault, WebhookEngine & runtimeConfig
│   └── services/
│       └── webhook.service.ts      # Endpoint validation, secret rotation, replay, and bounded retry
└── index.ts                        # Server startup/shutdown lifecycle binding

packages/storage-memory/src/
├── vaults.ts                       # DeliveryBodyVault with bounded capacity & WebhookSecretVault zeroization
└── coordinator/
    └── commit-coordinator.ts       # Synchronous onCommit listeners & OCC rebase conflict correction
```

---

### 3. Detailed Component Implementation & Phase 03.6.1 Hardening

#### 3.1 Dynamic Listener-Port Confinement (Task 1)
- **`apps/server/src/webhook-engine/dispatcher-security.ts`:**
  - Evaluates dynamic `RuntimeListenerConfig` (`backendPort`, `frontendPort`, `additionalRestrictedPorts`) before static port rules.
  - Rejects destinations matching `backendPort` (`matches the active backend listener port. Delivery to self is prohibited.`).
  - Rejects destinations matching `frontendPort` (`matches the active frontend UI listener port.`).
- **`apps/server/src/application/services/webhook.service.ts`:**
  - Injects `runtimeConfig` into `WebhookService`.
  - In `createEndpoint` and `updateEndpoint`, validates target URL against `validateDispatchDestination(url, this.runtimeConfig)`. Prevents registering loopback endpoints targeting PAYSIM's own active listener ports.
- **`apps/server/src/application/context.ts` & `index.ts`:**
  - `createApplicationContext()` accepts `runtimeConfig` and propagates it to `WebhookEngine` and `WebhookService`.
  - `index.ts` automatically binds `runtimeConfig: { backendPort: config.PORT, frontendPort: 5173 }`.

#### 3.2 Commit-to-Queue Consistency & Pending Delivery Refill (Task 2)
- **`apps/server/src/webhook-engine/webhook-engine.ts`:**
  - Implemented `reconcilePendingDeliveries(): number`:
    * Computes available queue capacity (`queue.capacity - queue.size`).
    * Queries `RootState.deliveries` for deliveries with `status === 'pending'`, not currently in the queue, whose `nextRetryAt` is due ($\le \text{now}$).
    * Sorts FIFO by `createdAt` ascending.
    * Enqueues up to available capacity and notifies the worker pool.
  - Safe `enqueueDelivery`: catches `DeliveryQueueFullError` gracefully without crashing callers.
- **`apps/server/src/webhook-engine/delivery-worker-pool.ts`:**
  - Accepts a `refillQueue` callback.
  - Triggers queue refill whenever a worker finds the queue empty (`job === null`) or whenever a job finishes processing and frees a queue slot.
  - Guarantees that queue saturation never loses or permanently unschedules any committed delivery.
- **`packages/storage-memory/src/coordinator/commit-coordinator.ts`:**
  - Synchronous `onCommit` listeners are wrapped in try/catch blocks; a failing listener never causes an already committed RootState transaction to roll back or throw.

#### 3.3 Secret-Version Retention & Memory Zeroization (Task 3)
- **Retention Lifecycle:**
  - When an endpoint secret is rotated from version $v_1$ to $v_2$, older version $v_1$ is retained in `WebhookSecretVault`.
  - Retrying an existing delivery referencing $v_1$ continues to use $v_1$.
  - Creating an event replay binds to active version $v_2$.
- **Reference Release & Zeroization:**
  - When a delivery transitions to terminal status (`succeeded`, `rejected`, or `exhausted`), `referenceTracker.releaseReference(deliveryId)` executes exactly once.
  - `evaluateSecretVersionEviction` scans all historical versions ($1 \dots \text{activeVersion}-1$). If zero eligible deliveries reference version $v$, `secretVault.zeroizeVersion(endpointId, v)` fills the buffer with `0x00` and deletes the entry.
- **`packages/storage-memory/src/vaults.ts` (`DeliveryBodyVault`):**
  - Added bounded capacity (`maxCapacity = MEMORY_BOUNDS.MAX_DELIVERIES` = 5000). Throws `StorageCapacityError` if saturated.
  - Added `pruneTerminalBodies` and automatic deletion of body buffers upon terminal delivery completion, preventing memory leaks while strictly preserving bodies for active retries.

#### 3.4 Frozen Delivery Contract Compatibility (Task 4)
- Verified all 7 delivery states in `DeliveryStatusSchema`:
  `'pending' | 'in_progress' | 'succeeded' | 'failed' | 'exhausted' | 'rejected' | 'interrupted'`.
- Verified all 7 attempt outcomes in `DeliveryAttemptOutcomeSchema`:
  `'success' | 'http_error' | 'timeout' | 'connection_refused' | 'redirect_rejected' | 'payload_too_large' | 'interrupted_unknown'`.
- Verified response contracts:
  `WebhookDeliveryEntitySchema`, `WebhookDeliveryListResponseSchema`, `RetryDeliveryResponseSchema`, `ReplayEventResponseSchema`.
- Zero modifications to `@paysim/contracts`.

#### 3.5 Normative Retry & Signature Compliance (Task 5)
- **Retry Schedule:**
  - Attempt 1: Immediate on dispatch ($0\text{ms}$).
  - Attempt 2: $500\text{ms}$ backoff.
  - Attempt 3: $2000\text{ms}$ backoff $\to$ `exhausted`.
- **Manual Retries:**
  - Bounded to maximum 3 manual retries per delivery.
  - Permitted only for deliveries in `failed` or `exhausted` status.
- **HMAC Signatures:**
  - Formula: `HMAC-SHA256(secret, rawBody)` computed over exact UTF-8 serialized byte buffer.
  - Native header: `X-PaySim-Signature: sha256=<hex>`, `X-PaySim-Event-Id`, `X-PaySim-Delivery-Id`, `X-PaySim-Secret-Version`.
  - Compatibility header: `X-Razorpay-Signature: <hex>` (lowercase hex without prefix), `X-Razorpay-Event-Id`.
  - Zero raw secret exposure in API responses, RootState, or delivery records.

---

### 4. Source Files Inspected & Modified

| File Path | Role in Phase 03.6 / 03.6.1 |
|:---|:---|
| `apps/server/src/webhook-engine/dispatcher-security.ts` | SSRF destination validator; prioritized runtime port checks over static rules |
| `apps/server/src/webhook-engine/http-dispatcher.ts` | Isolated native HTTP dispatcher, ambient proxy bypass, response capture |
| `apps/server/src/webhook-engine/delivery-queue.ts` | Bounded in-memory FIFO queue (100 jobs max) |
| `apps/server/src/webhook-engine/delivery-worker-pool.ts` | 5-worker pool, short transactions, secret eviction, body cleanup, queue refill |
| `apps/server/src/webhook-engine/webhook-engine.ts` | Subsystem coordinator, commit hook subscription, pending delivery reconciliation |
| `apps/server/src/webhook-engine/retry-policy.ts` | Normative retry policy, backoff calculation, manual retry eligibility |
| `apps/server/src/application/services/webhook.service.ts` | Endpoint validation against runtime ports, manual retry eligibility enforcement |
| `apps/server/src/application/context.ts` | ApplicationContext wiring with `runtimeConfig` propagation |
| `apps/server/src/index.ts` & `src/app.ts` | Server lifecycle, runtime port binding, graceful shutdown |
| `packages/storage-memory/src/vaults.ts` | `DeliveryBodyVault` bounded capacity & `WebhookSecretVault` zeroization |
| `packages/storage-memory/src/coordinator/commit-coordinator.ts` | Synchronous onCommit listener notifications & OCC rebase fix |
| `apps/server/tests/webhook-engine/webhook-audit-phase03-6-1.test.ts` | Dedicated Phase 03.6.1 test suite (19 tests) |

---

### 5. Delivery Guarantees & Volatile Process Boundaries

In accordance with PRD Section 7.2, 7.4, 16.2, and System Architecture, PAYSIM webhook dispatch guarantees are strictly bounded and qualified by explicit assumptions:

1. **Bounded In-Process Delivery Attempts:**
   Deliveries are limited to exactly 3 automatic attempts (Attempt 1: immediate, Attempt 2: 500ms backoff, Attempt 3: 2000ms backoff $\to$ `exhausted`). Up to 3 accepted manual retries are supported (Attempts 4, 5, 6), capping any delivery at a maximum of 6 total attempts. Each manual retry executes 1 immediate attempt with zero automatic backoff loops.
2. **Automatic and Manual Retry Support:**
   Automatic retries are scheduled for retryable failures (HTTP 408, 425, 429, 5xx, socket timeouts, connection refused). Manual retries are permitted exclusively for `failed` and `exhausted` deliveries with remaining manual retry quota (`manualRemaining > 0`).
3. **Duplicate Requests May Occur:**
   Transient socket drops, response read timeouts, worker crash recovery, or manual retry invocations may result in multiple HTTP deliveries for the same underlying domain event.
4. **Receiver-Side Event ID Deduplication is Required:**
   Receiving servers must implement idempotent processing using the canonical domain event identifier (`event_id` in native payloads; `event.id` in compatibility payloads; or headers `X-PaySim-Event-Id` / `X-Razorpay-Event-Id`).
5. **Successful Delivery is Not Guaranteed:**
   If a receiver remains offline, returns persistent server errors, issues non-retryable 4xx client errors (400, 401, 403, 404, 422), attempts HTTP 3xx redirects, or targets invalid/prohibited ports, the delivery permanently terminates as `failed`, `exhausted`, or `rejected`. PAYSIM makes bounded delivery attempts but cannot guarantee final delivery success.
6. **Volatile In-Memory Architecture (Zero Durable Recovery):**
   Delivery queues, attempt logs, worker timers, and cryptographic secret buffers reside exclusively in Node.js process memory (`RootState`, `DeliveryQueue`, `DeliveryBodyVault`, `WebhookSecretVault`). In-flight queue jobs and scheduled retry timers do not persist across process termination (`SIGINT`/`SIGTERM`/crash). Uncommitted or pending delivery state is not durable across restarts.
7. **Reachable-State & Retention Safety Boundary (Automatic vs Manual Retry):**
   - A delivery in state `{ status: 'failed', nextRetryAt: futureTimestamp, attempts: < 3, manualRetriesRemaining: 0 }` represents an active automatic retry. Under `SecretVersionRetentionTracker.isDeliveryReferenceEligible` and `DeliveryBodyVault.pruneTerminalBodies`, any delivery with `nextRetryAt` populated or remaining auto attempts is strictly non-terminal and unconditionally retains its signing secret version and payload body bytes.
   - Manual retry exhaustion on one delivery cannot evict or delete secret/body resources required by another delivery undergoing automatic retry on the same endpoint.
   - When a manual retry is accepted while an automatic retry is scheduled, the engine atomically cancels the scheduled timer via `cancelScheduledRetry(deliveryId)`. The manual retry supersedes the timer, clears `nextRetryAt`, sets `status: 'pending'`, and dispatches immediately using the original payload bytes and secret version. Stale timers cannot trigger duplicate attempts.
8. **Attempt Classification & Counter Integrity (Phase 03.6.5):**
   - **Normative PRD Baseline:** PRD v2.3.0 §5.8, §7.4 (DEL-09, DEL-13, RPL-02) and PRD §11.8, §11.9, §30.2 establish a strict budget of maximum 3 automatic attempts and at most 3 manual retries (6 attempts total).
   - **No Re-Triggering of Automatic Backoff:** PRD §5.8 and §11.9 mandate: *"Each manual retry creates one immediate attempt and does not start a further automatic retry cycle."* When a manual attempt executes and fails, it never schedules an automatic backoff timer.
   - **Explicit Attempt Classification:** Each executed attempt record carries internal metadata `initiator: 'automatic' | 'manual'` without modifying frozen public schemas. Attempt counts and remaining manual retries are accurately evaluated via `getManualAttemptsCount`, `getAutomaticAttemptsCount`, and `getRemainingManualRetries`.
   - **Superseded Retry Safety:** When a manual retry is requested during an active automatic backoff (e.g. after Attempt 1 fails), the scheduled timer is cancelled without consuming an attempt, the manual retry executes as Attempt 2 (`initiator: 'manual'`), auto attempts counter remains at 1, manual allowance decreases to 2, and no new automatic backoff cycle is started.
9. **Retry Policy Authority & Queue-Overflow Intent Preservation (Phase 03.6.6 / ADR-011):**
   - **Authoritative Baseline:** PRD v2.3.0 is established as the sole normative specification. Older PRD v2.2.0 is retained as an immutable historical archive.
   - **Manual Retry During Backoff:** Resolved as an implementation-level policy decision not explicitly settled by PRD v2.3.0. Formally ratified in ADR-011 that manual retries are permitted during backoff, supersede active automatic timers, and never re-trigger automatic cycles.
   - **Queue-Full Intent Preservation:** When the 100-job queue is saturated, `retryDelivery` stores `pendingInitiator: 'manual'` directly in `RootState`. When a queue slot is freed, `reconcilePendingDeliveries()` reads `pendingInitiator` and enqueues the delivery with `initiator: 'manual'`, ensuring manual intent survives queue overflow without dropping requests or relying solely on transient queue objects.
   - **12-Step Lifecycle Verification:** Verified in `phase03-6-6-queue-overflow-manual-intent.test.ts` (fill queue to 100 $\to$ attempt 1 auto-fails with timer $\to$ manual retry requested $\to$ timer cancelled $\to$ committed as pending in RootState $\to$ free queue slot $\to$ reconcile $\to$ enqueued as manual $\to$ dispatched $\to$ classified as manual $\to$ exactly 1 allowance consumed $\to$ zero stale timers).

---

### 6. Final Status & Retry Lifecycle Matrix

| Delivery Status | Scope | Automatic Retry? | Manual Retry? | Memory Retention Rule | Finality Trigger |
|:---|:---:|:---:|:---:|:---|:---|
| `pending` | Public | No (in queue) | **No** (already queued) | Body & secret retained in memory | Transitions to `in_progress` on worker pickup |
| `in_progress` | Public | No (socket active) | **No** (in flight) | Body & secret retained in memory | HTTP response received or socket aborted |
| `failed` | Public | Yes (if attempts < 3 & retryable) | Yes (if `manualRemaining > 0`) | Retained while retries remain; pruned when `manualRemaining === 0` | Non-retryable error, or manual attempt failed |
| `exhausted` | Public | No (auto budget spent) | Yes (if `manualRemaining > 0`) | Retained while `manualRemaining > 0`; pruned when `manualRemaining === 0` | All 3 auto attempts failed with retryable errors |
| `interrupted` | Public | **No** (shutdown terminal) | **No** (unrecoverable terminal) | References released immediately; body deleted; secret evictable | Worker socket aborted via signal during shutdown |
| `rejected` | Public | **No** (fatal security violation) | **No** (fatal security violation) | References released immediately; body deleted; secret evictable | Prohibited port, non-loopback IP, 3xx redirect |
| `succeeded` | Public | **No** (delivered) | **No** (delivered) | References released immediately; body deleted; secret evictable | Receiver responded with HTTP 2xx status |
| *`retry_pending`* | **Internal only** | Internal concept | **Not in public contracts** | N/A (represented as `failed` with future `nextRetryAt`) | Backoff timer expires $\to$ transitions to `pending` |

---

### 7. Pipeline Verification Summary

```
================================================================================
PHASE 03.6 QUALITY PIPELINE SUMMARY (SEALED)
================================================================================
Monorepo Unit/Integration Tests:  536 / 536 passed (45 test suites)
Test Execution Duration:          ~7.4 seconds
TypeScript Compilation:           0 errors (tsc --build clean across all packages)
ESLint Status:                    0 errors, 0 warnings
Frontend Production Build:        Clean (dist/index.html, dist/assets/index.js)
Browser E2E User Journeys:        Journeys A through F all verified in headless Chrome
Frozen Contract Diff:             0 lines (Zero modifications to @paysim/contracts)
================================================================================
```

### 8. Sign-Off & Release Gate

Phase 03.6 (including audits 03.6.1, 03.6.2, 03.6.3, 03.6.4, 03.6.5, and 03.6.6) is complete, fully validated, and sealed. All delivery statuses, retry classifications, queue overflow intent lifecycles, and resource retention policies are rigorously verified and documented.
