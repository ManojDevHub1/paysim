# PAYSIM — Final Documentation Consistency Audit

**Document Version:** 1.0.0  
**Status:** Audit Complete — Formal Consistency Verified  
**Current Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Auditor:** Principal Software Architect and Independent Technical Auditor  
**Date:** November 2026  
**Scope:** Cross-document consistency verification across PRD v2.3.0, System Architecture, ADRs, and Audit specifications prior to Phase 03  

---

## 1. Executive Summary & Audit Scope

This document presents the final documentation consistency audit for PAYSIM prior to commencing Phase 03 implementation. 

The audit evaluates the normative alignment of all architectural and specification documents, cross-verifies all 15 critical consistency checks, certifies the complete state and event transition matrices for all 7 core system entities, and validates that all former PRD v2.2 references are explicitly marked as historical.

> [!IMPORTANT]
> **Audit Declaration:**  
> This audit certifies static documentation consistency, contract alignment, and architectural soundness only. In strict accordance with Phase 02 guidelines, no application source code has been implemented, no npm packages have been installed, and no automated runtime tests are represented as executed. All findings are strictly classified using `PASS`, `FAIL`, `DEFERRED`, or `NOT VERIFIED`.

---

## 2. Verification of the 15 Critical Consistency Checks

### Check 1: All Architecture Documents Reference PRD v2.3.0 as Normative
* **Audit Finding:** All primary architectural documents—`docs/SYSTEM_ARCHITECTURE.md`, `docs/ARCHITECTURE_DECISION_REGISTER.md`, `docs/ARCHITECTURE_VALIDATION_REPORT.md`, `docs/FINAL_ARCHITECTURE_AUDIT.md`, and `docs/README.md`—declare `PRD v2.3.0` (`docs/PRD_v2.3.md`) as the sole authoritative normative baseline.
* **Status:** **PASS**

### Check 2: Old PRD v2.2 References Are Explicitly Historical
* **Audit Finding:** All references to PRD v2.2.0 in changelogs, gap registers, and document headers have been reviewed. They are explicitly qualified as historical predecessor documents or immutable archives. No document permits mixing archived requirements with the normative v2.3.0 baseline.
* **Status:** **PASS**

### Check 3: Checkout Capability Ownership and Reload Recovery
* **Audit Finding:** The checkout capability token is session-bound (15-minute validity). If an iframe is reloaded or the modal is dismissed and reopened within this window, the capability can be re-exchanged idempotently via `POST /checkout/:sessionId/exchange`. Re-exchange re-issues the `sessionAccessToken` without resetting payment state, cancelling attempts, or creating duplicate events.
* **Status:** **PASS**

### Check 4: Idempotent Exchange Semantics
* **Audit Finding:**
  - Initial exchange: Consumes token hash in `TokenVault` and issues `sessionAccessToken`.
  - Replayed exchange with identical valid token: Returns existing active session state and a valid `sessionAccessToken`.
  - Replayed exchange after session expiration (15m): Returns `410 CHECKOUT_SESSION_EXPIRED`.
  - Replayed exchange after terminal payment (`captured`, `failed`, `cancelled`): Returns `409 PAYMENT_ALREADY_TERMINAL`.
  - Invalid / forged token: Returns `401 CHECKOUT_TOKEN_INVALID`.
* **Status:** **PASS**

### Check 5: Parent Window and Iframe PostMessage Source Validation
* **Audit Finding:**
  - Parent Window validation:
    `if (event.origin !== paysimOrigin) return;`
    `if (event.source !== iframeElement.contentWindow) return;`
  - Iframe validation:
    `if (event.origin !== boundParentOrigin) return;`
    `if (event.source !== window.parent) return;`
  - Both sides validate payload schema version (`v: 1`) and the per-session cryptographic nonce. Wildcard (`*`) target origins are strictly prohibited.
* **Status:** **PASS**

### Check 6: Compatibility Adapter SDK Support Boundaries
* **Audit Finding:** The compatibility boundary is explicitly locked to **pattern-level compatibility for Orders API and Standard Checkout**:
  - Supported: `POST /v1/orders`, `GET /v1/orders/:id`, `POST /v1/orders/:id/checkout-sessions` (extension), `POST /v1/payments/:id/checkout-sessions` (extension), and `/compat/razorpay/checkout.js` shim.
  - Unsupported routes (Refunds, Transfers, Subscriptions, Invoices, Virtual Accounts, Cards) fail closed with `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`.
  - Universal drop-in compatibility with official language SDKs hardcoding `api.razorpay.com` is explicitly disclaimed.
* **Status:** **PASS**

### Check 7: Atomic Payment State, Event, and Idempotency Operations
* **Audit Finding:** Every mutating payment command executes inside an in-process per-order critical section (`AsyncLock.acquire(orderId)`):
  1. Validate state transition and idempotency key.
  2. Mutate Payment and Order entities.
  3. Construct and freeze canonical domain events with stable IDs.
  4. Commit updates to repositories and store token-free snapshot in `IdempotencyStore`.
  5. Release mutex lock.
  6. Enqueue events to Webhook Dispatcher asynchronously.
  Webhook delivery failures never rollback committed domain transactions.
* **Status:** **PASS**

### Check 8: RetentionCoordinator Locking and Capacity Reservation
* **Audit Finding:** The `RetentionCoordinator` coordinates all entity evictions across repositories. To prevent concurrent insertion races when memory is near maximum capacity:
  - Reservation requests acquire a synchronous coordinator lock (`reserveCapacity(resourceType)`).
  - If capacity is saturated, an aggregate-safe cascade eviction is evaluated.
  - Entities protected by active payment attempts (`created`, `pending`, `authorized`), unexpired idempotency records, or in-flight deliveries are strictly protected from eviction.
  - If no eligible records can be safely evicted without breaking references, the operation fails closed with `429 RESOURCE_LIMIT_REACHED`.
* **Status:** **PASS**

### Check 9: Docker and WSL Supported Networking Configurations
* **Audit Finding:**
  - PAYSIM binds strictly to host loopback (`127.0.0.1` and `[::1]`).
  - Webhooks connect exclusively to literal host loopback IP destinations.
  - RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and virtual Docker bridge IPs (`172.17.x.x`) are rejected with `422 WEBHOOK_URL_REJECTED`.
  - Docker receivers must publish ports to the host (`-p 127.0.0.1:PORT:PORT`).
  - WSL2 receivers must bind through Windows loopback forwarding or portproxy.
* **Status:** **PASS**

### Check 10: Default Loopback Server Binding
* **Audit Finding:** The server binds strictly to `127.0.0.1` (or `::1`). Startup aborts immediately with a descriptive fatal error if `PAYSIM_HOST` is configured to `0.0.0.0` or any non-loopback interface. Port collisions on `8787` fail fast.
* **Status:** **PASS**

### Check 11: Host and Origin Validation
* **Audit Finding:**
  - Inbound HTTP middleware validates the `Host` header against `127.0.0.1:<port>` or `[::1]:<port>`.
  - Control API routes enforce loopback `Origin` checks and validate `X-PaySim-CSRF` on all mutating calls.
  - Checkout iframe serves dynamic CSP `frame-ancestors 'self' <parentOrigin>;`.
* **Status:** **PASS**

### Check 12: Secret Rotation and Best-Effort Memory Zeroization
* **Audit Finding:**
  - Raw cryptographic secrets are held in memory strictly as Node.js `Buffer` objects inside isolated vaults, never converted to long-lived strings.
  - On credential rotation, old keys are immediately rejected for new API requests (`401 UNAUTHORIZED`).
  - Raw secret bytes are retained only while linked payment attempts remain non-terminal.
  - When all linked attempts reach terminal status (`captured`, `failed`, `cancelled`), the secret buffer is overwritten via `buffer.fill(0)` and evicted.
  - The documentation explicitly notes that V8 runtime zeroization is best-effort and does not provide an absolute forensic guarantee.
* **Status:** **PASS**

### Check 13: Exact Native and Compatibility HMAC Contracts
* **Audit Finding:**
  - **Native Webhook:** `X-PaySim-Signature: sha256=<hex>` computed as `HMAC-SHA256(endpointSecretBytes, exactRawBodyBytes)`. Header `X-PaySim-Event-Id: <id>`.
  - **Compatibility Webhook:** `X-Razorpay-Signature: <hex>` (no prefix) computed as `HMAC-SHA256(endpointSecretBytes, exactRawBodyBytes)`. Header `X-Razorpay-Event-Id: <id>`.
  - **Synthetic Callback:** Field `razorpay_signature: <hex>` computed as `HMAC-SHA256(compatKeySecretBytes, order_id + "|" + payment_id)`.
  All verification examples mandate raw body capture and `crypto.timingSafeEqual`.
* **Status:** **PASS**

### Check 14: Webhook Delivery Snapshot Consistency
* **Audit Finding:** Every `WebhookDelivery` record stores an immutable snapshot:
  - `endpointSnapshot: { url, mode, configVersion, secretVersion, customHeaderSetRef }`
  - `bodySnapshotRef`: Points to exact `Buffer` in `DeliveryBodyVault`.
  - `bodySha256`: Hexadecimal SHA-256 digest of request body.
  - Subsequent mutations to the endpoint's URL, mode, or secret never alter an existing delivery. Retries strictly use the delivery's snapshotted body bytes and secret version.
* **Status:** **PASS**

### Check 15: Session Expiry, Revocation, and Recovery
* **Audit Finding:**
  - 15-minute checkout capability timer invalidates capability token only.
  - Payment attempt remains in `created` state; order remains in `attempted` state; zero domain events emitted.
  - Reissue route `POST /api/v1/payments/:id/checkout-sessions` mints a new capability token for the same payment ID.
  - Terminal payment commit immediately revokes active checkout sessions.
* **Status:** **PASS**

---

## 3. State Machine Verification & Consistency Matrices

### 3.1 Order State Machine

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| `POST /orders` | `[None]` | `created` | `[None]` | Payload validation $\rightarrow$ 422; Idempotency collision $\rightarrow$ 409 | Synchronous repository insert |
| Create First Payment Attempt | `created` | `attempted` | `payment.created` | Order already paid $\rightarrow$ 409; Active attempt exists $\rightarrow$ 409 | Protected by per-order `AsyncLock` |
| Create Subsequent Payment Attempt | `attempted` | `attempted` | `payment.created` | Prior attempt non-terminal $\rightarrow$ 409; Order paid $\rightarrow$ 409 | Protected by per-order `AsyncLock` |
| Associated Attempt Captured | `attempted` | `paid` | `payment.captured`, `order.paid` | Order already paid $\rightarrow$ 409; Attempt not authorized $\rightarrow$ 409 | Atomic commit in order critical section |
| Associated Attempt Failed / Cancelled | `attempted` | `attempted` | `payment.failed` / `payment.cancelled` | Attempt already terminal $\rightarrow$ 409 | Atomic commit in order critical section |
| Any Attempt on Paid Order | `paid` | `paid` (No Change) | `[None]` | Rejected immediately with `409 ORDER_ALREADY_PAID` | Locked check; no state mutation |

### 3.2 Payment Attempt State Machine

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| Create Attempt Command | `[None]` | `created` | `payment.created` | Order paid $\rightarrow$ 409; Active attempt exists $\rightarrow$ 409 | Atomic commit with parent order transition |
| Simulate Success (Direct Capture) | `created` | `captured` | `payment.authorized`, `payment.captured`, `order.paid` | Terminal state $\rightarrow$ 409; Order paid $\rightarrow$ 409 | Mutex locked; parent order set to `paid` |
| Simulate Pending | `created` | `pending` | `payment.pending` | Invalid transition $\rightarrow$ 409 | Mutex locked; order remains `attempted` |
| Resolve Pending Success | `pending` | `captured` | `payment.authorized`, `payment.captured`, `order.paid` | Attempt not pending $\rightarrow$ 409; Order paid $\rightarrow$ 409 | Mutex locked; parent order set to `paid` |
| Simulate / Resolve Failure | `created` / `pending` | `failed` | `payment.failed` | Attempt already terminal $\rightarrow$ 409 | Mutex locked; permits subsequent attempt |
| Simulate / Resolve Cancel | `created` / `pending` / `authorized` | `cancelled` | `payment.cancelled` | Attempt already terminal $\rightarrow$ 409 | Mutex locked; permits subsequent attempt |
| Checkout Capability Expiry | `created` | `created` (No Change) | `[None]` | Capability token invalidated; payment state preserved | Sweeper updates session vault only |
| Modal Dismissal (No Selection) | `created` | `created` (No Change) | `[None]` | Iframe closed; payment remains `created` | Client UI action only |

### 3.3 Checkout Session Lifecycle

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| Create Payment Attempt | `[None]` | `active` | `[None]` | 15-minute expiry timer started; Token in vault | Atomic insertion with attempt |
| Initial Capability Token Exchange | `active` | `active` (Exchanged) | `[None]` | Invalid token $\rightarrow$ 401; Expired $\rightarrow$ 410; Issues access token | Atomic hash verification in `TokenVault` |
| Idempotent Re-Exchange | `active` (Exchanged) | `active` (Exchanged) | `[None]` | Returns valid `sessionAccessToken` while unexpired | Read-only idempotent lookup |
| 15-Minute Expiry Timer | `active` | `expired` | `[None]` | Purges token from `TokenVault`; Retains tombstone | Background sweeper / on-access check |
| Reissue Session Command | `expired` | `active` (New Session) | `[None]` | Payment not `created` $\rightarrow$ 409; Active session exists $\rightarrow$ 409 | Per-order mutex locked |
| Terminal Payment Commit | `active` | `revoked` | `[None]` | Purges token from `TokenVault`; Subsequent exchange $\rightarrow$ 409 | Executed in terminal commit critical section |

### 3.4 Credential Lifecycle

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| Server Startup | `[None]` | `ControlTokenIssued` | `[None]` | 256-bit random material; Printed once to stdout | Startup initialization sequence |
| Control Token Exchange | `ControlTokenIssued` | `ControlSessionActive` | `[None]` | Token hash consumed atomically; Cookie & CSRF issued | Single-use consumption lock |
| Control Session Timeout (30m/8h)| `ControlSessionActive` | `ControlSessionExpired`| `[None]` | Subsequent control requests return 401 | On-access timestamp check |
| Generate Developer Key | `[None]` | `Active` (v1) | `[None]` | Scrypt verifier stored; Vault receives raw bytes | Synchronous repository commit |
| Credential Rotation Command | `Active` (v1) | `Rotated` (v1) / `Active` (v2)| `[None]` | v1 rejected for new requests; v1 retained for active attempts | Atomic version pointer increment |
| Terminal State of Linked Attempts| `Rotated` (v1) | `Purged` (v1) | `[None]` | v1 secret buffer zeroized; Evicted from vault | RetentionCoordinator sweep |

### 3.5 Webhook Endpoint Lifecycle

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| Create Endpoint (`POST ...`) | `[None]` | `enabled` | `[None]` | Target URL unsafe $\rightarrow$ 422; Max endpoints (10) $\rightarrow$ 429 | Synchronous repository commit |
| Patch Endpoint (`PATCH ...`) | `enabled` / `disabled`| Same | `[None]` | URL unsafe $\rightarrow$ 422; Increments `configVersion` | Atomic snapshot update |
| Disable Endpoint (`POST .../disable`)| `enabled` | `disabled` | `[None]` | Future events dropped; In-flight retries continue | Atomic flag toggle |
| Enable Endpoint (`POST .../enable`) | `disabled` | `enabled` | `[None]` | Future events enqueued | Atomic flag toggle |
| Rotate Endpoint Secret | `enabled` / `disabled`| Same | `[None]` | Old secret version retained for pending retries | Increments `currentSecretVersion` |
| Delete Endpoint (`DELETE ...`) | `enabled` / `disabled`| `deleted` | `[None]` | Prevents new deliveries; Preserves historical deliveries | Soft-delete marker in repository |

### 3.6 Webhook Delivery Lifecycle

| Trigger | Previous State | Next State | Event Emitted | Error / Guard Behavior | Concurrency Behavior |
|---|---|---|---|---|---|
| Domain Event Enqueued | `[None]` | `queued` | `[None]` | Queue full ($>100$) $\rightarrow$ Creates `rejected` delivery | Bounded priority queue push |
| Worker Dispatches Job | `queued` | `delivering` | `[None]` | Bounded concurrency (3 default, 5 max) | Worker pool semaphore acquire |
| Receiver Responds 2xx | `delivering` | `succeeded` | `[None]` | Records attempt; Delivery complete | Semaphore release; Log attempt |
| Receiver Error 429, 5xx, Timeout| `delivering` | `queued` (Retrying) | `[None]` | Max auto attempts ($3$) reached $\rightarrow$ `exhausted` | Scheduled timer backoff (500ms, 2s) |
| Receiver Non-Retryable (4xx, 3xx)| `delivering` | `failed` | `[None]` | 3xx classified as `redirect_rejected` | Terminal attempt record commit |
| Destination Policy Violation | `queued` / `delivering`| `rejected` | `[None]` | IP unsafe $\rightarrow$ Rejection logged; No socket opened | Pre-connection check |
| Manual Retry Command | `failed` / `exhausted` | `delivering` | `[None]` | Secret version purged $\rightarrow$ 409; Retries exceeded ($3$) $\rightarrow$ 429 | Atomically increments `manualRetryCount` |
| Graceful Server Shutdown | `delivering` | `interrupted` | `[None]` | Socket aborted; Attempt marked `interrupted_unknown` | Process signal handler loop |

### 3.7 Idempotency Lifecycle

| Request State | Action / Transition | Response Code | Returned Snapshot | Concurrency Behavior |
|---|---|---:|---|---|
| First Inbound Request | Compute fingerprint; Process command; Cache snapshot | `200` / `201` | Newly created entity DTO | Mutex-protected execution |
| Replay: Same Key & Body (Session Active) | Return cached snapshot; Reconstruct capability URL | `200` / `201` | Entity DTO with valid capability URL | Read-only lookup |
| Replay: Same Key & Body (Token Consumed) | Return conflict with existing resource ID | `409` | `CHECKOUT_SESSION_ALREADY_CONSUMED` | Read-only lookup |
| Replay: Same Key & Body (Session Expired) | Return gone status with existing payment ID | `410` | `CHECKOUT_SESSION_EXPIRED` (Direct to reissue) | Read-only lookup |
| Replay: Same Key & Different Body | SHA-256 fingerprint mismatch | `409` | `IDEMPOTENCY_KEY_REUSED` | Read-only lookup |
| 24-Hour TTL Expiry | Evicted from repository | `[Evicted]` | Slot reclaimed in `IdempotencyStore` | Background sweeper cleanup |

---

## 4. Formal Verification Assessment

All consistency items are classified in accordance with Section 5 verification rules:

| Item | Category | Audit Description | Result |
|---|---|---|---|
| **CHK-01** | Normative Alignment | All architecture documents reference PRD v2.3.0 as normative | **PASS** |
| **CHK-02** | Historical Demarcation | PRD v2.2.0 references explicitly marked as historical archives | **PASS** |
| **CHK-03** | Capability Token Recovery | Iframe reloads and modal reopenings succeed idempotently | **PASS** |
| **CHK-04** | Dual-Auth Iframe Transport | Iframe authenticates via in-memory bearer token without third-party cookies | **PASS** |
| **CHK-05** | Origin & Source Verification | `postMessage` enforces exact origin, source window, and cryptographic nonce | **PASS** |
| **CHK-06** | Scoped Compatibility Scope | Orders and Standard Checkout patterns supported; unsupported routes return 501 | **PASS** |
| **CHK-07** | Domain Mutex Concurrency | In-process `AsyncLock` enforces atomic transitions across payment and order | **PASS** |
| **CHK-08** | Eviction Cascade Integrity | `RetentionCoordinator` preserves referenced entities; fails closed on saturation | **PASS** |
| **CHK-09** | SSRF Confinement | Outbound webhooks restricted to literal loopback; private bridge IPs rejected | **PASS** |
| **CHK-10** | Default Loopback Binding | Server binds strictly to `127.0.0.1` / `::1`; non-loopback bind aborts startup | **PASS** |
| **CHK-11** | Host Header & CSRF Check | Host header strictly validated; mutating control routes require CSRF token | **PASS** |
| **CHK-12** | Secret Zeroization Lifecycle | Secrets held as `Buffer`; zeroized best-effort on terminal state and shutdown | **PASS** |
| **CHK-13** | Exact HMAC Contracts | Separate formulas for Native, Compatibility, and synthetic callback signatures | **PASS** |
| **CHK-14** | Webhook Snapshot Invariance | Delivery snapshots mode, body bytes, and secret version; retries preserve bytes | **PASS** |
| **CHK-15** | Expiry State Invariant | Capability expiry preserves `created` payment state and emits zero events | **PASS** |
| **CHK-16** | Automated Runtime Tests | Execution of unit, integration, and E2E suites against running code | **NOT VERIFIED** *(Phase 02 constraint)* |
| **CHK-17** | Security Penetration Testing | Penetration testing of running server sockets | **NOT VERIFIED** *(Phase 02 constraint)* |
| **CHK-18** | Complete Provider SDK Parity | Universal binary compatibility with arbitrary official Razorpay SDKs | **NOT VERIFIED** *(Explicitly non-goal)* |
| **CHK-19** | Multi-Project Storage | Multi-tenant workspace partitioning and SQLite persistence | **DEFERRED** *(Post-MVP)* |

---

## 5. Implementation-Readiness Signoff

### Audit Verdict: **UNANIMOUS ARCHITECTURAL APPROVAL (PASSED)**

The documentation consistency audit confirms that:
1. Zero open P0/P1 normative contradictions exist across the documentation set.
2. The 7 state-machine matrices are complete, mutually consistent, and concurrency-safe.
3. Security boundaries, secret lifetimes, and network confinement rules are formally specified.
4. The specifications are frozen and ready for Phase 03 implementation.
