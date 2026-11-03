# PAYSIM — Product Requirements Document

**Document version:** 2.3.0  
**Status:** Normative specification baseline — v2.3 architecture hardened; implementation and tests not yet executed  
**Document owner:** PAYSIM Project  
**Product category:** Local-first payment workflow simulator and webhook testing tool  
**Primary audience:** MERN, Node.js, React, and full-stack developers; students learning payment integrations  
**Default mode:** Local-only simulation; no real payment processing  
**Currency scope for MVP:** INR only  
**Storage for MVP:** Bounded in-memory session storage; no database  
**Target operating systems:** Windows 11, macOS, and mainstream Linux distributions  
**Runtime target:** Node.js 24.x (Maintenance LTS) and 26.x (Active LTS) as of November 2026  
**Last updated:** 3 November 2026  

---

## Document Purpose and Status

This document is the sole normative specification and single source of truth for the PAYSIM MVP. PRD v1.0, v2.0, v2.1, and v2.2 are retained as immutable archives. Version 2.3 resolves the Phase 02.1 technical audit findings around cross-origin embedded iframe authentication, SameSite cookie limitations, idempotent checkout session capability recovery, capability expiration semantics, secret version retention during asynchronous callback signing, delivery-mode snapshotting, strict loopback SSRF defense for Docker/WSL, and deterministic webhook serialization.

The design deliberately combines two integration surfaces over a single domain core:

1. **PAYSIM Native API** — a stable, clearly branded REST API under `/api/v1` for applications that choose to integrate directly with PAYSIM.
2. **Razorpay-style Compatibility Adapter** — a limited, pattern-level local adapter under `/compat/razorpay/v1` for testing a selected subset of familiar Razorpay Orders API and Standard Checkout integration patterns with PAYSIM-issued test credentials.

The compatibility adapter is **not** an official Razorpay SDK, does not connect to Razorpay infrastructure, and does not provide universal drop-in compatibility for arbitrary language SDKs that hardcode remote provider URLs.

This is a local software development simulator. It does not provide financial services, process real money, bypass merchant onboarding rules, or make real UPI/card/bank transactions.

---

# 1. Executive Summary

## 1.1 Product Definition
PAYSIM is a local-first payment simulator and webhook testing laboratory for developers. It allows developers to create mock orders, open a simulated checkout, choose deterministic payment outcomes, generate signed payment events, deliver those events to explicitly configured local webhook handlers, and inspect or replay delivery attempts.

## 1.2 One-line Value Proposition
> Simulate payment flows, test local webhooks, and debug integration logic — without merchant onboarding or real transactions.

## 1.3 Product Positioning
PAYSIM is a **developer tool**, not a payment gateway, bank, wallet, payment aggregator, UPI app, or financial service. The term **“zero KYC”** denotes that developers need no merchant onboarding to test payment application logic locally.

---

# 2. Problem Statement

Developers integrating payment gateways face friction:
- Mandatory business KYC, merchant account approval, and GST verification before accessing test sandboxes.
- Difficulty testing asynchronous webhook events reliably on local development environments (`127.0.0.1`).
- Inability to trigger deterministic edge cases (network timeouts, payment failure, manual pending resolution) on demand.
- Security risks from exposing local ports to third-party tunnels or cloud relays.

---

# 3. Goals, Non-Goals, and Product Constraints

## 3.1 Core Goals
- Run 100% locally with zero external network dependencies.
- Zero mandatory database setup (operates in bounded process memory).
- Deterministic simulation of payment outcomes (`success`, `pending`, `failed`, `cancelled`).
- Reliable webhook delivery to literal loopback endpoints with HMAC-SHA256 signatures over exact raw bytes.
- Dual API surfaces (Native REST and Razorpay compatibility subset) over a single shared domain engine.

## 3.2 Non-Goals
- Real money movement or financial transactions.
- Real card authorization, UPI network intents, or banking operations.
- Drop-in replacement for production payment providers.
- Bypassing legal merchant onboarding or regulatory requirements.

---

# 4. Target Users and Jobs to Be Done

1. **Full-Stack / Backend Developers:** Verify order creation, checkout initiation, webhook signature verification, and idempotency logic.
2. **Frontend Developers:** Build and test checkout modal integration, outcome handling, and dismiss behavior without real cards.
3. **Students / Educators:** Learn payment integration architecture, webhook event lifecycles, and HMAC security safely offline.

---

# 5. Locked Product and Architecture Decisions

## 5.1 Two API Surfaces over Unified Domain Core
PAYSIM provides:
- **Native mode:** REST API under `/api/v1`.
- **Compatibility mode:** Razorpay-style subset under `/compat/razorpay/v1`.

Both modes share the exact same domain services, state machines, and in-memory repositories. Business logic and state transitions are never duplicated.

## 5.2 Scoped Compatibility Boundary
The compatibility adapter supports a documented subset of Orders API and Standard Checkout integration patterns. Unimplemented routes return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`. PAYSIM never proxies requests to external payment providers.

## 5.3 Default Network Ports
- **API Server & Static Asset Host:** `127.0.0.1:8787` (Packaged release and backend default).
- **Vite Web Development Server:** `127.0.0.1:5173` (Development UI only).
- Binds strictly to `127.0.0.1` or `::1`. Fails immediately on port collisions.

## 5.4 In-Memory Storage Strategy
- All business records (orders, payments, events, deliveries, credentials) are held in bounded in-memory repositories.
- Zero disk database persistence in MVP. Process restart clears all session data.
- UI preferences may persist in browser `localStorage`; secrets and payment records never do.

## 5.5 API Credential Strategy & Ephemeral Vaults
- **Dashboard Control Token:** One-time 256-bit random token printed once to stdout. Server stores salted hash; consumed atomically at login.
- **Native API Token:** Bearer token (`ps_test_...`) stored as a salted scrypt hash.
- **Compatibility Key Pair:** Public `key_id` (`ps_test_...`) and secret `key_secret`. Stored as a salted scrypt hash for HTTP Basic auth verification, plus raw bytes in process-memory `CompatibilitySecretVault` for synthetic callback HMAC signing.
- **Rotation Behavior:** Rotation immediately disables the old version for incoming API requests (`401 UNAUTHORIZED`). The old raw secret remains in `CompatibilitySecretVault` only while any payment attempt created under that version remains in a non-terminal state (`created`, `pending`, `authorized`). Once all linked attempts are terminal, the secret buffer is zeroized and evicted.

## 5.6 Webhook Secret Strategy
- Cryptographically random 256-bit signing secrets stored in process-memory `WebhookSecretVault` keyed by `(endpointId, secretVersion)`.
- Secrets are revealed once upon creation/rotation.
- Delivery records snapshot the endpoint's secret version. Old secret versions remain retained only while an eligible retryable delivery references them.

## 5.7 Loopback Target Strategy
- Accepts **only** literal loopback IP destinations: `http://127.0.0.1:<port>/<path>` or `http://[::1]:<port>/<path>`.
- Strictly rejects `localhost`, all DNS names, WAN IPs, RFC 1918 private LAN ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local IPs, cloud metadata IPs, and PAYSIM's own ports.
- Webhook targets are re-validated immediately before establishing outbound socket connections.

## 5.8 Retry and Replay Strategy
- **Retry:** Operates on the same delivery record. Reuses the exact serialized request-body bytes, mode, and secret version from the delivery snapshot. Bounded to 3 automatic attempts and up to 3 manual retries.
- **Replay:** Creates a brand-new delivery record for an existing canonical event targeting user-selected enabled endpoints. Serializes the event under the selected endpoint's current mode.
- Retry and Replay never mutate payment or order state and never alter canonical event IDs or timestamps.

## 5.9 Embedded Checkout Iframe Security & Dual-Authentication
- Served same-origin at `/checkout/:sessionId`.
- Mandatory `parentOrigin` validation at session creation. Dynamic CSP sets `frame-ancestors 'self' <parentOrigin>;`.
- Capability token is carried exclusively in the URL fragment (`#<token>`) and stripped immediately via `history.replaceState`.
- **Dual-Authentication Scheme:**
  1. Iframe exchanges the capability token via same-origin `POST /checkout/:sessionId/exchange`.
  2. Server returns an ephemeral `sessionAccessToken` (15-minute validity).
  3. Iframe retains `sessionAccessToken` in window process memory and passes `Authorization: Bearer <sessionAccessToken>` on all internal simulation API calls (`/checkout/:id/simulate`, etc.).
  4. Server sets the path-scoped cookie (`SameSite=Lax`) solely as an optional fallback for direct tab access.
- **Idempotent Exchange:** The capability token is a session-bound capability valid for the 15-minute session lifetime. Re-exchanging the same capability token during an active, non-terminal session succeeds idempotently, enabling iframe reloads and modal reopenings.
- Communication between parent shim and checkout iframe uses a versioned, nonce-bound `postMessage` protocol with exact `targetOrigin` validation. Wildcard `*` is strictly banned.

## 5.10 Dashboard Control Session Contract
- Authenticated via one-time token exchange at `POST /control/v1/session/exchange`.
- Sets an `HttpOnly, SameSite=Strict` cookie scoped to `/control/v1` and returns an ephemeral CSRF token in a no-store JSON body.
- Mutating control routes require the session cookie and `X-PaySim-CSRF` header.

## 5.11 Payment Amount and Expiry Limits
- `MAX_ORDER_AMOUNT_PAISE` is capped at `100_000_000` (₹10,00,000).
- Checkout capability tokens expire 15 minutes after session creation.
- **Capability expiration invalidates the capability token only; it does NOT cancel the payment attempt, does NOT change order state, and emits NO events.**
- A payment in `created` state whose session expired can receive a reissued checkout session via `POST /api/v1/payments/:id/checkout-sessions` (or compatibility counterpart) with a new idempotency key, retaining the same payment ID.

---

# 6. User Journeys and End-to-End Flows

## 6.1 First Run & Setup
1. Developer runs `npm run dev`.
2. Server binds to `127.0.0.1:8787` and prints a one-time 256-bit control token to stdout.
3. Developer opens `http://127.0.0.1:5173`, enters the control token, and establishes a control session.
4. Developer generates Native or Compatibility credentials from Settings.

## 6.2 Native Payment Flow
1. Developer application sends `POST /api/v1/orders` with integer amount in paise and `INR` currency.
2. Developer initiates attempt via `POST /api/v1/orders/:id/payment-attempts` with `parentOrigin`.
3. Application opens returned `checkoutUrl#token`.
4. Developer chooses deterministic outcome in simulator (`Success`, `Pending`, `Failure`, `Cancel`).
5. Domain state machine commits transition and emits canonical domain event.
6. Webhook engine delivers signed event to matching enabled loopback endpoints.

## 6.3 Razorpay Compatibility Flow
1. Developer backend sets `baseURL` to `http://127.0.0.1:8787/compat/razorpay` and uses PAYSIM test key pair.
2. Backend creates mock order via `POST /v1/orders`.
3. Backend calls PAYSIM extension `POST /v1/orders/:id/checkout-sessions` with `parent_origin`.
4. Browser loads local shim `/compat/razorpay/checkout.js` and calls `new Razorpay({ key, order_id, checkout_url }).open()`.
5. Iframe executes simulation, emits `paysim.checkout.complete` postMessage, and invokes developer callback with synthetic signature `HMAC(key_secret, order_id + "|" + payment_id)`.
6. Webhook dispatcher delivers compatibility-formatted event with `X-Razorpay-Signature`.

---

# 7. Functional Requirements

## 7.1 Setup and Control Plane
- `SET-01`: Start locally with one documented command offline.
- `SET-02`: One-time random control token printed once to stdout.
- `SET-03`: `POST /control/v1/session/exchange` atomically consumes control token.
- `SET-04`: CSRF and Origin protection on all mutating control endpoints.
- `SET-07`: Reject non-loopback host configuration (`0.0.0.0`).
- `SET-08`: Detect port collisions and fail fast with actionable guidance.

## 7.2 Orders & Payments
- `ORD-01`: Mock order creation with unique ID, amount in paise, currency INR.
- `ORD-04`: Validate amount: integer between 1 and `100_000_000` paise. Reject floats and negatives.
- `ORD-09`: Enforce idempotency on order and payment attempt creation.
- `PAY-01`: Payment attempts are modeled as separate entities from orders.
- `PAY-03`: Exactly one active (non-terminal) attempt permitted per order at a time.
- `PAY-05`: Deterministic outcome simulation: `success`, `pending`, `failed`, `cancelled`.
- `PAY-15`: Reissue checkout sessions for `created` attempts after capability expiry without creating duplicate attempts.

## 7.3 Checkout UI & Handshake
- `CHK-01`: Serve checkout modal and assets locally; zero remote CDN dependencies.
- `CHK-02`: Persistent simulation disclosure banner.
- `CHK-11`: Non-payable, non-scannable QR illustration with visible warning label.
- `CHK-13`: Versioned, nonce-bound `postMessage` protocol with concrete `targetOrigin`.
- `CHK-15`: Fragment-only capability token transport; immediate URL scrubbing.

## 7.4 Webhook Subsystem
- `WH-00`: Explicit `mode` required at endpoint creation (`native` or `compatibility`).
- `WH-01`: Require literal loopback URL (`127.0.0.1` or `[::1]`) with explicit port.
- `DEL-01`: Outbound HTTP POST containing immutable serialized event body.
- `DEL-02`: HMAC-SHA256 computed over exact raw request body bytes.
- `DEL-06`: Redirects strictly disabled (`redirect_rejected` outcome).
- `DEL-07`: Bounded queue (100 jobs) and bounded worker pool (3-5 concurrent).
- `DEL-09`: Bounded automatic retries (Attempt 1: immediate, Attempt 2: 500ms, Attempt 3: 2s).
- `RPL-02`: Retry reuses exact stored body bytes, mode, and secret version.
- `RPL-03`: Replay serializes canonical event under selected endpoint's current mode.

---

# 8. Payment and Order Domain Model

## 8.1 State Definitions
- **Order States:** `created`, `attempted`, `paid`. Terminal state: `paid`.
- **Payment Attempt States:** `created`, `pending`, `authorized`, `captured`, `failed`, `cancelled`. Terminal states: `captured`, `failed`, `cancelled`.

## 8.2 State Transition Matrix

| Entity | Previous State | Trigger / Command | Next State | Emitted Events |
|---|---|---|---|---|
| Order | `[None]` | `POST /orders` | `created` | `[None]` |
| Order | `created` | First attempt created | `attempted` | `payment.created` |
| Order | `attempted` | Associated attempt captured | `paid` | `payment.captured`, `order.paid` |
| Payment | `[None]` | Create attempt | `created` | `payment.created` |
| Payment | `created` | Simulate Success | `authorized` $\rightarrow$ `captured` | `payment.authorized`, `payment.captured`, `order.paid` |
| Payment | `created` | Simulate Pending | `pending` | `payment.pending` |
| Payment | `pending` | Resolve Success | `authorized` $\rightarrow$ `captured` | `payment.authorized`, `payment.captured`, `order.paid` |
| Payment | `pending` | Resolve Failure | `failed` | `payment.failed` |
| Payment | `pending` | Resolve Cancel | `cancelled` | `payment.cancelled` |
| Payment | `created` | Simulate Failure | `failed` | `payment.failed` |
| Payment | `created` | Simulate Cancel | `cancelled` | `payment.cancelled` |
| Payment | `created` | Capability expires | `created` (Unchanged) | `[None]` |

---

# 9. Razorpay-Style Compatibility Adapter

## 9.1 Supported Compatibility Subset
- Base URL: `http://127.0.0.1:8787/compat/razorpay`
- `POST /v1/orders`: Create order with `amount` (paise), `currency` (INR), `receipt`, `notes`.
- `GET /v1/orders/:id`: Retrieve order details and status.
- `POST /v1/orders/:id/checkout-sessions`: **PAYSIM extension** to atomically create payment attempt and 15-minute checkout session. Requires `parent_origin`.
- `POST /v1/payments/:id/checkout-sessions`: **PAYSIM extension** to reissue checkout session for `created` attempts.
- Local Checkout Shim: Served at `/compat/razorpay/checkout.js` exposing `window.Razorpay`. Requires `checkout_url`.
- Synthetic Callback: Invokes handler with `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`.
- Signature Formula: `HMAC-SHA256(key_secret, order_id + "|" + payment_id)`.

## 9.2 Explicitly Unsupported Features (Fail-Closed)
The following routes return `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED`:
- Refunds (`/v1/refunds`), Transfers (`/v1/transfers`), Payouts (`/v1/payouts`), Subscriptions (`/v1/subscriptions`), Invoices (`/v1/invoices`), Virtual Accounts (`/v1/virtual_accounts`), Cards API (`/v1/customers`).

---

# 10. Native API Contract

- Base URL: `http://127.0.0.1:8787/api/v1`
- Auth: `Authorization: Bearer <PAYSIM_TEST_TOKEN>`
- Standard Error Envelope:
  ```json
  {
    "simulated": true,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "amount must be a positive safe integer in paise",
      "requestId": "req_ps_001",
      "details": []
    }
  }
  ```
- Idempotency Header: `Idempotency-Key: <ascii_string>`. Enforced on orders, attempts, and checkout sessions.

---

# 11. Webhook Contract and Delivery Semantics

## 11.1 Wire Format Envelopes
- **Native Envelope:** `{ createdAt, data: { object: { ... } }, id, livemode: false, simulated: true, type }`. Header: `X-PaySim-Signature: sha256=<hex>`.
- **Compatibility Envelope:** `{ contains: ["payment"], created_at, entity: "event", event, id, livemode: false, payload: { ... }, simulated: true }`. Header: `X-Razorpay-Signature: <hex>`.

## 11.2 Deterministic Key Sorting
Both wire modes enforce recursive sorting of object keys using JavaScript UTF-16 code units (`Array.prototype.sort()`), compact JSON formatting, and UTF-8 encoding without trailing newlines.

---

# 12. Webhook Destination Security & SSRF Confinement

- Accepts **only** literal loopback IPs (`127.0.0.1` and `[::1]`) with explicit ports.
- Strictly blocks DNS names, WAN IPs, private LANs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local IPs, and cloud metadata IPs.
- Docker containers must publish ports to host loopback (`-p 127.0.0.1:PORT:PORT`). Private bridge IPs are rejected.
- Redirects are never followed. Ambient system proxies are ignored.

---

# 13. Data Models and Type Contracts

```typescript
export interface MockOrder {
  id: string;
  ownerCredentialId: string;
  amount: number;
  currency: "INR";
  status: "created" | "attempted" | "paid";
  receipt?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  paymentAttemptIds: string[];
  simulated: true;
  livemode: false;
  createdAt: string;
  updatedAt: string;
}

export interface MockPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: "INR";
  status: "created" | "pending" | "authorized" | "captured" | "failed" | "cancelled";
  method: "mock_upi" | "mock_card" | "mock_wallet";
  attemptNumber: number;
  compatibilityCredentialId?: string;
  compatibilityCredentialVersion?: number;
  simulated: true;
  livemode: false;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSession {
  id: string;
  paymentId: string;
  credentialId: string;
  credentialVersion: number;
  opaqueTokenHash: string;
  tokenVaultRef: string;
  parentOrigin: string;
  nonceHash: string;
  expiresAt: string;
  consumedAt?: string;
  revokedAt?: string;
  createdAt: string;
}
```

---

# 14. In-Memory Limits and Resource Management

- Orders: 2,000 | Payments: 3,000 | Sessions: 3,000 | Events: 2,000 | Deliveries: 5,000 | Idempotency Keys: 5,000 | Queue Jobs: 100.
- `RetentionCoordinator` enforces aggregate-safe cascading eviction. Entities protected by active payment attempts or unexpired idempotency records are never evicted. Saturated storage rejects new work with `429 RESOURCE_LIMIT_REACHED`.

---

# 15. Technical Architecture

- Monorepo with npm workspaces.
- Node.js 24.x LTS & 26.x LTS baseline.
- Express backend monolith + React & Vite frontend SPA.
- Strict TypeScript (`noImplicitAny`, strict null checks).
- In-process per-order `AsyncLock` for atomic critical sections.

---

# 17. Error Catalogue

All 26 standardized PAYSIM error codes are formally mapped with HTTP status codes and actionable remediation guidance in `docs/FINAL_ARCHITECTURE_AUDIT.md`.

---

# 18. Security and Privacy

- Threat model covers SSRF, clickjacking, secret leakage, and race conditions.
- Ephemeral vaults isolate raw signing material in memory. Memory buffers zeroized on shutdown.
- Logging middleware redacts authorization headers, cookies, and secrets.

---

# 21. Testing Strategy

- Mandatory regression suite `V23-01` through `V23-25` mapped in `PRD_v2.3_RESOLUTION_REGISTER.md`.
- **Capability expiration leaves payment attempt in `created` state and emits zero events.**
- Serializer tests verify bit-for-bit equivalence against committed test fixtures.

---

# 22. Definition of Done — MVP Release Gate

The MVP release gate requires all P0 unit, integration, contract, and browser security test specifications to pass against implemented code before release.

---

# 27. Resolution Register History

Documents the historical issue closures across v1.0, v2.0, v2.1, v2.2, and v2.3.0.
