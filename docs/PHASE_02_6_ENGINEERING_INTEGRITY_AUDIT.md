# PAYSIM — Phase 02.6 Engineering Integrity Audit & Hardening Specification

**Document Version:** 1.0.0  
**Phase:** Phase 02.6 — Final Engineering Integrity Audit  
**Status:** Verification Complete & Formally Approved  
**Current Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Auditor & Specialist:** Principal Software Architect, TypeScript Runtime Engineer, and Concurrency Specialist  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Audit Context

This document resolves the final implementation-blocking technical edge cases for Project PAYSIM prior to Phase 03 foundation engineering. It addresses critical concurrency hazards, runtime memory limitations, event sequence precision, and delivery ordering realities that must be specified with absolute precision before any code is written.

### Key Architectural Resolutions in Phase 02.6:
1. **Single Immutable Root State Reference Swap:** Eliminates the hazard of partial multi-repository mutation and fallible compensation rollbacks by encapsulating all domain state in a single immutable container swapped via a single non-throwing JavaScript pointer assignment.
2. **In-Process Atomic Visibility vs. Crash Durability:** Formally demarcates single-process memory visibility from crash durability.
3. **Session Token Vault & Grace Window Protocol:** Defines exact concurrent exchange, rotation, 30-second grace window, and reload recovery semantics.
4. **BigInt Global Event Sequencing & JSON Decimal-String Serialization:** Defines internal `bigint` monotonic sequencing with lossless decimal-string JSON wire encoding.
5. **Formal Multi-Entity Lock Acquisition & Lexicographical Ordering:** Establishes same-tier key sorting, lock timeouts, and audits every acquisition path.
6. **Non-Guaranteed Webhook Delivery Order & Consumer Contracts:** Formally disclaims strict delivery ordering across network boundaries and defines consumer deduplication and version validation requirements.
7. **Secret Retention Reference Counting & 30-Minute Pending Lifetime:** Maps reference counts across all six attempt states, bounds pending attempts to 30 minutes, and preserves the capability expiry invariant.
8. **Precise Multi-Tier Capacity Model:** Formally bounds queue, worker, event, delivery, and reservation pools.

---

## 2. Single Root State Commit: Immutable Pointer Swap Protocol

### 2.1 Audit of the Multi-Repository Map Pointer Swap Flaw
In Phase 02.5, transactional atomicity was modeled by updating multiple in-memory repositories sequentially in a synchronous block:
```typescript
// FLAGGED DESIGN PATTERN (Phase 02.5):
OrderRepo.set(orderId, stagedOrder);
PaymentRepo.set(paymentId, stagedPayment);
EventRepo.setBatch(stagedEvents);
DeliveryRepo.setBatch(stagedDeliveries);
IdempotencyStore.set(scopeKey, stagedIdempotency);
```

#### Failure Modes Identified:
1. **Partial Multi-Repository Mutation:** If `OrderRepo.set()` succeeds, but `EventRepo.setBatch()` triggers a V8 memory allocation failure (e.g. `RangeError: Map maximum size exceeded` or an unhandled exception during map rehashing), the `OrderRepo` remains mutated while `EventRepo` is unmodified.
2. **Fallible Compensation Rollback:** A `catch` block attempting to restore old entity snapshots across 5 distinct repositories can itself fail if memory is exhausted or if rollback logic encounters an error, leaving the process in a corrupt, non-deterministic state.
3. **Inconsistent Concurrent Reads:** While Node.js synchronous execution blocks JavaScript execution, concurrent asynchronous readers awaiting earlier I/O could observe partially mutated state between consecutive repository sets if any synchronous yield or sub-microtask were inadvertently introduced.

### 2.2 The Solution: Single Immutable Root State Container

PAYSIM mandates that all in-memory domain state is owned by a single, monolithic, immutable root state container:

```typescript
export interface RootState {
  readonly orders: ReadonlyMap<string, Readonly<MockOrder>>;
  readonly payments: ReadonlyMap<string, Readonly<MockPayment>>;
  readonly events: ReadonlyMap<string, Readonly<CanonicalEvent>>;
  readonly deliveries: ReadonlyMap<string, Readonly<WebhookDelivery>>;
  readonly idempotency: ReadonlyMap<string, Readonly<IdempotencyRecord>>;
  readonly retention: Readonly<RetentionState>;
  readonly version: bigint; // Monotonically increments on every root swap
}
```

### 2.3 Single Pointer Swap Execution Protocol

```mermaid
sequenceDiagram
    autonumber
    participant Controller as Domain Controller
    participant Mutex as AsyncLock("order:" + orderId)
    participant Coordinator as RetentionCoordinator
    participant Memory as Preparation Context
    participant StateHolder as RootStateHolder

    Controller->>Mutex: acquire("order:" + orderId, { timeout: 5000 })
    
    rect rgb(245, 245, 255)
    Note over Memory: PHASE 1: PREPARATION & VALIDATION (May Fail / May Throw)
    Controller->>Coordinator: reserveSlots({ events: 3, deliveries: N, idempotency: 1 })
    Controller->>StateHolder: snapshot = getRootState()
    Controller->>Memory: Clone existing Maps from snapshot
    Controller->>Memory: Apply state transitions to working objects
    Controller->>Memory: Construct Canonical Events (deep-frozen via Object.freeze)
    Controller->>Memory: Construct Delivery Intents with raw body snapshots
    Controller->>Memory: Prevalidate all candidate entities against Zod schemas
    Controller->>Memory: Insert entities into cloned Maps
    Controller->>Memory: Construct candidate RootState object
    end

    rect rgb(240, 255, 240)
    Note over StateHolder: PHASE 2: ATOMIC ROOT POINTER SWAP (Cannot Throw)
    Note over StateHolder: Single reference assignment: currentRootState = candidateRootState;<br/>Guaranteed atomic in V8 single-threaded execution.
    Controller->>StateHolder: commitRootState(candidateRootState)
    Controller->>Coordinator: commitReservation(reservationId)
    end

    Controller->>Mutex: release("order:" + orderId)
    Controller-->>Controller: Return 200 OK (State Visible Atomically)
```

#### Protocol Guarantees:
1. **Zero Multi-Repository Inconsistency:** Either the entire `candidateRootState` becomes the new active state, or it is discarded entirely. If any validation fails, schema throws, or allocation fails during Phase 1, the existing `currentRootState` reference is 100% untouched.
2. **Zero Need for Compensation Rollback:** Because no live repository is ever modified in place, no compensating rollback logic is required. Discarding the uncommitted candidate state occurs naturally via garbage collection.
3. **Reservation Cleanup on Abort:** If Phase 1 throws, a `finally` block releases the reservation: `Coordinator.abortReservation(reservationId)`.

### 2.4 In-Process Atomic Visibility vs. Process Crash Durability
* **In-Process Atomic Visibility:** Achieved. Once `currentRootState = candidateRootState` executes, all subsequent readers in the Node.js event loop immediately see the fully committed, consistent state across orders, payments, events, and deliveries.
* **Process Crash Durability:** Explicitly Disclaimed. PAYSIM maintains zero write-ahead log (WAL) on disk. If the Node.js process crashes (`SIGKILL`, segmentation fault, out-of-memory kill, or host power failure), all in-memory state is lost. This is acceptable by design for a local-first testing harness.

---

## 3. Session Token Lifecycle & Concurrency Protocol

### 3.1 Vault and Hash Separation
To isolate session credentials from domain entity storage:
* `MockCheckoutSession` (stored in `RootState.orders` metadata or session store) retains only the constant-time hash: `opaqueTokenHash: string` (SHA-256).
* `SessionTokenVault` (ephemeral process-memory authority) manages raw secret tokens.

```typescript
export interface SessionTokenVaultEntry {
  readonly sessionId: string;
  readonly paymentId: string;
  currentToken: string;
  currentTokenHash: string;
  expiresAt: number;           // Bound to session 15m lifetime
  graceToken?: string;
  graceTokenHash?: string;
  graceExpiresAt?: number;     // Active for 30s following explicit rotation
}
```

### 3.2 State Transition Matrix: Capability Exchange & Rotation

| Operation / Trigger | Pre-Condition | Action / State Mutation | Response / Result | Grace Token State |
|---|---|---|---|---|
| **First Exchange** | Capability token valid; no entry in vault | Mint `currentToken`; record in vault with session expiry | Return `currentToken` | `graceToken` = undefined |
| **Concurrent Exchange (Thread A & B)** | Capability token valid; active `currentToken` in vault | Return existing active `currentToken` idempotently | Both threads receive identical token | Unchanged |
| **Iframe Remount (Normal)** | Capability token valid; `currentToken` active | Return existing active `currentToken` | Remount succeeds without re-auth | Unchanged |
| **Lost HTTP Response Retry** | Client retries exchange with same capability | Return existing active `currentToken` | Client recovers lost bearer token | Unchanged |
| **Explicit Rotation** | Explicit rotation commanded or near-expiry | `graceToken` $\leftarrow$ `currentToken`; `graceExpiresAt` $\leftarrow$ now + 30s; mint new `currentToken` | Return new `currentToken` | In-flight requests with `graceToken` succeed for 30s |
| **Full Browser Reload (F5)** | Parent window reloads; memory lost | Call backend `POST /payments/:id/checkout-sessions` (idempotent) | Returns reconstructed URL | New session entry created if previous expired |
| **Terminal Payment** | Payment transitions to `captured`, `failed`, or `cancelled` | `SessionTokenVault.revoke(sessionId)` | Sub-millisecond buffer zeroization (`fill(0)`) | Subsequent calls fail closed (409) |

---

## 4. Event Sequencing & Serialized Precision

### 4.1 Monotonic BigInt Sequencing
To avoid JavaScript 53-bit integer overflow (`Number.MAX_SAFE_INTEGER` = $9,007,199,254,740,991$) in long-running testing environments or stress benchmarks, PAYSIM maintains global sequence counters as internal native `bigint` primitives:

```typescript
export interface CanonicalEvent {
  readonly id: string;               // e.g. "evt_ps_01H..."
  readonly type: string;             // e.g. "payment.captured"
  readonly globalSeq: bigint;        // Monotonic sequence in process memory
  readonly orderVersion: number;     // Aggregate version on MockOrder
  readonly paymentVersion: number;   // Aggregate version on MockPayment
  readonly correlationId: string;    // Root orderId ("ord_ps_...")
  readonly causationId: string;      // Direct cause (requestId or predecessor eventId)
  readonly createdAt: string;        // ISO 8601 UTC timestamp
  readonly simulated: boolean;
  readonly livemode: false;
  readonly schemaVersion: 1;
  readonly canonicalPayload: Readonly<Record<string, unknown>>;
}
```

### 4.2 Lossless JSON Wire Representation
Standard `JSON.stringify` throws a `TypeError: Do not know how to serialize a BigInt` when encountering a native `bigint`.

**Wire Contract Rule:**  
In all JSON API responses, SSE streams, and webhook delivery payloads, `globalSeq` **must be serialized as a base-10 decimal string**:

```json
{
  "id": "evt_ps_002_cap",
  "type": "payment.captured",
  "globalSeq": "102",
  "orderId": "ord_ps_999",
  "paymentId": "pay_ps_888",
  "orderVersion": 2,
  "paymentVersion": 3,
  "correlationId": "ord_ps_999",
  "causationId": "evt_ps_001_auth",
  "createdAt": "2026-11-03T02:00:00.010Z",
  "simulated": true,
  "livemode": false,
  "schemaVersion": 1,
  "canonicalPayload": {
    "payment": {
      "id": "pay_ps_888",
      "status": "captured",
      "captured": true
    }
  }
}
```

### 4.3 Deterministic Cross-Aggregate Ordering
During compound transitions (e.g. single-step auto-capture modifying both `Payment` and `Order` aggregates), events are emitted with strict consecutive `globalSeq` allocations:
1. `payment.authorized` $\rightarrow$ `globalSeq: "101"`, `paymentVersion: 2`, `orderVersion: 2`.
2. `payment.captured` $\rightarrow$ `globalSeq: "102"`, `paymentVersion: 3`, `orderVersion: 2`.
3. `order.paid` $\rightarrow$ `globalSeq: "103"`, `paymentVersion: 3`, `orderVersion: 3`.

---

## 5. Lock Hierarchy & Complete Acquisition Paths Audit

### 5.1 Global Total Lock Order
All asynchronous locks in PAYSIM must be acquired strictly in ascending tier order:

$$\text{Tier 1: Idempotency} < \text{Tier 2: Order} < \text{Tier 3: Session} < \text{Tier 4: Delivery} < \text{Tier 5: Retention}$$

```text
Tier 1: AsyncLock("idemp:" + scopeKey)
          │
          ▼
Tier 2: AsyncLock("order:" + orderId)
          │
          ▼
Tier 3: AsyncLock("session:" + sessionId)
          │
          ▼
Tier 4: AsyncLock("delivery:" + deliveryId)
          │
          ▼
Tier 5: Synchronous Reservation Mutex (RetentionCoordinator)
```

### 5.2 Same-Tier Multi-Entity Lexicographical Ordering
When an operation requires locking multiple entities within the same tier (e.g., bulk order operations or replaying deliveries across multiple items), locks must be acquired in **strict lexicographical order of their resource keys**:

$$\text{Key}_A < \text{Key}_B \implies \text{acquire}(\text{Key}_A) \text{ before } \text{acquire}(\text{Key}_B)$$

If Order 2 (`ord_ps_222`) and Order 1 (`ord_ps_111`) are both required by a batch command, the worker sorts the keys:
`["ord_ps_111", "ord_ps_222"]`, acquiring `ord_ps_111` first, then `ord_ps_222`. This guarantees that no two workers can invert lock acquisition order.

### 5.3 Lock Acquisition Timeout and Cancellation
To eliminate thread starvation and resource hanging:
* Every lock acquisition mandates a **maximum timeout of 5,000 ms**.
* If a lock cannot be acquired within 5,000 ms, the acquisition promise rejects with `408 REQUEST_TIMEOUT` or `503 SERVICE_UNAVAILABLE`.
* All locks support cancellation via standard `AbortSignal`.

### 5.4 Complete System Lock-Acquisition Matrix

| Inbound Path / Job | Locks Acquired (In Order) | Max Tiers | Lexicographical Rule Applied? | Timeout | Failure Mode |
|---|---|:---:|:---:|:---:|---|
| `POST /orders` | Tier 1 (`idemp`) $\rightarrow$ Tier 5 (`retention`) | 1, 5 | N/A (single key) | 5,000ms | Releases Tier 1; returns error |
| `POST /orders/:id/payment-attempts` | Tier 1 (`idemp`) $\rightarrow$ Tier 2 (`order`) $\rightarrow$ Tier 5 (`retention`) | 1, 2, 5 | N/A (single order) | 5,000ms | Releases in reverse order; returns 408/503 |
| `POST /checkout/:id/exchange` | Tier 3 (`session`) | 3 | N/A (single session) | 5,000ms | Returns 408; no state mutated |
| `POST /payments/:id/simulate` | Tier 2 (`order`) $\rightarrow$ Tier 3 (`session`) $\rightarrow$ Tier 5 (`retention`) | 2, 3, 5 | Order locked before Session | 5,000ms | Releases in reverse order; zero entities updated |
| `POST /deliveries/:id/retry` | Tier 4 (`delivery`) $\rightarrow$ Tier 5 (`retention`) | 4, 5 | N/A (single delivery) | 5,000ms | Returns 408; job remains queued |
| `POST /deliveries/bulk-replay` | Tier 4 (`delivery:A`) $\rightarrow$ Tier 4 (`delivery:B`) | 4 | **YES** ($A < B$ sorted) | 5,000ms | Releases held locks; aborts batch |
| `SessionSweeper` (15m TTL) | Tier 3 (`session`) $\rightarrow$ Tier 5 (`retention`) | 3, 5 | N/A (single session) | 5,000ms | Skips locked session until next tick |
| `AttemptSweeper` (30m Max) | Tier 2 (`order`) $\rightarrow$ Tier 5 (`retention`) | 2, 5 | N/A (single order) | 5,000ms | Skips locked order until next tick |

> **Audit Proof:** Across all eight operational paths, no thread holding a lock of Tier $N$ ever attempts to acquire a lock of Tier $\le N$, except under lexicographical ordering where $\text{Key}_A < \text{Key}_B$. Therefore, the lock dependency graph is strictly acyclic. Deadlock is mathematically prevented under all scheduling conditions.

---

## 6. Webhook Delivery Semantics & Concurrency Realities

### 6.1 Non-Guaranteed Delivery Order Declaration
PAYSIM formally specifies that **strict, sequential in-order webhook delivery to consumer endpoints cannot be guaranteed across network boundaries**.

#### Root Causes:
1. **Concurrent Worker Pool:** PAYSIM dispatches deliveries using a pool of up to 5 concurrent workers. If Event 1 (`payment.authorized`) and Event 2 (`payment.captured`) are queued in rapid succession, Worker A (handling Event 1) may experience HTTP socket latency or TCP handshake delays, allowing Worker B (handling Event 2) to complete delivery first.
2. **Exponential Backoff Retries:** If Event 1 encounters an endpoint `503 Service Unavailable` or socket timeout, it enters retry backoff (e.g. 1s, 2s, 4s). Event 2 may succeed immediately, causing Event 2 to arrive before Event 1.

### 6.2 Consumer Integration Contracts
To ensure robust integration, consumers must adhere to two normative requirements:
1. **Downstream Version & Sequence Validation:** Consumers must inspect `orderVersion`, `paymentVersion`, and `globalSeq`. If a consumer receives `payment.captured` (`paymentVersion: 3`) before `payment.authorized` (`paymentVersion: 2`), it must process the event idempotently and recognize that the payment is in terminal state.
2. **Deduplication:** Consumers must deduplicate incoming webhooks by caching event `id` or `(type, entityId, version)` in their local idempotency stores.

---

## 7. Secret Retention Lifecycle & Reference Counting

### 7.1 Maximum Pending Attempt Lifetime (30 Minutes)
To prevent orphaned payment attempts from permanently pinning obsolete secret buffers in memory:
* Every payment attempt in non-terminal state (`created`, `pending`, `authorized`) has a **maximum pending lifetime of 30 minutes**.
* A background `AttemptSweeper` runs every 60 seconds. Any attempt exceeding 30 minutes is automatically transitioned to `failed` (`failureReason: "PENDING_ATTEMPT_TIMEOUT"`).
* This transition decrements `activeAttemptCount`, enabling zeroization of aged keys.

### 7.2 Full Reference Counting Matrix

| Attempt State | Active Attempt Count ($\Delta$) | Compatibility Secret Vault Status | Zeroization Trigger |
|---|:---:|---|---|
| `created` | **+1** | Buffer pinned in memory | Counter $> 0$; retention held |
| `pending` | **0** (Held) | Buffer pinned in memory | Counter $> 0$; retention held |
| `authorized` | **0** (Held) | Buffer pinned in memory | Counter $> 0$; retention held |
| `captured` | **-1** | Compute callback HMAC; decrement counter | If count == 0 and key inactive $\rightarrow$ `buffer.fill(0)` & purge |
| `failed` | **-1** | Decrement counter | If count == 0 and key inactive $\rightarrow$ `buffer.fill(0)` & purge |
| `cancelled` | **-1** | Decrement counter | If count == 0 and key inactive $\rightarrow$ `buffer.fill(0)` & purge |

### 7.3 Capability Expiry Invariant Reaffirmed
* When a 15-minute checkout capability token expires:
  - Only the ephemeral token is purged from `SessionTokenVault`.
  - The payment attempt **remains in `created` state**.
  - `activeAttemptCount` is **NOT decremented**.
  - The payment attempt is **NEVER cancelled**.
  - Secret retention remains intact for subsequent session reissue via `POST /payments/:id/checkout-sessions`.

### 7.4 Rotation Ceiling Recovery
* `CompatibilitySecretVault` enforces a hard ceiling of **5 retained credential versions**.
* If 5 versions are active and an administrator attempts a 6th rotation, the request fails with `429 TOO_MANY_CREDENTIAL_VERSIONS`.
* **Ceiling Recovery:** As pending attempts settle (via completion or the 30-minute sweeper), older version reference counts reach zero, triggering memory zeroization and eviction, thereby restoring rotation capacity.

---

## 8. Formal System Capacity Model

PAYSIM establishes strict, bounded memory and resource limits across all processing stages:

```text
┌─────────────────────────────────────────────────────────────┐
│                    PAYSIM CAPACITY MODEL                    │
├────────────────────────────────┬────────────────────────────┤
│ Subsystem Component            │ Bound / Hard Limit         │
├────────────────────────────────┼────────────────────────────┤
│ Webhook Dispatch Waiting Queue │ 100 queued delivery tasks  │
│ Active Concurrent Workers      │ 5 worker threads/promises  │
│ Total Outstanding Jobs         │ 105 jobs max (100 + 5)     │
│ Event Repository Storage       │ 2,000 canonical events     │
│ Delivery Repository Storage    │ 5,000 delivery records     │
│ Retained Secret Versions       │ 5 versions max             │
│ In-Flight Reservation Pool     │ Synchronously bounded      │
└────────────────────────────────┴────────────────────────────┘
```

### Saturated Storage Invariant:
When Delivery Repository reaches 5,000 records or Event Repository reaches 2,000 events:
* `RetentionCoordinator` synchronously evaluates capacity.
* Eviction of settled records is evaluated (FIFO based on timestamp).
* If records are unevictable, the transaction fails closed with `429 RESOURCE_LIMIT_REACHED`.
* Under no circumstances is a delivery record created without confirmed storage capacity.

---

## 9. Conclusion

Phase 02.6 completely seals all remaining technical inconsistencies. With single immutable root state pointer swapping, `BigInt` decimal sequencing, lexicographical multi-entity locking, and explicit delivery order contracts, the architecture is fully prepared for Phase 03 implementation.
