# PAYSIM — Phase 03.5 Implementation Report
## Developer Dashboard & Frontend API Integration

**Timestamp:** 2026-11-03T08:50:00+05:30
**Phase:** 03.5
**Role:** Principal Frontend Architect & Product UI Engineer
**Runtime:** React 18.3.1, TypeScript 5.6, Vite 5.4.10, Native Fetch API
**Normative Baseline:** PRD v2.3.0, Frozen Contracts (`packages/contracts/`), `API_ROUTE_MANIFEST`
**Status:** COMPLETE & SEALED

---

### 1. Executive Summary

Phase 03.5 delivers a complete, polished, developer-focused React dashboard for PAYSIM. The dashboard connects directly to the actual Express HTTP APIs implemented in Phase 03.4, running over local loopback (`http://127.0.0.1:8787`).

In strict compliance with PRD v2.3.0:
- **Zero Mock Data in Production Code:** The dashboard does not simulate or hardcode fake API responses; every view fetches and commits actual transactional aggregate state via the Express HTTP transport layer.
- **Zero Storage Leakage:** In accordance with PRD Section 5.4 and 5.5, raw secrets (Native Bearer tokens, bootstrap tokens, signing secrets) are **never** persisted to browser `localStorage` or `sessionStorage`. Native Bearer tokens are held strictly in React memory for the active browser session.
- **One-Time Secret Disclosure:** Rotated credentials (Native Bearer tokens, Compatibility key secrets, and Webhook HMAC signing secrets) are displayed once upon creation/rotation in a dedicated disclosure modal requiring explicit developer confirmation before dismissal.
- **Preserved Frozen Contracts:** The `@paysim/contracts` package was untouched throughout this phase (`git diff packages/contracts/` is 100% empty).

---

### 2. Architecture & Design System

The frontend architecture follows a dark-first, clean developer-tool design system optimized for payment testing laboratories.

```
apps/web/src/
├── styles/
│   ├── tokens.css              # Custom properties (palette, spacing, radii, shadows, status colors)
│   └── components.css          # Core CSS components (buttons, forms, modals, tables, toasts, layout)
├── components/
│   ├── ui/                     # Accessible UI Primitives
│   │   ├── Button.tsx          # Primary, secondary, danger, ghost variants with loading spinner
│   │   ├── Input.tsx           # Accessible form input with mono, error, and hint support
│   │   ├── Select.tsx          # Accessible dropdown select
│   │   ├── Badge.tsx           # Status badges (success, warning, danger, info, neutral)
│   │   ├── Card.tsx            # Card container, header, body, footer
│   │   ├── Modal.tsx           # Accessible modal with keyboard Escape and backdrop dismiss
│   │   ├── Table.tsx           # Compact data tables with hover and responsive container
│   │   ├── CodeBlock.tsx       # Pre-formatted JSON viewer with one-click clipboard copy
│   │   └── Tabs.tsx            # Navigation tab bar
│   ├── common/                 # Domain-Specific Common Components
│   │   ├── StatusBadge.tsx     # Maps domain state strings to semantic colors and labels
│   │   ├── CurrencyDisplay.tsx # Converts integer paise to formatted INR (₹)
│   │   ├── CopyButton.tsx      # Inline clipboard copy button with feedback
│   │   ├── EmptyState.tsx      # Illustrated empty state with call-to-action
│   │   ├── Skeleton.tsx        # Loading placeholder animation
│   │   ├── ConfirmDialog.tsx   # Confirmation dialog for critical mutations
│   │   └── SecretDisclosureModal.tsx # Dedicated one-time secret view with warning & copy
│   └── layout/
│       ├── Sidebar.tsx         # 9-section navigation sidebar with status footer
│       ├── Header.tsx          # Real-time backend status dot, active token indicator, control state
│       └── AppLayout.tsx       # Shell wrapper
├── api/                        # Centralized Typed API Client
│   ├── client.ts               # Base ApiClient wrapping fetch with CSRF, Bearer, and error envelopes
│   ├── health.api.ts           # System health check API
│   ├── control.api.ts          # Control plane session exchange, logout, and credential rotation
│   ├── orders.api.ts           # Order creation, lookup, and pagination
│   ├── payments.api.ts         # Payment attempt creation, simulation, and pending resolution
│   ├── checkout.api.ts         # Checkout session reissue, capability exchange, and token rotation
│   ├── webhooks.api.ts         # Webhook endpoint registration, updates, and secret rotation
│   ├── deliveries.api.ts       # Delivery history inspection and manual retry trigger
│   ├── events.api.ts           # Canonical event listing and multi-endpoint replay trigger
│   └── index.ts                # Unified API exports
├── context/
│   ├── AuthContext.tsx         # In-memory Bearer token, Control session state, CSRF, and health polling
│   └── ToastContext.tsx        # Toast alert dispatch and auto-dismissal
└── views/                      # Feature Views
    ├── OverviewView.tsx        # System summary, counters, recent activity, walkthrough
    ├── OrdersView.tsx          # Orders data table, creation modal, detail inspection
    ├── PaymentsView.tsx        # Payment attempts, simulation panel, pending resolution panel
    ├── CheckoutSimulatorView.tsx # Iframe checkout session reissue & dual-auth protocol testing
    ├── WebhooksView.tsx        # Loopback endpoint management, secret disclosure, secret rotation
    ├── EventsView.tsx          # Canonical domain events inspector, event replay modal
    ├── DeliveriesView.tsx      # Webhook delivery logs, attempt trail, manual retry trigger
    ├── CredentialsView.tsx     # Control session exchange, token rotation, safe metadata overview
    └── SettingsView.tsx        # Backend URL configuration, runtime health diagnostics
```

---

### 3. Centralized Typed API Client

The `ApiClient` class (`apps/web/src/api/client.ts`) provides a unified, strictly typed HTTP layer:
1. **Proxy Routing:** Uses relative URLs by default, allowing Vite's dev server (`127.0.0.1:5173`) to proxy requests directly to Express (`127.0.0.1:8787`).
2. **Authentication Injection:** Automatically includes `Authorization: Bearer <token>` when an active token is configured in memory, and passes `credentials: 'include'` for HttpOnly control session cookies.
3. **CSRF Enforcement:** Injects `X-PaySim-CSRF` on mutating control requests.
4. **Idempotency Propagation:** Forwards optional `Idempotency-Key` headers on mutating requests.
5. **Error Translation:** Intercepts non-2xx responses, extracts `StandardErrorEnvelope` from the body, and throws an `ApiError` with HTTP status, machine error code, and error message.

---

### 4. Detailed Feature Views

#### 4.1 Overview View (`OverviewView.tsx`)
- Displays real-time aggregate KPI counters: Active Orders, Captured Payments, Pending Payments, Failed Payments, Webhook Endpoints, and Delivery Attempts.
- Lists the 5 most recent orders and webhook deliveries with direct links to details.
- Features a four-step testing workflow guide for first-time developers.

#### 4.2 Orders View (`OrdersView.tsx`)
- Interactive cursor-paginated data table showing Order ID, Amount in INR, Currency, Status, Receipt, and Created At.
- "Create Order" modal converting entered rupees to validated paise (`ORD-04`, integer $\le 100,000,000$), with optional receipt, custom notes key-value pairs, and idempotency key.
- Order Details inspection modal displaying full JSON aggregate representation and child payment attempts.
- "Create Payment Attempt" action triggering attempt creation with method selector (`mock_card`, `mock_upi`, `mock_netbanking`, `mock_wallet`).

#### 4.3 Payments View (`PaymentsView.tsx`)
- Filterable data table by lifecycle status (`all`, `created`, `pending`, `authorized`, `captured`, `failed`, `cancelled`).
- Payment inspection modal showing amount, status, method, attempt number, monotonic version, and failure reason.
- **Interactive Simulation Panel:**
  - For `created` payments: Trigger deterministic simulations (`success`, `pending`, `failed`, `cancelled`) with configurable standard failure reasons (`PAYMENT_REJECTED`, `INSUFFICIENT_FUNDS`, `AUTHENTICATION_FAILED`, `GATEWAY_ERROR`, etc.).
  - For `pending` payments: Trigger pending resolutions (`success`, `failed`, `cancelled`).
  - For terminal payments (`captured`, `failed`, `cancelled`): Clearly highlights aggregate immutability.

#### 4.4 Checkout Simulator View (`CheckoutSimulatorView.tsx`)
- Reissue checkout sessions for active `created` payment attempts (`POST /api/v1/payments/:id/checkout-sessions`).
- Displays generated Session ID (`sess_ps_...`), capability token (`#...`), full checkout URL, and 15-minute expiration timestamp.
- **Dual-Authentication Handshake Tester:**
  - Step 1: Tests `POST /checkout/:sessionId/exchange` with the fragment capability token, displaying returned `sessionAccessToken`.
  - Step 2: Tests `POST /checkout/:sessionId/rotate-token` with Bearer auth, displaying rotated token and 30-second grace window expiration.

#### 4.5 Webhook Endpoints View (`WebhooksView.tsx`)
- Lists registered endpoints with loopback URL, wire serialization mode (`native` vs `compatibility`), status (`enabled` vs `disabled`), and subscribed events.
- "Register Endpoint" modal enforcing literal loopback IP targets (`127.0.0.1` or `[::1]`), event selection checkboxes, mode selector, and description.
- Secret Disclosure modal revealing one-time generated 256-bit signing secret.
- Edit Endpoint modal to update URLs, pause/enable endpoints, or modify event subscriptions.
- Secret Rotation modal calling `POST /api/v1/webhook-endpoints/:id/rotate-secret`, revealing new secret version.

#### 4.6 Canonical Events View (`EventsView.tsx`)
- Displays all immutable domain events emitted during state transitions (`payment.created`, `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`).
- Formatted JSON inspector modal showing event ID, type, payload snapshot, and timestamp.
- "Replay Event" modal allowing selection of enabled destination endpoints and dispatching `POST /api/v1/events/:id/replay`.

#### 4.7 Deliveries View (`DeliveriesView.tsx`)
- Comprehensive delivery audit log showing Delivery ID (`del_ps_...`), Event ID, Endpoint ID, Status (`delivered`, `failed`, `exhausted`, `redirect_rejected`, `pending`), Attempts ($n/3$), and Mode.
- Delivery detail modal displaying execution trail: attempt numbers, timestamps, HTTP status codes, durations in ms, and error messages.
- "Retry Delivery" button for failed or exhausted deliveries, calling `POST /api/v1/deliveries/:id/retry` to reuse exact stored snapshot bytes and secret version per PRD normative specification.

#### 4.8 API Credentials View (`CredentialsView.tsx`)
- **Control Plane Session:** Form to input the one-time 256-bit bootstrap token printed to console at startup (`SET-02`, `SET-03`). Establishes `HttpOnly` session cookie and acquires CSRF token.
- **Native Bearer Token Management:** Rotate Native token via `POST /control/v1/credentials/native/rotate` with one-time disclosure modal, automatically applying it to active in-memory client state.
- **Compatibility Key Pair Management:** Rotate Razorpay compatibility key pair via `POST /control/v1/credentials/compat/rotate` with one-time disclosure of `key_id` and raw `key_secret`.
- **Ephemeral Vault Overview:** Displays safe metadata from `GET /control/v1/credentials` (key IDs, versions, rotation dates, masked values, zero raw secret leakage).

#### 4.9 Settings View (`SettingsView.tsx`)
- Configurable API Base URL (defaults to empty string for Vite dev proxy, or custom loopback address).
- Interactive "Test Connection" button pinging `/health`.
- Runtime diagnostics inspection showing backend status, server uptime, and timestamp.

---

### 5. Automated Verification & Test Coverage

Three new test suites were added in `apps/web/tests/`:
1. **`formatters.test.ts` (6 tests):** Verifies paise-to-INR conversions (`formatINR`), single rupee calculations, lakhs formatting, maximum capacity limits, and decimal truncation flags.
2. **`api-client.test.ts` (8 tests):** Verifies `ApiClient` base URL normalization, header injection (`Authorization: Bearer`, `X-PaySim-CSRF`, `Idempotency-Key`), query parameter formatting, and error envelope parsing into `ApiError`.
3. **`domain-api-integration.test.ts` (10 tests):** Verifies end-to-end client calls across all domain modules: Health, Control, Orders, Payments, Checkout, Webhooks, Deliveries, and Events.

All tests pass cleanly:
```
Test Files  36 passed (36)
     Tests  431 passed (431)
```

Typechecking (`npm run typecheck`), linting (`npm run lint`), and production building (`npm run build`) all pass with zero errors and zero warnings.
