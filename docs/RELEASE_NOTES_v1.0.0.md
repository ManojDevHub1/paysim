# PAYSIM v1.0.0 Release Notes

> **Initial Public Release — Local Payment Gateway Simulator & Webhook Testing Laboratory**
> **Date:** 2026-11-04
> **Tag / Version:** `v1.0.0` (Official public release)
> **License:** MIT License (`Copyright (c) 2026 PAYSIM Contributors`)

---

## 🚀 Overview

The PAYSIM team is proud to announce the initial open-source release of **PAYSIM v1.0.0**.

PAYSIM is a local-first payment gateway simulator and developer laboratory designed to liberate engineering teams from the friction of third-party sandbox accounts, merchant KYC barriers, flaky reverse tunnels (e.g., ngrok), and database pollution.

With PAYSIM, you can simulate realistic payment state transitions, test embedded customer checkout experiences, receive authentic HMAC-signed webhooks through the local loopback interface, and verify cryptographic HMAC-SHA256 signatures — **with zero external service dependencies and zero databases**.

---

## ✨ Key Highlights

### 1. One-Command Developer Environment (`npm run dev`)
- Starts the Express 4 backend (`127.0.0.1:8787`) and React 18 frontend dashboard (`127.0.0.1:5173`) concurrently.
- Pre-flight TCP port collision detection with actionable error remediation.
- Prominent startup banner displaying endpoints and runtime environment diagnostics.
- Cross-platform process-tree termination ensuring zero orphan background processes on shutdown.

### 2. Dual Wire Protocol Ingress
- **Native PAYSIM API v1**: Complete REST API (`/api/v1/orders`, `/api/v1/payments`, `/api/v1/webhook-endpoints`, `/api/v1/deliveries`, `/api/v1/events`).
- **Selected Razorpay API Compatibility**: Compatible endpoints (`/v1/orders`, `/v1/checkout/embedded`) enabling teams using standard Razorpay Orders and embedded Checkout SDKs to point their client `baseUrl` to `http://127.0.0.1:8787`.

### 3. Interactive Payments Simulation Lab
- Deterministically trigger payment outcomes: `success` (instant capture), `failed` (with specific decline reason codes), `pending`, or `cancelled`.
- Atomic state machine guarantees: Payment state transitions synchronously transition the associated Order state without race conditions.

### 4. Outbound Webhook Delivery Engine
- **5 Concurrent Workers**: Multi-worker background delivery pool with bounded in-memory queue capacity (100 jobs); volatile in-memory queues and retry timers do not persist across process restarts.
- **Fixed Retry Schedule**: Immediate attempt, 500ms delay, and 2,000ms delay before marked `exhausted`.
- **Manual Retry Allowance**: Up to 3 manual delivery replays or retry triggers via the dashboard or API.
- **Payload Immutability**: Exact raw byte preservation (`DeliveryBodyVault`) ensuring HMAC signature stability across retries.

### 5. Developer Dashboard (React 18 + Vite)
- 9 purpose-built views:
  - **Overview**: Gateway throughput, delivery health, and quick actions.
  - **Orders**: Create and inspect orders with metadata and line items.
  - **Payments**: Payment attempt inspector and interactive Simulation Lab drawer.
  - **Checkout Simulator**: Embedded customer payment dialog testing card and UPI flows.
  - **Endpoints**: Webhook receiver registration and secret rotation.
  - **Events**: Canonical domain event stream explorer with replaying capabilities.
  - **Deliveries**: Detailed request/response inspection, timing logs, and signature debugging.
  - **API Credentials**: Rotate and manage native bearer tokens and basic auth keys.
  - **Settings**: System storage bounds and listener port telemetry.

### 6. Zero-Dependency Sample Webhook Receiver
- Included in `examples/node-webhook-receiver/`.
- Demonstrates safe raw byte buffering, constant-time HMAC-SHA256 verification (`crypto.timingSafeEqual`), and in-memory idempotency in under 25 lines of standard Node.js code.

---

## 🔒 Security Architecture & Guarantees

- **Strict Loopback Confinement**: Outbound webhook dispatches strictly restricted to literal loopback addresses (`127.0.0.1` and `[::1]`) on ports `1024` through `65535`. DNS hostnames (including `localhost`), alternate IP encodings, LAN ranges, and public IPs are strictly rejected. Socket attempts to cloud metadata (`169.254.169.254`) or active server ports are blocked.
- **In-Memory Vault Isolation**: Webhook signing secrets and delivery payload snapshots are isolated in dedicated memory vaults (`WebhookSecretVault`, `DeliveryBodyVault`). Secrets are scrubbed with zeroes (`0x00`) upon delivery exhaustion.
- **Zero Local Secrets Persistence**: The one-time bootstrap control token is generated in volatile RAM and disclosed exclusively via terminal stdout (SET-02/SET-03).
- **Public Contract Sanitization**: Public delivery API endpoints sanitize responses through `WebhookDeliveryEntitySchema` to prevent leaking internal scheduler or attempt metadata.

---

## 📦 Monorepo Package Breakdown

| Package | Version | Description |
|---------|:-------:|-------------|
| `paysim-monorepo` | `1.0.0` | Root orchestration workspace |
| `@paysim/server` | `1.0.0` | Express 4 HTTP server and webhook delivery engine |
| `@paysim/web` | `1.0.0` | React 18 + Vite developer dashboard |
| `@paysim/contracts` | `1.0.0` | Frozen Zod schemas and API route manifests |
| `@paysim/crypto` | `1.0.0` | Timing-safe HMAC calculation and memory zeroization |
| `@paysim/domain` | `1.0.0` | Pure deterministic order and payment state machines |
| `@paysim/shared` | `1.0.0` | Prefixed ID generators and JSON utilities |
| `@paysim/storage-memory` | `1.0.0` | Bounded memory repositories and `CommitCoordinator` |
| `paysim-sample-receiver`| `1.0.0` | Standalone sample webhook receiver |

---

## 🧪 Quality Gates & Verification

- **TypeScript Typecheck**: 0 errors across all 7 workspace packages and test suites.
- **ESLint Analysis**: 0 errors and 0 warnings.
- **Vitest Test Suite**: **546 tests passing across 49 test files** with zero failures.
- **Reproducible Installation**: Clean `npm ci --no-audit --no-fund` validated in isolated directory with zero lockfile mutation.
- **System Doctor**: 8/8 diagnostic checks passing in `scripts/doctor.mjs`.

---

## 📄 License & Legal Notice

PAYSIM is licensed under the [MIT License](LICENSE).

```text
Copyright (c) 2026 PAYSIM Contributors
```

> **Disclaimer**: PAYSIM does not process real currency, initiate real banking transactions, or store real credit card numbers. It is intended solely for local integration testing, webhook debugging, and developer education.
