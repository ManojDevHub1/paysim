# PAYSIM — Phase 03.3.3 Implementation Report

**Document Version:** 1.0.0  
**Phase:** Phase 03.3.3 — Application Service Layer & Use Case Orchestration  
**Status:** Verification Complete — Foundation Implemented & 100% Certified  
**Normative Baseline:** PRD v2.3.0 ([`docs/PRD_v2.3.md`](file:///e:/All%20Project/Paysim/docs/PRD_v2.3.md)), System Architecture ([`docs/SYSTEM_ARCHITECTURE.md`](file:///e:/All%20Project/Paysim/docs/SYSTEM_ARCHITECTURE.md)), ADR-001 through ADR-010  
**Lead Architect:** Principal TypeScript Application Architect  
**Date:** November 2026  

---

## 1. Executive Summary & Objective

In Phase 03.3.3, the Application Service Layer was implemented, bridging the frozen contracts (`@paysim/contracts`), pure domain state machines (`@paysim/domain`), transactional storage engine (`@paysim/storage-memory`), cryptographic tools (`@paysim/crypto`), and webhook wire adapters (`apps/server/src/adapters/`).

### Core Governance Constraints Preserved:
1. **Zero HTTP Transport in Domain:** The domain engine remains strictly pure, deterministic, and independent of HTTP sockets, request objects, or Express frameworks.
2. **CommitCoordinator Transactional Authority:** Application services never mutate in-memory state or RootState directly. All mutations execute inside transactional units managed by `CommitCoordinator.transaction()`.
3. **No Network Calls in Transactions:** Webhook retry and replay operations create or update in-memory delivery queues and schedule retry timestamps without opening outbound sockets inside transactions.
4. **Strict Secret Decoupling:** Raw webhook signing secrets and capability tokens are held exclusively in process-memory vaults (`WebhookSecretVault`), isolated behind short-lived 60-second disclosure references. Raw secrets are never stored in `RootState` or returned via inspection endpoints.
5. **No Express Routes or Frontend UI in Phase 03.3.3:** Transport-level Express ingress mounting and React frontend components remain deferred to Phase 03.4 and Phase 03.5.

---

## 2. Architecture Discovery & Dependency Map

The Application Layer is housed in `apps/server/src/application/` to provide cohesive integration between core packages and server adapters while maintaining decoupled boundaries from Express routes:

```
               ┌───────────────────────┐
               │   @paysim/contracts   │ (Frozen Schemas, DTOs & Error Codes)
               └───────────▲───────────┘
                           │
               ┌───────────┴───────────┐
               │    @paysim/domain     │ (Pure State Machines & Entities)
               └───────────▲───────────┘
                           │
               ┌───────────┴───────────┐
               │@paysim/storage-memory │ (RootState, Coordinator & Repositories)
               └───────────▲───────────┘
                           │
  ┌────────────────────────┴────────────────────────┐
  │         apps/server/src/application/            │
  │  ├── errors/       (ApplicationError & Mappings)│
  │  ├── services/                                  │
  │  │     ├── order.service.ts                     │
  │  │     ├── payment.service.ts                   │
  │  │     ├── checkout.service.ts                  │
  │  │     ├── control.service.ts                   │
  │  │     └── webhook.service.ts                   │
  │  ├── context.ts    (ApplicationContext Facade)  │
  │  └── index.ts                                   │
  └────────────────────────┬────────────────────────┘
                           │
      (Phase 03.4: Express Ingress Routes & Controllers)
```

---

## 3. Foundation & Context Composition (`ApplicationContext`)

The application layer exposes a unified facade instantiated via [`createApplicationContext()`](file:///e:/All%20Project/Paysim/apps/server/src/application/context.ts#L33):

```typescript
export interface ApplicationContext {
  readonly stateHolder: RootStateHolder;
  readonly coordinator: CommitCoordinator;
  readonly lockManager: LockManager;
  readonly secretVault: WebhookSecretVault;
  readonly idempotencyStore: IdempotencyStore;
  readonly orders: OrderService;
  readonly payments: PaymentService;
  readonly checkout: CheckoutService;
  readonly control: ControlService;
  readonly webhooks: WebhookService;
}
```

---

## 4. Implemented Use Cases by Domain

### 4.1 Order Use Cases ([`OrderService`](file:///e:/All%20Project/Paysim/apps/server/src/application/services/order.service.ts))
- **`createOrder(options)`:**
  - Validates payload against `CreateOrderRequestSchema`.
  - Enforces 5-tuple idempotency partitioning (`native_order`, principal, `POST`, `/api/v1/orders`, key). On key replay with matching fingerprint, returns cached response. On conflicting fingerprint, throws `IDEMPOTENCY_KEY_REUSED` (409).
  - Invokes `createMockOrder()` to instantiate aggregate with monotonic version `1`.
  - Atomically commits order and idempotency record.
- **`createCompatOrder(options)`:**
  - Validates Razorpay compatibility payload (`CompatCreateOrderRequestSchema`).
  - Delegates to `createOrder` and maps native entity to `CompatOrderResponse`.
- **`getOrder(orderId)`:**
  - Retrieves order from snapshot; throws `NOT_FOUND` (404) if missing.
- **`listOrders(filter)`:**
  - Returns orders matching status, limit, and offset.
- **`getOrderPayments(orderId)`:**
  - Asserts order existence and returns all associated payment attempts.

### 4.2 Payment Use Cases ([`PaymentService`](file:///e:/All%20Project/Paysim/apps/server/src/application/services/payment.service.ts))
- **`createPaymentAttempt(options)`:**
  - Validates that order is not terminal `paid` (`ORDER_ALREADY_PAID`, 409).
  - Enforces the invariant: at most one active attempt (`created`, `pending`, `authorized`) per order (`ACTIVE_PAYMENT_ATTEMPT_EXISTS`, 409).
  - Invokes `createPaymentAttempt()` and updates order to `attempted` (`version: v + 1`).
  - Drafts and commits `payment.created` domain event atomically.
- **`simulateOutcome(options)`:**
  - Validates outcome against normative union: `['success', 'pending', 'failed', 'cancelled']`.
  - Rejects simulation on terminal payments (`INVALID_STATE_TRANSITION`, 409).
  - For `'success'`: executes compound auto-capture (`created -> authorized -> captured`), marks order `paid`, and emits `[payment.authorized, payment.captured, order.paid]` in causal order.
  - For `'failed'`: transitions payment to `failed` with reason (`INSUFFICIENT_FUNDS`, etc.), order remains `attempted`.
  - For `'pending'`: transitions payment to `pending`, emits `payment.pending`.
  - For `'cancelled'`: transitions payment to `cancelled`, emits `payment.cancelled`.
- **`resolvePending(options)`:**
  - Validates that payment is in `pending` status.
  - Resolves to `'success'`, `'failed'`, or `'cancelled'`, updating payment and order versions.
- **`captureAuthorized(options)`:**
  - Validates payment is `authorized`. Transitions payment to `captured` and order to `paid`.
- **`cancelAuthorized(options)`:**
  - Validates payment is `authorized`. Transitions payment to `cancelled` with `PaymentFailureReason`.
- **`getPayment(id)` & `listPayments(filter)`:**
  - Provides read-only facade queries with 404 enforcement.

### 4.3 Checkout Use Cases ([`CheckoutService`](file:///e:/All%20Project/Paysim/apps/server/src/application/services/checkout.service.ts))
- **`createSession(options)`:**
  - Generates a 64-character hex capability token with 32 bytes of cryptographically secure random entropy (`generateOpaqueToken`).
  - Stores **only** the SHA-256 hash (`opaqueTokenHash`) in `RootState`, strictly shielding raw tokens.
  - Sets 15-minute TTL (`expiresAt`).
  - Returns `CreateCheckoutSessionResponse` containing one-time disclosure of raw `capabilityToken`.
- **`getSession(sessionId)`:**
  - Returns session entity; evaluates runtime expiration.
- **`exchangeToken(options)`:**
  - Computes SHA-256 hash of provided capability token and verifies against `opaqueTokenHash`.
  - Checks expiration (`CHECKOUT_SESSION_EXPIRED`, 410) and validity (`CONTROL_TOKEN_INVALID`, 401).
  - Updates session status to `consumed`.
  - Issues ephemeral `sessionAccessToken` and `csrfToken` along with order/payment details for iframe hydration.
- **`rotateToken(options)`:**
  - Generates new token hash with 30-second grace window for previous token.

### 4.4 Control & Credential Use Cases ([`ControlService`](file:///e:/All%20Project/Paysim/apps/server/src/application/services/control.service.ts))
- **`sessionExchange(token)` & `sessionLogout(token)`:**
  - Exchanges bootstrap token for persistent dashboard control session; supports revocation.
- **`rotateNativeCredential(options)`:**
  - Generates `ps_test_...` bearer token. Commits retention update.
  - Returns one-time disclosure response.
- **`rotateCompatCredential(options)`:**
  - Generates `rzp_test_...` keyId and raw keySecret. Increments active compatibility version.
- **`getCredentialsOverview()`:**
  - Returns safe metadata with masked credentials (`ps_test_••••••••1234`).
  - **Never** exposes raw secrets or bearer tokens.

### 4.5 Webhook Management Use Cases ([`WebhookService`](file:///e:/All%20Project/Paysim/apps/server/src/application/services/webhook.service.ts))
- **`createEndpoint(options)`:**
  - Validates destination with strict literal loopback policy (`LoopbackUrlSchema`). Rejects remote destinations, container bridges, and sensitive ports (e.g. 5000).
  - Encapsulates raw secret Buffer in `WebhookSecretVault`.
  - Inserts endpoint with `secretVersion: 1`, `configVersion: 1`.
- **`updateEndpoint(id, request)`:**
  - Updates URL, status, and subscribed events, incrementing `configVersion`.
- **`rotateSecret(options)`:**
  - Generates new secret in `WebhookSecretVault`. Creates 60s disclosure reference.
  - Increments `secretVersion` (enforcing max 5 secret versions bound).
  - Supports idempotent rotation replay via `IdempotencyStore`.
- **`getDelivery(id)` & `listDeliveries(filter)`:**
  - Facilitates inspection of webhook delivery status and attempt history.
- **`retryDelivery(options)`:**
  - Resets delivery status to `pending`, increments attempts, and schedules next retry.
  - Rejects retrying in-progress deliveries (`INVALID_STATE_TRANSITION`, 409).
- **`replayEvent(eventId)`:**
  - Queries active subscribed endpoints for the canonical event.
  - Creates pending delivery records for matching endpoints.
  - Skips unsupported event types for compatibility endpoints per `SUPPORTED_COMPAT_EVENT_TYPES`.

---

## 5. Transaction Usage & Error Mapping

All application errors map to the 30 normative codes in `ERROR_CATALOGUE`:

| Error Code | HTTP Status | Domain Source | Application Mapping |
|---|:---:|---|---|
| `VALIDATION_ERROR` | 422 | Zod schema parse failure | `createValidationError` |
| `NOT_FOUND` | 404 | Missing entity in repository | `createNotFoundError` |
| `ORDER_ALREADY_PAID` | 409 | Attempt on paid order | `createOrderAlreadyPaidError` |
| `ACTIVE_PAYMENT_ATTEMPT_EXISTS` | 409 | Concurrent attempt on order | `createActivePaymentAttemptExistsError` |
| `INVALID_STATE_TRANSITION` | 409 | Illegal state machine transition | `createInvalidStateTransitionError` |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key with differing payload | `createIdempotencyKeyReusedError` |
| `CONTROL_TOKEN_INVALID` | 401 | Invalid token hash | `createControlTokenInvalidError` |
| `CHECKOUT_SESSION_EXPIRED` | 410 | Expired session exchange/rotation | `createCheckoutSessionExpiredError` |
| `RESOURCE_LIMIT_REACHED` | 429 | Saturated version/storage bound | `createResourceLimitReachedError` |

---

## 6. Monorepo Quality Pipeline Results

```
> paysim-monorepo@1.0.0 typecheck
> tsc --build
[Exit 0 - 0 errors]

> paysim-monorepo@1.0.0 lint
> eslint .
[Exit 0 - 0 errors, 0 warnings]

> paysim-monorepo@1.0.0 test
> vitest run

 RUN  v2.1.9 E:/All Project/Paysim

 ✓ packages/contracts/tests/contracts.test.ts (56 tests)
 ✓ packages/storage-memory/tests/storage.test.ts (21 tests)
 ✓ packages/domain/tests/payments.test.ts (16 tests)
 ✓ packages/domain/tests/orders.test.ts (17 tests)
 ✓ packages/domain/tests/simulation.test.ts (25 tests)
 ✓ packages/domain/tests/matrix.test.ts (61 tests)
 ✓ apps/server/tests/webhook-serialization.test.ts (7 tests)
 ✓ packages/storage-memory/tests/coordinator.test.ts (7 tests)
 ✓ packages/storage-memory/tests/repositories.test.ts (17 tests)
 ✓ packages/storage-memory/tests/read-write-isolation.test.ts (9 tests)
 ✓ packages/storage-memory/tests/failure-injection.test.ts (16 tests)
 ✓ apps/server/tests/application/webhook-use-cases.test.ts (11 tests)  [NEW PHASE 03.3.3 SUITE]
 ✓ packages/storage-memory/tests/concurrency-integrity.test.ts (14 tests)
 ✓ apps/server/tests/application/checkout-use-cases.test.ts (9 tests)    [NEW PHASE 03.3.3 SUITE]
 ✓ apps/server/tests/application/payment-use-cases.test.ts (16 tests)   [NEW PHASE 03.3.3 SUITE]
 ✓ packages/shared/tests/shared.test.ts (7 tests)
 ✓ packages/storage-memory/tests/locks.test.ts (13 tests)
 ✓ packages/storage-memory/tests/sequencer.test.ts (4 tests)
 ✓ packages/crypto/tests/crypto.test.ts (5 tests)
 ✓ apps/server/tests/application/order-use-cases.test.ts (10 tests)     [NEW PHASE 03.3.3 SUITE]
 ✓ apps/server/tests/application/control-use-cases.test.ts (6 tests)    [NEW PHASE 03.3.3 SUITE]
 ✓ packages/domain/tests/domain.test.ts (1 test)
 ✓ tests/smoke.test.ts (5 tests)
 ✓ apps/server/tests/server.test.ts (2 tests)

 Test Files  24 passed (24)
      Tests  355 passed (355)  [+52 new application service tests]
   Duration  1.73s

> paysim-monorepo@1.0.0 build
> tsc --build && npm run build --workspace=apps/web
[Exit 0 - Clean Vite production build]
```

### Fixture Byte Exactness
- `fixtures/events-compat/payment.captured.body.json`: **333 bytes** (100% exact match)
- `fixtures/events-compat/payment.captured.json`: **474 bytes** (100% exact match)
- `fixtures/events-native/payment.captured.body.json`: **293 bytes** (100% exact match)
- `fixtures/events-native/payment.captured.json`: **389 bytes** (100% exact match)

---

## 7. Known Limitations & Scope Control

1. **Transport Layer Deferred:** Express HTTP routes, query string parsers, and header extractors are not yet mounted; application services operate directly with strongly-typed TypeScript DTOs.
2. **Outbound Network Socket Dispatch:** Webhook HTTP dispatching (`http.request` loopback socket transmission with HMAC-SHA256 headers) is queued via delivery records and will be executed by the background dispatcher engine in Phase 03.4.
3. **Frontend Iframe Handshake:** React modal bridge for checkout simulation is deferred to Phase 03.5.

Phase 03.4 awaits explicit user authorization to proceed.
