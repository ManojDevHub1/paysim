# PAYSIM — Phase 03.3.1.3 Final Domain Boundary Verification Report

**Document Version:** 1.0.0  
**Phase:** Phase 03.3.1.3 — Final Domain Boundary Verification & Correction  
**Status:** Certified & Hardened  
**Role:** Principal TypeScript Architect  
**Date:** 3 November 2026  
**Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`) | System Architecture (`docs/SYSTEM_ARCHITECTURE.md`) | ADR-003, ADR-005, ADR-007, ADR-008 | Frozen `@paysim/contracts` package  

---

## 1. Executive Summary & Objective

Phase 03.3.1.3 resolves the remaining architectural domain-boundary ambiguities and cleanly decouples domain logic from wire transport serialization prior to entering Phase 03.3.2.

### Scope & Compliance
1. **Simulation Outcome Boundary:** Verified that `NormativeSimulationOutcome` and public-facing `simulatePaymentOutcome()` strictly accept **only** normative outcomes (`'success' | 'pending' | 'failed' | 'cancelled'`) matching the frozen contracts package (`SimulatePaymentOutcomeRequestSchema`). `'authorize'` is not exposed as a public simulation outcome. Compile-time (`@ts-expect-error`) and runtime (`PaymentValidationError`) rejection tests were implemented.
2. **Payment Version Monotonicity & Lifecycle Paths:** Audited and tested both authorization paths:
   - **Path 1:** `created` ($v_1$) $\to$ `authorized` ($v_2$) $\to$ `captured` / `cancelled` ($v_3$)
   - **Path 2:** `created` ($v_1$) $\to$ `pending` ($v_2$) $\to$ `authorized` ($v_3$) $\to$ `captured` / `cancelled` ($v_4$)
   Verified that versions increment dynamically by exactly one with zero hardcoding, event snapshots reflect exact versions, terminal states remain immutable, wrong order correlation and already-paid orders fail closed, and subsequent payment attempts after cancellation function as aggregate updates.
3. **Domain vs Transport Serialization Decoupling:** Moved all wire serialization logic (`serializeToNativeWebhookEvent`, `serializeToCompatWebhookEvent`, `formatCompatWebhookEvent`) out of `@paysim/domain` into the server adapter layer [`apps/server/src/adapters/webhook-serialization.adapter.ts`](file:///e:/All%20Project/Paysim/apps/server/src/adapters/webhook-serialization.adapter.ts). The Domain package owns strictly canonical event drafts, causal IDs, and immutable entity snapshots with zero imports of `NativeWebhookEventSchema` or `CompatWebhookEventSchema`.
4. **Webhook Event Format Verification:** Formally verified that `payment.cancelled` is supported by the Native Webhook format (`NativeEventTypeSchema`), and unsupported by the Razorpay Compatibility Webhook format (`CompatEventTypeSchema`). The compatibility adapter returns an explicit structured result (`supported: false` with explanatory reason) rather than silently discarding unsupported event types.
5. **Fixture Byte Preservation:** Committed test fixtures remain 100% bit-for-bit preserved (333 B, 474 B, 293 B, 389 B).
6. **Monorepo Quality Gate:** All 223 tests pass across 12 test suites with 0 typecheck errors and 0 lint warnings.

---

## 2. Exact Files Modified & Before/After Behavior

### 2.1 `packages/domain/src/payments/payment.simulation.ts`
- **Before:**
  - `SimulationOutcome` was defined as `NormativeSimulationOutcome | 'authorize'`, allowing `'authorize'` to be passed into `simulatePaymentOutcome()`.
  - `simulatePaymentOutcome()` contained internal routing `if (outcome === 'authorize')` which created a public API boundary mismatch against the frozen contracts schema.
  - `preparePaymentAuthorization()` restricted input payments to `payment.status === 'created'`, prohibiting authorization from `pending` state (Path 2).
- **After:**
  - `SimulationOutcome` is defined strictly as `export type SimulationOutcome = NormativeSimulationOutcome;` (`'success' | 'pending' | 'failed' | 'cancelled'`).
  - `simulatePaymentOutcome()` rejects `'authorize'` and any non-normative input at both compile-time and runtime (returning `PaymentValidationError`).
  - `preparePaymentAuthorization()` allows payments in either `'created'` or `'pending'` status, dynamically incrementing `payment.version + 1` with zero hardcoding.

### 2.2 `packages/domain/src/events/event.factory.ts`
- **Before:**
  - Imported `NativeWebhookEvent`, `CompatWebhookEvent`, and `CompatEventType` from `@paysim/contracts`.
  - Contained `serializeToNativeWebhookEvent()` and `serializeToCompatWebhookEvent()` wire formatting functions inside the domain package.
- **After:**
  - Removed all wire serialization functions and types from the domain package.
  - Domain package imports only entity types (`NativePaymentObject`, `NativeOrderObject`) and event type definitions needed for domain drafts.
  - Domain owns solely `DomainEventDraft`, canonical domain metadata, causal chaining, and immutable domain snapshots.

### 2.3 `apps/server/src/adapters/webhook-serialization.adapter.ts` (New File)
- **Implementation:**
  - Created dedicated transport adapter for outbound webhook serialization.
  - `serializeToNativeWebhookEvent(draft: DomainEventDraft): NativeWebhookEvent`: Maps domain drafts to native wire schema. Fully supports `payment.cancelled`.
  - `serializeToCompatWebhookEvent(draft: DomainEventDraft): CompatSerializationResult`: Maps supported event types (`authorized`, `captured`, `failed`, `order.paid`) to `CompatWebhookEvent`, and explicitly returns `{ supported: false, eventType, reason }` for unsupported types (`payment.cancelled`, `payment.pending`, `payment.created`).
  - `formatCompatWebhookEvent(draft: DomainEventDraft): CompatWebhookEvent | null`: Convenience formatter for nullable use cases.

### 2.4 `packages/domain/tests/simulation.test.ts`
- **Before:**
  - Imported `CompatWebhookEventSchema`, `serializeToNativeWebhookEvent`, `serializeToCompatWebhookEvent`.
  - Tested `simulatePaymentOutcome({ outcome: 'authorize' })`.
  - Tested wire serialization inside domain unit tests.
- **After:**
  - Removed wire serializer imports and schema imports.
  - Added compile-time (`@ts-expect-error`) and runtime test asserting that `simulatePaymentOutcome()` strictly rejects `outcome: 'authorize'`.
  - Section 5 refactored to test `Canonical Domain Event Draft Invariants (Transport-Neutral)` against `WireCanonicalEventSchema`.

### 2.5 `packages/domain/tests/matrix.test.ts`
- **Additions:**
  - Added exhaustive tests for **Path 1** (`created -> authorized -> captured/cancelled`) and **Path 2** (`created -> pending -> authorized -> captured/cancelled`).
  - Verified dynamic version increments ($1 \to 2 \to 3$ for Path 1, $1 \to 2 \to 3 \to 4$ for Path 2) with zero hardcoding.
  - Verified terminal immutability, duplicate cancellation rejection, wrong order correlation rejection, and subsequent payment attempt creation on cancelled orders.

### 2.6 `apps/server/tests/webhook-serialization.test.ts` (New File)
- **Implementation:**
  - Added 7 dedicated unit tests verifying Native and Compatibility wire serialization, structured rejection of `payment.cancelled` and `payment.pending` in compatibility mode, and byte-exact verification of all 4 committed test fixtures.

---

## 3. Payment Version Monotonicity Traceability

| Stage | Path 1: Direct Hold | Path 2: Async Resolution Hold | Order Status / Version | Emitted Event Draft & Versions |
|:---|:---:|:---:|:---:|:---|
| **Initial Creation** | `created` ($v_1$) | `created` ($v_1$) | `attempted` ($v_2$) | — |
| **Async Step** | — | `pending` ($v_2$) | `attempted` ($v_2$) | `payment.pending` (`payVer: 2, ordVer: 2`) |
| **Authorization** | `authorized` ($v_2$) | `authorized` ($v_3$) | `attempted` ($v_2$) | `payment.authorized` (`payVer: 2/3, ordVer: 2`) |
| **Explicit Capture** | `captured` ($v_3$) | `captured` ($v_4$) | `paid` ($v_3$) | `payment.captured` (`payVer: 3/4, ordVer: 2`) $\to$ `order.paid` (`payVer: 3/4, ordVer: 3`) |
| **Void / Cancellation** | `cancelled` ($v_3$) | `cancelled` ($v_4$) | `attempted` ($v_2$) | `payment.cancelled` (`payVer: 3/4, ordVer: 2`) |

---

## 4. Webhook Event Type Support Matrix (PRD v2.3.0)

| Event Type | Native Webhook (`NativeWebhookEventSchema`) | Razorpay Compatibility (`CompatWebhookEventSchema`) | Adapter Behavior on Unsupported |
|:---|:---:|:---:|:---|
| `payment.authorized` | ✅ Supported | ✅ Supported | Formatted as `event: 'payment.authorized'` |
| `payment.captured` | ✅ Supported | ✅ Supported | Formatted as `event: 'payment.captured'` |
| `payment.failed` | ✅ Supported | ✅ Supported | Formatted as `event: 'payment.failed'` |
| `order.paid` | ✅ Supported | ✅ Supported | Formatted as `event: 'order.paid'` |
| `payment.cancelled` | ✅ Supported | ❌ **Unsupported** | Returns `{ supported: false, eventType: 'payment.cancelled', reason: ... }` |
| `payment.pending` | ✅ Supported | ❌ **Unsupported** | Returns `{ supported: false, eventType: 'payment.pending', reason: ... }` |
| `payment.created` | ✅ Supported | ❌ **Unsupported** | Returns `{ supported: false, eventType: 'payment.created', reason: ... }` |

---

## 5. Automated Test Suite Execution Evidence

All 12 test suites across the monorepo pass cleanly:

```
 RUN  v2.1.9 E:/All Project/Paysim

 ✓ packages/crypto/tests/crypto.test.ts (5 tests) 6ms
 ✓ packages/shared/tests/shared.test.ts (7 tests) 27ms
 ✓ packages/storage-memory/tests/storage.test.ts (21 tests) 9ms
 ✓ packages/contracts/tests/contracts.test.ts (56 tests) 39ms
 ✓ apps/server/tests/server.test.ts (2 tests) 34ms
 ✓ packages/domain/tests/domain.test.ts (1 test) 3ms
 ✓ packages/domain/tests/payments.test.ts (16 tests) 7ms
 ✓ tests/smoke.test.ts (5 tests) 4ms
 ✓ packages/domain/tests/orders.test.ts (17 tests) 14ms
 ✓ packages/domain/tests/simulation.test.ts (25 tests) 19ms
 ✓ packages/domain/tests/matrix.test.ts (61 tests) 21ms
 ✓ apps/server/tests/webhook-serialization.test.ts (7 tests) 15ms

 Test Files  12 passed (12)
      Tests  223 passed (223)
   Duration  895ms
```

- **TypeScript Strict Typecheck (`npm run typecheck`):** 0 errors.
- **ESLint Clean Gate (`npm run lint`):** 0 warnings, 0 errors.
- **Production Build (`npm run build`):** Exit code 0.
- **Fixture Byte Preservation:**
  - `fixtures/events-compat/payment.captured.body.json`: 333 bytes (Exact match)
  - `fixtures/events-compat/payment.captured.json`: 474 bytes (Exact match)
  - `fixtures/events-native/payment.captured.body.json`: 293 bytes (Exact match)
  - `fixtures/events-native/payment.captured.json`: 389 bytes (Exact match)

---

## 6. Engineering Limitations & Concurrency Disclaimer

> [!WARNING]
> **Definitive Concurrency & Transactional Boundary Disclaimer:**
> The `@paysim/domain` package contains pure, synchronous in-memory business logic.
> 1. It does **not** implement database transactions or rollbacks.
> 2. It does **not** acquire concurrency locks, semaphores, or mutexes.
> 3. It does **not** execute compare-and-swap (CAS) pointer swaps on a shared root state pointer.
>
> All concurrency safety, lexicographical order-tier locks (ADR-005), RootState coordinator transactions (ADR-003), monotonic global sequence assignment, and repository commits belong exclusively to **Phase 03.3.2 (RootState Coordinator & Repositories)**. Do not assume or claim concurrency thread-safety at the pure domain engine layer.

---

## 7. Phase 03.3.2 Entry Criteria Assessment

| Criterion | Requirement | Status | Evidence |
|:---|:---|:---:|:---|
| **EC-01** | Pure deterministic Order state machine | **SATISFIED** | 17 tests in `orders.test.ts` |
| **EC-02** | Pure deterministic Payment state machine (all 36 pairs) | **SATISFIED** | 61 tests in `matrix.test.ts` |
| **EC-03** | Simulation outcomes match public contract strictly | **SATISFIED** | Compile-time & runtime rejection of `'authorize'` |
| **EC-04** | Dynamic payment version monotonicity across all paths | **SATISFIED** | Paths 1 & 2 tested ($v_1 \to v_2 \to v_3$ and $v_1 \to v_2 \to v_3 \to v_4$) |
| **EC-05** | Domain decoupled from transport wire serialization | **SATISFIED** | Moved to `apps/server/src/adapters/` |
| **EC-06** | Test fixture bytes preserved | **SATISFIED** | Exact match: 333 B, 474 B, 293 B, 389 B |
| **EC-07** | Monorepo quality gate (typecheck, lint, test, build) | **SATISFIED** | 223 tests passing across 12 suites |

**All Phase 03.3.2 entry criteria are satisfied. Awaiting user authorization before initiating Phase 03.3.2.**