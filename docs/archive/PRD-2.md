# PAYSIM — Product Requirements Document (Historical PRD-2.md Archive)

> [!WARNING]
> **ARCHIVED HISTORICAL FILE**
> This file is a historical legacy root duplicate of the PRD v2.2.0 baseline.
> It has been archived and superseded by the canonical normative specification at **[docs/PRD_v2.3.md](../PRD_v2.3.md)**.
> For canonical archived v2.2 documentation, see **[docs/PRD.md](../PRD.md)**.

**Document version:** 2.2.0 (ARCHIVED / SUPERSEDED by [PRD v2.3](../PRD_v2.3.md))
**Status:** ARCHIVED — Historical duplicate from repository root; superseded by PRD v2.3.0
**Successor Specification:** [docs/PRD_v2.3.md](../PRD_v2.3.md)
**Document owner:** PAYSIM Project
**Product category:** Local-first payment workflow simulator and webhook testing tool
**Primary audience:** MERN, Node.js, React, and full-stack developers; students learning payment integrations
**Default mode:** Local-only simulation; no real payment processing
**Currency scope for MVP:** INR only
**Storage for MVP:** In-memory session storage; no database
**Target operating systems:** Windows 11, macOS, and mainstream Linux distributions
**Runtime target:** Node.js 24.x (Maintenance LTS) and 26.x (Active LTS) as of 3 November 2026; test both supported lines and use current security patches
**Last updated:** 3 November 2026

---

## Document Purpose and Status

This document is the single source of truth for the PAYSIM MVP. PRD v1.0, v2.0, and v2.1 are retained as immutable archives. Version 2.2 resolves the follow-up audit findings around control-session exchange, compatibility checkout-session creation, secret-version retention, endpoint delivery mode, canonical-event serialization, payment/session expiry, event ordering, delivery result classification, bounded retention, and fixture traceability. The requirements below are normative. A passing document review is not evidence that implementation or automated tests have been completed.

The design deliberately combines two integration surfaces:

1. **PAYSIM Native API** — a stable, clearly branded API for applications that choose to integrate directly with PAYSIM.
2. **Razorpay-style Compatibility Adapter** — a limited, documented local adapter for testing a selected subset of familiar Razorpay Orders API and Standard Checkout integration patterns with PAYSIM-issued test credentials.

The compatibility adapter is **not** a full replacement for Razorpay, is not an official Razorpay SDK, and does not connect to Razorpay infrastructure. It supports only the contracts explicitly listed in this document. Existing applications will need to point their integration to PAYSIM's local adapter and use the PAYSIM checkout shim or bridge package. An unmodified official SDK that hardcodes a remote provider URL is not assumed to work.

This is a software-development simulator. It does not provide a financial service, enable real payments, bypass merchant onboarding rules, or make real UPI/card/bank transactions.

---

# 1. Executive Summary

## 1.1 Product Definition

PAYSIM is a local-first payment simulator and webhook laboratory for developers. It allows developers to create mock orders, open a simulated checkout, choose deterministic payment outcomes, generate signed payment events, deliver those events to explicitly configured local webhook handlers, and inspect or replay delivery attempts.

PAYSIM is designed to help a developer test application behavior before connecting to a real payment provider or obtaining merchant onboarding. It runs on the developer's machine, requires no merchant account or KYC documents, uses no paid APIs, and does not move money.

## 1.2 One-line Value Proposition

> Simulate payment flows, test local webhooks, and debug integration logic — without merchant onboarding or real transactions.

## 1.3 Product Positioning

PAYSIM is a **developer tool**, not a payment gateway, bank, wallet, payment aggregator, UPI app, or financial service.

The phrase **“zero KYC”** means that a developer does not need merchant onboarding to use a local simulation tool. It must never be presented as a way to bypass financial regulation, provider onboarding, identity checks, or production payment requirements.

PAYSIM must display a persistent simulation disclosure in the dashboard, checkout, API responses, logs, examples, and exported fixtures:

> PAYSIM SIMULATION — no money is collected, transferred, authorized, settled, or refunded.

## 1.4 Product Pillars

| Pillar | Purpose | Primary user outcome |
|---|---|---|
| Payment Lab | Create orders, launch mock checkout, and simulate payment states | Verify application payment-state logic |
| Webhook Studio | Configure local endpoints, send signed events, retry, and replay | Verify server-side event handling |
| Compatibility Adapter | Emulate a declared subset of Razorpay-style Orders and Checkout contracts | Test common Razorpay-shaped integration code against a local simulator |
| Developer Console | Inspect orders, payment attempts, events, deliveries, and API responses | Diagnose integration issues quickly |
| Learning & Examples | Provide cURL, Node.js, Express, and React integration examples | Help developers learn safe payment integration patterns |

## 1.5 Primary Product Promise

A developer can complete this local workflow without a real provider account:

1. Start PAYSIM locally.
2. Generate local test credentials.
3. Create a mock order using the Native API or Compatibility Adapter.
4. Open the PAYSIM checkout shim.
5. Select a mock payment method and deterministic outcome.
6. Receive a simulated callback and/or signed webhook at a local application endpoint.
7. Inspect the event, raw request, response, delivery attempts, and signature.
8. Retry or replay an event after fixing the local receiver.

---

# 2. Problem Statement

## 2.1 Developer Problems

Developers building e-commerce, SaaS, booking, or other applications often need to test payment flows before they have access to a provider's merchant account or test credentials. They also need to reproduce payment failure cases, understand asynchronous state changes, verify webhook signatures, and debug local webhook receivers.

A real provider's test environment remains the correct place to test that provider's actual infrastructure and current behavior. However, it may require an account and does not always provide the lightweight, deterministic local workflow needed for rapid development or learning.

PAYSIM fills that local simulation gap. It does not replace a provider's official test mode or certify a production integration.

## 2.2 Problems PAYSIM Solves

- Create mock orders without creating a real merchant account.
- Simulate successful, pending, failed, and cancelled payment attempts.
- Simulate a common UPI checkout selection flow without opening a UPI app or creating a payable QR code.
- Test the separation between an order and one or more payment attempts.
- Send payment event notifications to a developer's local HTTP server.
- Verify raw-body HMAC webhook handling.
- Inspect request headers, JSON payload, response status, error, and duration.
- Reproduce timeout, connection failure, non-2xx, duplicate, and replay scenarios.
- Test familiar Razorpay-style integration patterns through a scoped local compatibility layer.
- Learn the difference between browser checkout callbacks, server-side payment verification, and asynchronous webhooks.

## 2.3 Problems PAYSIM Does Not Solve

- It does not prove that a real payment has occurred.
- It does not test bank, NPCI, UPI network, card network, wallet, or acquiring-bank availability.
- It does not validate real merchant credentials or a real provider account.
- It does not guarantee that an application is production-ready or compliant.
- It does not mirror every endpoint, SDK, checkout option, payment method, or event of Razorpay or any other provider.
- It does not deliver webhook events to public internet destinations in the MVP.

---

# 3. Goals, Non-Goals, and Product Constraints

## 3.1 MVP Goals — P0

1. Run completely on a developer's machine.
2. Require no KYC, merchant account, provider account, real provider key, database, paid API, or external service.
3. Expose a Native REST API for mock orders and payments.
4. Expose a scoped Razorpay-style local compatibility adapter.
5. Provide a local simulated checkout UI and JavaScript compatibility shim.
6. Support mock UPI, mock card, and mock wallet as labels and simulated paths only.
7. Support success, pending, failure, and cancellation scenarios.
8. Model orders and payment attempts as separate resources.
9. Enforce valid payment state transitions and prevent duplicate completion.
10. Generate immutable event records for accepted state transitions.
11. Deliver signed webhook events to explicitly authorized loopback destinations only.
12. Support endpoint-level event subscriptions, enable/disable, edit, secret rotation, retry, and replay.
13. Preserve delivery-attempt history without overwriting earlier attempts.
14. Provide API Playground, cURL examples, Node/Express examples, and a clear compatibility matrix.
15. Apply bounded request sizes, response previews, event history, queue length, concurrency, and delivery timeouts.
16. Provide automated unit, integration, compatibility, UI, and security tests.
17. Make every simulated action unmistakably different from a real payment action.

## 3.2 Non-Goals — Explicitly Out of Scope

PAYSIM MVP will not:

- Accept, hold, transfer, settle, refund, or withdraw real money.
- Initiate UPI intents, UPI collect requests, real QR payment requests, card authorization, bank transfers, or wallet transfers.
- Connect to NPCI, banks, card networks, Razorpay, or other payment provider infrastructure.
- Collect real card numbers, CVVs, UPI PINs, OTPs, banking passwords, or payment credentials.
- Store real payment details or sensitive financial identity data.
- Provide production payment processing, merchant acquiring, settlement, compliance, or fraud screening.
- Provide an unrestricted HTTP request proxy or public webhook relay.
- Send webhook events to arbitrary public URLs, LAN IPs, private network addresses, or cloud metadata endpoints.
- Automatically tunnel a developer's machine to the public internet.
- Claim complete drop-in compatibility with Razorpay's official SDKs or all Razorpay API versions.
- Offer subscriptions, payouts, refunds, settlements, disputes, recurring billing, or multi-currency support in the MVP.
- Require MongoDB, Redis, Docker, cloud hosting, or a third-party service to run the basic MVP.

## 3.3 Hard Product Constraints

| Constraint | Locked rule |
|---|---|
| Cost | ₹0 required infrastructure cost; all core workflows run locally |
| External network | No outbound network calls for normal PAYSIM operation |
| Payments | Simulated only; no real value or financial effect |
| Storage | In-memory for MVP; no database required |
| Network bind | Loopback only by default; never bind to `0.0.0.0` by default |
| Webhook targets | Literal loopback IP addresses only in MVP |
| Currency | INR only; amounts represented as integer paise |
| Runtime | Node.js 24.x and 26.x LTS; latest security patch within supported major |
| Package manager | npm with committed `package-lock.json` |
| Architecture | TypeScript, modular domain services, explicit API contracts |
| Product identity | Independent PAYSIM simulator; no claim of official provider affiliation |

---

# 4. Target Users and Jobs to Be Done

## 4.1 Persona A — MERN Developer

**Profile:** Builds React interfaces and Node.js/Express APIs, often using MongoDB in their own application.

**Needs:**
- Create orders from a backend.
- Launch checkout from React.
- Receive payment events in an Express route.
- Verify signatures from the raw request body.
- Handle duplicate or delayed notifications.

**Success:** Can test the full application path with synthetic data before using provider credentials.

## 4.2 Persona B — Full-Stack Developer

**Profile:** Works across frontend, API, and integrations.

**Needs:**
- Inspect raw HTTP requests and responses.
- Reproduce failure and timeout cases.
- Retry and replay events.
- Validate API contract behavior.

**Success:** Can locate whether a failure occurred in order creation, checkout, payment state, webhook delivery, or receiver handling.

## 4.3 Persona C — Student or Learner

**Profile:** Learning payment concepts and backend integration patterns.

**Needs:**
- Understand order vs payment vs webhook event.
- See how payment outcomes change state.
- Learn why browser callbacks are not the only source of truth.
- Follow copy-ready but safe examples.

**Success:** Can explain and demonstrate a mock payment workflow without handling real financial credentials.

## 4.4 Primary Jobs to Be Done

- “When I build checkout, I want to simulate the full flow locally so that I can test UI and backend behavior without merchant onboarding.”
- “When my webhook handler fails, I want to inspect and replay the same event so that I can reproduce and fix the bug.”
- “When I use Razorpay-style integration patterns, I want a local compatibility layer so that I can test a documented subset before connecting to the real provider.”
- “When I am learning payments, I want every state and event explained so that I do not confuse a simulated result with a real payment.”

---

# 5. Locked Product and Architecture Decisions

These decisions replace the unresolved items from PRD v1.0. They are not optional implementation guesses.

## 5.1 Two API Surfaces

PAYSIM provides both:

- **Native mode:** PAYSIM-owned REST API under `/api/v1`.
- **Compatibility mode:** Razorpay-style subset under `/compat/razorpay/v1`.

Both modes use the same domain services and in-memory repositories. They must not implement separate payment state machines.

## 5.2 Compatibility Is Scoped, Not Universal

The compatibility adapter supports a documented subset of Orders API and Standard Checkout integration patterns. It does not claim complete compatibility with every Razorpay SDK or API.

To use compatibility mode, developers must:

1. Generate PAYSIM compatibility credentials.
2. Set their local integration base URL to PAYSIM's compatibility route, or use the PAYSIM bridge package.
3. Load PAYSIM's local checkout compatibility script instead of a provider-hosted remote script.
4. Use PAYSIM's test key secret for local callback signature verification.
5. Point webhook delivery at an authorized local receiver.

A provider SDK that hardcodes a remote API hostname is unsupported unless the developer uses a PAYSIM bridge or a documented base-URL override. PAYSIM must not intercept or redirect production provider traffic.

## 5.3 Default Ports

| Service | Development default | Packaged/local release default |
|---|---:|---:|
| Vite web development server | `127.0.0.1:5173` | Not used |
| PAYSIM API and local server | `127.0.0.1:8787` | `127.0.0.1:8787` |
| Checkout shim | Served by PAYSIM server | Served by PAYSIM server |

The server must fail with a clear actionable error if the configured port is occupied. It must not silently bind to a public interface or choose an undocumented origin. `PAYSIM_HOST` may only accept `127.0.0.1` or `::1` in MVP. Default is `127.0.0.1`.

## 5.4 Storage Strategy

- All business records are stored in bounded in-memory repositories.
- Server restart clears all orders, payments, events, deliveries, API credentials, control sessions, and webhook endpoint configuration.
- UI preferences may be stored in browser local storage, but secrets and payment records may not.
- The UI must state “Session-only data — cleared when PAYSIM stops.”
- JSON persistence, SQLite, MongoDB, and import/export are deferred.

## 5.5 API Credential Strategy

PAYSIM has separate credential classes with separate storage rules:

| Credential | Client use | Server-side storage | One-time reveal | Rotation behavior |
|---|---|---|---|---|
| Dashboard control token | Initial dashboard login only | One-time token hash in memory | Printed once to terminal | Consumed once; restart creates a new token |
| Native API token | Bearer authentication | Salted scrypt hash only; no recovery required | Shown once | Old token is rejected immediately |
| Compatibility key secret | HTTP Basic authentication and synthetic checkout callback HMAC | Salted scrypt verifier **and** raw secret bytes in a dedicated ephemeral in-memory vault | Shown once | New API requests use only the current version; an older version remains in the vault while any non-terminal payment attempt created under it may still need a synthetic callback signature |

The compatibility secret has two representations for distinct purposes: the salted scrypt verifier validates incoming HTTP Basic authentication, while the ephemeral vault copy signs PAYSIM's synthetic checkout callback. The raw copy is never persisted to disk, logged, exported, or returned after initial reveal. This is not a password-recovery feature; it is an explicitly session-scoped signing requirement. Credential records contain only metadata, verifier hash, version, and opaque vault reference.

Rotation immediately rejects the prior version for new authenticated API requests. Existing payment attempts retain the exact credential version that created them. The corresponding raw signing secret remains available only in the process-memory vault until every linked payment attempt is terminal and every linked checkout session is expired, revoked, or consumed; it is then purged. Session expiry alone does not cancel a payment attempt. If the required secret version is unavailable when a callback signature is needed, the callback fails closed with a non-sensitive credential-version error; it must never fall back to a different key.

All credentials are PAYSIM-local test credentials and are never valid against a real payment provider.

## 5.6 Webhook Secret Strategy

- Each webhook endpoint receives a cryptographically random signing secret with at least 256 bits of entropy.
- Secret bytes are held only in a dedicated in-memory vault keyed by endpoint ID and secret version.
- The plaintext secret is shown once, then masked. The endpoint record and UI responses contain only a vault reference and version metadata.
- A prior secret version remains available only while a retained, retry-eligible delivery references it. It is removed when no eligible delivery references it, when the related records are safely evicted, or when the server session ends.
- New deliveries use the endpoint's current secret version.
- Retry uses the original delivery's snapshotted secret version. Replay uses the selected endpoint's current secret version.
- Secret rotation does not rewrite existing delivery snapshots.
- Secret bytes must never appear in logs, exports, request previews, error messages, browser storage, or source control.

## 5.7 Loopback Target Strategy

MVP accepts only literal loopback IPs:

- `http://127.0.0.1:<port>/<path>`
- `http://[::1]:<port>/<path>`

MVP rejects `localhost` hostnames and all DNS names. This avoids DNS rebinding and resolution ambiguity. The developer must use a port published to the host when testing a Docker or WSL application. LAN and private IP targets are intentionally not supported.

## 5.8 Retry and Replay Strategy

- **Retry** operates on the same delivery record. It retains the original event ID, serialized request-body bytes, endpoint URL/configuration snapshot, delivery mode, and secret version. It appends new immutable attempt records.
- **Replay** creates a new delivery record for an existing canonical event and a user-selected enabled endpoint. It uses that endpoint's current URL, mode, subscriptions, custom headers, and current secret version. The canonical event identity, event type, and event timestamp remain unchanged; the serialized body is generated by the selected endpoint mode's deterministic serializer.
- A retry can never change payment/order state or create a new event. A replay can never change payment/order state or mutate the canonical event.
- Automatic attempts are bounded to three per delivery. Manual Retry is limited to three manual retry operations per delivery; each manual retry creates one immediate attempt and does not start another automatic retry cycle. Replay creates a new delivery with its own bounded attempt budget.

## 5.9 Checkout Browser Transport

The compatibility script is a classic browser script served by PAYSIM. It must not call PAYSIM payment APIs directly from the developer page. The server-side PAYSIM Node bridge authenticates to the compatibility adapter, creates a payment attempt and checkout session, and passes the returned `checkout_url` to the browser shim. The shim creates a PAYSIM-hosted checkout iframe; only that iframe calls PAYSIM APIs, same-origin with the PAYSIM server.

The checkout-session request binds a validated `parentOrigin` to the session. The returned checkout URL includes that non-secret origin as a query parameter and the opaque one-time capability token only in the URL fragment, for example `http://127.0.0.1:8787/checkout/chk_ps_example?parentOrigin=http%3A%2F%2F127.0.0.1%3A3000#<opaque-token>`. The shim compares `window.location.origin` with the session-bound parent origin before creating the iframe. The query parameter is not trusted by itself; the server-side checkout session record is authoritative.

The parent page and iframe communicate through a versioned `postMessage` protocol with exact origin checks, exact source-window checks, a per-session nonce, and a bounded schema. Wildcard `targetOrigin` (`*`) is prohibited. The parent origin must be an explicit loopback HTTP origin using `127.0.0.1` or `[::1]` and an explicit port. `localhost`, DNS hostnames, HTTPS downgrade, and non-loopback parent origins are not supported in MVP. The iframe validates `event.origin`, `event.source`, message schema, nonce, checkout-session binding, and protocol version. The parent validates the iframe source, exact PAYSIM checkout origin, nonce, and message schema. The checkout document sets a per-session `Content-Security-Policy: frame-ancestors` value for the validated parent origin; it never uses a wildcard ancestor policy.

The checkout token is carried in the fragment, never in the query string or referrer. The checkout page reads it and exchanges it in a same-origin POST body; the fragment is removed from the visible URL immediately after reading. A successful exchange sets an HttpOnly, SameSite=Strict cookie scoped to `/checkout/<sessionId>` with a lifetime no longer than the checkout session expiry. The session record stores only a hash/verifier for this cookie. The exchanged capability token cannot be used a second time; subsequent same-origin iframe requests use the scoped cookie until the session expires or is revoked. The iframe can be hidden and reopened without changing payment state while this checkout session remains valid. `Referrer-Policy: no-referrer` and `Cache-Control: no-store` are mandatory on checkout documents and token-exchange responses. URL paths, query strings, console output, analytics, and access logs must not contain the raw token. No third-party network resource is loaded.

## 5.10 Dashboard Control Session Contract

- `POST /control/v1/session/exchange` is the only initial control-token exchange route. It is unauthenticated by cookie but still requires a valid loopback Host and Origin, same-origin request, bounded JSON body, and login rate limit.
- The control token is 256-bit random material printed once to the terminal. The server stores only a one-time verifier/hash in memory; successful exchange consumes it atomically.
- A successful exchange sets an HttpOnly, SameSite=Strict cookie scoped to `/control/v1`, and returns a CSRF token in a no-store JSON response. The CSRF token is held in application memory, not localStorage/sessionStorage.
- Dashboard session idle timeout is 30 minutes; absolute lifetime is 8 hours. Either expiry invalidates the session. Logout and reset revoke it immediately.
- Mutating Control API requests require the session cookie, exact Origin/Host validation, and `X-PaySim-CSRF`. Safe GET requests do not require a CSRF header but still require a valid session except the public health route.
- Login exchange is rate-limited to 5 failed attempts per 60 seconds per browser origin; a bounded 429 response includes `Retry-After`. No permanent lockout is used.
- On plain local HTTP, `Secure` is omitted because browsers will not send a Secure cookie over HTTP. On a secure local origin, `Secure` is set. The server never sets `Domain` on the cookie.

## 5.11 Payment Amount and Time Limits

- `MAX_ORDER_AMOUNT_PAISE` is fixed at `100_000_000` (₹10,00,000) for MVP. Both Native and Compatibility APIs enforce the same inclusive upper bound.
- Checkout capabilities expire 15 minutes after their checkout session is created. Expiry invalidates the capability and removes its raw token from the token vault; it does **not** change the payment or order state and emits no payment event.
- A payment attempt that remains `created` after capability expiry stays `created`. A new checkout session may be issued for that same payment through `POST /api/v1/payments/:paymentId/checkout-sessions` (Native API) or the documented Compatibility checkout-session extension. For this rule, an active checkout session means a session that is unexpired and not revoked. A consumed capability is no longer reusable, but the session remains active through its scoped HttpOnly cookie until expiry or revocation. Reissue does not create a new payment attempt and does not emit `payment.created` again.
- A checkout session is single-capability: its raw token is exchanged once to establish a scoped HttpOnly checkout-session cookie. `consumedAt` records token exchange; it does not end the checkout session. The session remains active until expiry or revocation, and its iframe cookie authorizes same-origin checkout actions until then. A new session has a new session ID, token, nonce, and 15-minute expiry while retaining the existing payment ID.
- If the payment is already `pending`, `authorized`, `captured`, `failed`, or `cancelled`, session expiry does not change payment state and reissue is rejected with `CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`.
- Closing/dismissing the modal without selecting a simulator outcome does not change payment state. The same session may be reopened until its capability is exchanged or expires. A user-selected Cancel outcome is a real simulator transition to `cancelled`.
- Expiry is enforced by both a 1-second bounded session sweeper and on-access checks. The token-vault removal and session-expired marker are atomic; payment transitions are controlled only by explicit payment commands.

## 5.12 No Open Blocking Decisions

All MVP product decisions necessary to begin implementation are defined in this PRD. Any implementation deviation must be recorded in an architecture decision record (ADR) and must not weaken the safety, simulation, authentication, or compatibility boundaries defined here. This statement means there are no intentionally unresolved P0 product decisions; it does not mean the software has already been implemented or tested.

# 6. User Journeys and End-to-End Flows

## 6.1 First Run and Local Setup

1. Developer clones or downloads PAYSIM.
2. Developer installs dependencies using `npm install`.
3. Developer runs `npm run dev`.
4. PAYSIM starts the API at `http://127.0.0.1:8787` and the development UI at `http://127.0.0.1:5173`.
5. PAYSIM prints a one-time local control token to the terminal. The token is not written to a file or log file.
6. Developer opens the dashboard and enters the control token.
7. PAYSIM creates a short-lived same-site local dashboard session.
8. Developer generates Native API and/or Compatibility credentials from Settings.
9. Dashboard displays that data is in-memory and simulated.

**Acceptance:** No external service, database, account, KYC document, payment-provider credential, or public network access is required.

## 6.2 Native Payment Flow

1. Developer sends `POST /api/v1/orders` with an integer amount in paise, currency `INR`, and an idempotency key.
2. PAYSIM validates and creates a mock order in `created` state.
3. Developer starts a payment attempt using `POST /api/v1/orders/:orderId/payment-attempts`.
4. PAYSIM creates a payment attempt in `created` state and returns a local checkout URL.
5. Developer opens the checkout URL.
6. Checkout displays the order summary, simulation disclosure, and mock payment methods.
7. Developer chooses success, pending, failure, or cancellation.
8. PAYSIM applies the valid state transitions and emits immutable events.
9. Matching webhook endpoints receive signed event deliveries asynchronously.
10. Developer inspects the order, payment, event, and delivery details.

## 6.3 Compatibility Flow

1. Developer generates a PAYSIM Compatibility key ID and secret in the local dashboard.
2. Developer configures the explicit PAYSIM compatibility `baseURL` and credentials in the server-side PAYSIM Node bridge; no provider URL is intercepted.
3. Backend creates an order using the supported Razorpay-style order request shape.
4. Backend calls the PAYSIM-specific `POST /compat/razorpay/v1/orders/:orderId/checkout-sessions` extension using HTTP Basic authentication, an idempotency key, a mock payment method, and the developer application's exact loopback `parent_origin`.
5. PAYSIM validates order ownership, creates one payment attempt and a 15-minute checkout session atomically, and returns `payment_id` plus `checkout_url`.
6. Backend passes the PAYSIM public `key_id`, order fields, and returned `checkout_url` to the browser. The secret remains server-side and is never passed to the browser.
7. The local classic shim creates a PAYSIM-hosted checkout iframe only after checking the current page origin against the session-bound parent origin. The iframe, not the developer page, calls PAYSIM APIs same-origin.
8. Parent and iframe complete a versioned nonce-bound `postMessage` handshake using exact origins, exact source windows, and a bounded message schema; wildcard target origins are forbidden.
9. The iframe presents mock methods and deterministic outcomes. On simulated success, the shim invokes the configured handler with the documented synthetic callback response.
10. The server-side bridge can verify the synthetic callback signature using the credential version bound to the payment attempt. The browser never receives the key secret.
11. PAYSIM emits a canonical event and endpoint-mode-specific webhook delivery. The developer's local receiver handles the synthetic event.

This tests application code against PAYSIM's declared compatibility subset. It is not a proof that the same code works with live provider infrastructure.

## 6.4 UPI Simulation Flow

1. Developer chooses “Mock UPI” in checkout.
2. PAYSIM shows an illustrative UPI-like screen clearly labelled “SIMULATION — NOT CONNECTED TO UPI.”
3. Developer chooses success, pending, failure, or cancel.
4. PAYSIM records the simulated result and emits events.

No UPI app is launched. No UPI intent or collect request is created. No real VPA, UPI PIN, OTP, QR payment request, or bank information is collected.

## 6.5 Webhook Registration Flow

1. Developer opens Webhook Studio.
2. Developer chooses Add Endpoint.
3. Developer enters a label, exact loopback URL with explicit port, and event subscriptions.
4. PAYSIM validates the URL at creation and again immediately before every delivery.
5. Developer confirms that they control the selected local endpoint.
6. PAYSIM creates an endpoint and generates a unique test secret.
7. Secret is displayed once with Copy and “I have saved this secret” actions.
8. Endpoint is shown as enabled and ready.

## 6.6 Failed Delivery and Retry Flow

1. PAYSIM attempts a webhook POST.
2. Target returns a non-retryable status, retryable status, connection failure, or timeout.
3. PAYSIM records the attempt outcome and response preview.
4. For retryable failures, PAYSIM performs the bounded automatic retry policy.
5. After automatic attempts are exhausted, user may inspect and manually Retry.
6. If endpoint configuration or secret was changed, the original delivery can only retry with its retained configuration/secret version. If that version is no longer available, PAYSIM explains why and offers Replay using current endpoint settings.
7. Retry creates a new attempt; it never deletes or overwrites earlier attempts.

## 6.7 Replay Flow

1. Developer opens an event or delivery.
2. Developer selects Replay.
3. Developer selects one or more enabled endpoints.
4. PAYSIM creates a new delivery per selected endpoint.
5. Event ID and event payload remain identical to the original logical event.
6. New delivery ID, attempt ID, creation time, destination configuration, and signature may differ.
7. The dashboard groups original and replayed deliveries under the same event.

---

# 7. Functional Requirements

Priority meanings:
- **P0:** Required for the first usable MVP release.
- **P1:** Required for the first minor release after MVP or can be included if it does not delay P0.
- **P2:** Future enhancement; not an MVP release blocker.

Every P0 row is an acceptance requirement, not merely a design suggestion.

## 7.1 First-Run Setup and Control Session

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| SET-01 | P0 | Start locally with one documented command | `npm run dev` starts API and web development servers without a database or external credential |
| SET-02 | P0 | Generate a local control token | Token is cryptographically random, printed once to terminal, and never stored in a tracked file |
| SET-03 | P0 | Authenticate dashboard | `POST /control/v1/session/exchange` atomically consumes the one-time control token, validates loopback Origin/Host, and issues a short-lived HttpOnly, SameSite=Strict cookie plus CSRF token |
| SET-04 | P0 | Protect state-changing UI actions | CSRF token and strict Origin/Host validation are applied to control-plane requests |
| SET-05 | P0 | Show local-only mode | Dashboard visibly displays the local host, session state, and simulation warning |
| SET-06 | P0 | Explain in-memory reset | First-run and Settings views state that server restart clears records and credentials |
| SET-07 | P0 | Reject non-loopback bind configuration | Startup fails if host is not `127.0.0.1` or `::1` |
| SET-08 | P0 | Detect port collision | Startup fails with the configured port and a safe remediation message; no public bind fallback |
| SET-09 | P1 | Revoke dashboard sessions | Settings can revoke active dashboard sessions |

## 7.2 Dashboard Overview

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| DASH-01 | P0 | Show session summary | Counts orders, payment attempts, captured payments, pending payments, events, and failed deliveries |
| DASH-02 | P0 | Show recent activity | Recent orders, payments, events, and delivery attempts appear newest-first |
| DASH-03 | P0 | Show simulation disclosure | Persistent visible notice states that all records are simulated and no money moves |
| DASH-04 | P0 | Show storage state | Displays “In-memory session — cleared when PAYSIM stops” |
| DASH-05 | P1 | Filter summary | Date and status filters update dashboard cards and activity list consistently |
| DASH-06 | P1 | Show quick actions | Create order, add webhook endpoint, open API Playground, and view docs are accessible |

## 7.3 Credentials and Authentication

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| AUTH-01 | P0 | Generate Native API test token | Token uses a PAYSIM-specific prefix and is shown once |
| AUTH-02 | P0 | Generate Compatibility key pair | Key ID and key secret are generated locally and shown once |
| AUTH-03 | P0 | Store credentials safely | Native bearer token is stored as a salted verifier hash only. Compatibility key secret is stored as a salted verifier hash plus a separate ephemeral in-memory vault reference because the synthetic callback HMAC requires the original bytes; no secret is persisted to disk |
| AUTH-04 | P0 | Authenticate Native API | Protected Native routes require `Authorization: Bearer <PAYSIM_TEST_TOKEN>` |
| AUTH-05 | P0 | Authenticate Compatibility API | Compatibility routes require HTTP Basic credentials issued by PAYSIM |
| AUTH-06 | P0 | Separate control and developer credentials | Dashboard control token cannot be used as a developer API key and vice versa |
| AUTH-07 | P0 | Redact secrets | Logs, UI inspectors, errors, event exports, and cURL history redact credential values |
| AUTH-08 | P0 | Rotate credentials | Rotation invalidates the old key immediately for subsequent requests |
| AUTH-09 | P0 | Reject live-looking credentials | PAYSIM accepts only PAYSIM-issued test credential formats; it never attempts provider authentication |
| AUTH-10 | P1 | Support multiple local API keys | Multiple named keys with independent revocation; all in-memory |

Credentials are local development secrets only. They must never be used in a production deployment or submitted to any real payment provider.

## 7.4 Orders

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| ORD-01 | P0 | Create mock order | Valid request returns a unique order ID, amount, currency, status, and simulation markers |
| ORD-02 | P0 | Retrieve mock order | Known ID returns the complete order and related payment-attempt summary |
| ORD-03 | P0 | List orders | Cursor pagination, `limit`, status filter, and newest-first sorting are supported |
| ORD-04 | P0 | Validate amount | Amount must be a positive safe integer in paise and must not exceed `MAX_ORDER_AMOUNT_PAISE = 100_000_000` (₹10,00,000); floats, zero, negative, NaN, unsafe integers, and values above the cap are rejected |
| ORD-05 | P0 | Validate currency | MVP accepts only `INR` |
| ORD-06 | P0 | Validate receipt | Optional receipt is a string of at most 40 characters; duplicate receipt values are allowed and are not used as resource IDs |
| ORD-07 | P0 | Validate metadata | Optional JSON object only; bounded to 8 KB; reserved keys cannot override PAYSIM fields |
| ORD-08 | P0 | Mark as simulated | Every order includes `simulated: true` and `livemode: false` |
| ORD-09 | P0 | Enforce idempotent creation | Same idempotency key and same canonical body returns original order; same key with different body returns 409 |
| ORD-10 | P0 | Keep order lifecycle separate | Order status does not reuse payment attempt status values |
| ORD-11 | P0 | Prevent new attempt after paid | Paid orders reject new payment attempts with a conflict error |
| ORD-12 | P1 | Search orders | Search by order ID or receipt within the active session |

## 7.5 Payment Attempts and Checkout Sessions

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| PAY-01 | P0 | Create payment attempt | A payment attempt is created for an order and receives its own unique payment ID |
| PAY-02 | P0 | Separate attempt from order | One order may have multiple sequential attempts; order and payment statuses are stored independently |
| PAY-03 | P0 | Allow one active attempt per order | A new attempt is allowed only after the prior attempt has failed or been cancelled; parallel active attempts are rejected |
| PAY-04 | P0 | Generate local checkout URL | Checkout URL contains only an opaque, short-lived, random session token; no API secret or signing secret |
| PAY-05 | P0 | Support four core outcomes | Success, pending, failure, and cancelled are selectable in the local simulator |
| PAY-06 | P0 | Resolve pending payment | Pending attempt can later be resolved to success, failure, or cancellation from the dashboard or Native API |
| PAY-07 | P0 | Enforce idempotent attempt creation | Repeated request with same idempotency key and identical body returns the same attempt/session |
| PAY-08 | P0 | Reject invalid outcome transition | Invalid state changes return a typed 409 error and do not emit an event |
| PAY-09 | P0 | Keep monetary amount immutable | Payment amount and currency are copied from the order and cannot be edited during simulation |
| PAY-10 | P0 | Block second success after paid order | Once an order is paid, additional attempts and captures are rejected |
| PAY-11 | P0 | Prevent sensitive data capture | Checkout contains no card, CVV, UPI PIN, OTP, bank password, or real payment credential input |
| PAY-12 | P0 | Identify mock payment method | Stored method is one of `mock_upi`, `mock_card`, or `mock_wallet` |
| PAY-13 | P1 | Add authorization-only scenario | Developer can simulate authorization without capture and then manually capture or cancel |
| PAY-14 | P1 | Add test delay | Configurable bounded delay for asynchronous UI and timeout testing |
| PAY-15 | P0 | Reissue checkout session | `POST /payments/:paymentId/checkout-sessions` may issue a new 15-minute checkout session only for a `created` attempt with no unexpired, unrevoked session; it never creates a new payment attempt |

## 7.6 Simulated Checkout UI

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| CHK-01 | P0 | Serve checkout locally | Checkout assets and script are served by PAYSIM; no remote provider script is loaded |
| CHK-02 | P0 | Show simulation warning | Clear “PAYSIM SIMULATION — NOT A REAL PAYMENT” banner is visible before outcome selection |
| CHK-03 | P0 | Show order summary | Amount, INR currency, mock order ID, and test mode label are visible |
| CHK-04 | P0 | Offer mock payment methods | UPI, card, and wallet are shown as simulation choices only |
| CHK-05 | P0 | Offer deterministic outcomes | Success, pending, failure, and cancel are available as explicit developer test actions |
| CHK-06 | P0 | Show resulting state | Checkout displays the result and a safe return action after simulation |
| CHK-07 | P0 | Support keyboard operation | Buttons, dialog, close action, and focus behavior are keyboard accessible |
| CHK-08 | P0 | Avoid deceptive branding | No official Razorpay logo, official payment-provider badge, or bank/UPI endorsement is displayed |
| CHK-09 | P0 | Prevent duplicate completion | Repeated clicks or duplicate API calls do not generate repeated logical state transitions |
| CHK-10 | P0 | Expire checkout session | Expired, already completed, unknown, or revoked checkout tokens return a clear non-sensitive error |
| CHK-11 | P0 | Avoid payable QR | Any QR-like visual is a non-scannable illustration marked “NOT PAYABLE”; no UPI URI or payment payload is generated |
| CHK-12 | P1 | Support configurable theme | Developer may set a small allowlisted color/theme configuration without external assets |
| CHK-13 | P0 | Secure parent/iframe messaging | Versioned schema, nonce, exact origins, exact source-window validation, no wildcard `postMessage`, and per-session `frame-ancestors` policy are enforced |
| CHK-14 | P0 | Prevent cross-origin API dependency | Checkout iframe performs PAYSIM API calls same-origin; the developer page never needs CORS permission to call PAYSIM payment APIs |
| CHK-15 | P0 | Protect checkout capability token | Token is placed only in URL fragment, exchanged through same-origin POST body, and never appears in query strings, referrers, logs, or browser storage |

## 7.7 UPI Simulation

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| UPI-01 | P0 | Provide mock UPI option | UPI is displayed as an illustrative method and labelled simulated |
| UPI-02 | P0 | Never invoke real UPI | No `upi://` intent, deep link, collect request, app switch, or live UPI transaction is created |
| UPI-03 | P0 | Do not collect UPI credentials | No VPA, PIN, OTP, bank login, or real payment identifier is required |
| UPI-04 | P0 | Simulate result locally | Selecting an outcome uses the same shared payment state machine as other mock methods |
| UPI-05 | P0 | Prevent QR misuse | QR graphic cannot encode a routable payment payload and has a visible “NOT PAYABLE” label |
| UPI-06 | P1 | Offer common UI branches | Show generic “app selection”, “pending”, and “retry” screens as educational states only |

## 7.8 Payment Lifecycle Events

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| EVT-01 | P0 | Emit event on accepted transition | Each accepted transition creates one immutable event snapshot |
| EVT-02 | P0 | Do not emit on rejected transition | Invalid transition or duplicate no-op creates no new logical event |
| EVT-03 | P0 | Give event stable ID | Event ID remains stable through retries and replay |
| EVT-04 | P0 | Store event snapshot | Event payload represents the entity at the time the event was created |
| EVT-05 | P0 | Mark simulated | Event includes `simulated: true` and `livemode: false` |
| EVT-06 | P0 | Keep event and delivery separate | Event exists independently of whether a webhook endpoint is configured or delivery succeeds |
| EVT-07 | P0 | Support event filtering | Event list filters by type, order ID, payment ID, and time range |
| EVT-08 | P1 | Allow custom event templates | Custom payload templates are deferred until after MVP |

## 7.9 Webhook Endpoint Management

Every endpoint is created with exactly one `mode`: `native` or `compatibility`. The UI must require an explicit selection; there is no ambiguous default. The selected mode is immutable within any already-created delivery snapshot. Changing mode increments `configVersion` and affects future events and Replay only.

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| WH-00 | P0 | Select endpoint mode | Endpoint creation requires an explicit `native` or `compatibility` wire mode; mode is snapshotted per delivery |
| WH-01 | P0 | Create endpoint | Label, literal loopback URL, at least one subscribed event type, and delivery mode (`native` or `compatibility`) are required |
| WH-02 | P0 | List endpoint | UI shows label, URL, enabled state, subscriptions, secret version, and last delivery summary |
| WH-03 | P0 | Edit endpoint | Label, URL, delivery mode, subscriptions, and safe custom headers may be edited; changes increment config version and affect only future deliveries and Replay |
| WH-04 | P0 | Enable/disable endpoint | Disabled endpoints receive no new deliveries; existing delivery history remains visible |
| WH-05 | P0 | Delete endpoint | Delete disables new deliveries and preserves historical event/delivery records for the current session |
| WH-06 | P0 | Generate unique secret | Each endpoint receives an independent cryptographically random secret |
| WH-07 | P0 | Show secret once | Secret is visible only at creation/rotation and not retrievable later from the UI |
| WH-08 | P0 | Rotate secret | Rotation creates a new current secret version and clearly explains effect on new deliveries, retries, and replay |
| WH-09 | P0 | Subscribe by event | Endpoint can subscribe to one or more supported event types |
| WH-10 | P0 | Validate target at save | Unsafe URL is rejected before endpoint creation or update |
| WH-11 | P0 | Revalidate target at send | Destination is revalidated immediately before each outbound connection |
| WH-12 | P0 | Limit endpoint count | At most 10 active or retained webhook endpoint configurations per session |
| WH-13 | P1 | Add per-endpoint statistics | Counts for success, failed, queued, and rejected deliveries |

## 7.10 Webhook Delivery Engine

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| DEL-01 | P0 | Deliver event as HTTP POST | Only POST is used; request body is the immutable event JSON bytes |
| DEL-02 | P0 | Sign exact raw bytes | HMAC-SHA256 is computed over the exact bytes sent, not a re-serialized object |
| DEL-03 | P0 | Include content metadata | Content-Type is `application/json`; user agent identifies PAYSIM and version |
| DEL-04 | P0 | Capture response | Record HTTP status, duration, bounded response preview, and outcome category |
| DEL-05 | P0 | Bound timeout | Default timeout 3 seconds; allowed configuration range 250 ms–10 seconds |
| DEL-06 | P0 | Disable redirects | 3xx is recorded as a redirect rejection; redirect target is never followed |
| DEL-07 | P0 | Apply bounded queue | Maximum 100 queued delivery jobs and maximum 5 concurrent outbound deliveries |
| DEL-08 | P0 | Apply backpressure | If queue is full, delivery is recorded as rejected with `DELIVERY_QUEUE_FULL`; payment state remains successful/unchanged |
| DEL-09 | P0 | Retry retryable failures | Initial request plus up to 2 automatic retries at 500 ms and 2 seconds, for a maximum of 3 attempts per delivery |
| DEL-10 | P0 | Classify retryability | Retry network connection errors, timeouts, 408, 425, 429, and 5xx; do not auto-retry other 4xx or 3xx |
| DEL-11 | P0 | Preserve attempt history | Every network attempt has its own ID, start/end time, status, and result |
| DEL-12 | P0 | Keep webhook failure separate | Delivery failure never changes payment or order state |
| DEL-13 | P0 | Support manual retry | Only eligible `failed` or `exhausted` deliveries may be manually retried if their endpoint configuration and signing secret version remain available; `rejected` deliveries require correction and Replay |
| DEL-14 | P0 | Support replay | Existing event can be sent as a new delivery to selected enabled endpoints |
| DEL-15 | P0 | Limit response preview | Maximum captured response preview is 16 KB; full unbounded response is never retained |
| DEL-16 | P0 | Bound request payload | Each outbound event body must be at most 128 KB; oversized event delivery is rejected with a visible reason |
| DEL-17 | P0 | Limit custom headers | Up to 10 custom endpoint headers; values are length-limited and secrets are redacted |
| DEL-18 | P1 | Configure retry schedule | UI may expose bounded policy presets; unbounded or indefinite retries are never allowed |

## 7.11 Retry, Replay, and Delivery History

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| RPL-01 | P0 | Differentiate retry from replay | UI and API labels explain the different delivery semantics |
| RPL-02 | P0 | Retry same delivery | Eligible `failed` or `exhausted` delivery can be retried; Retry preserves event ID, exact body bytes, endpoint ID, mode, and original endpoint config/secret version |
| RPL-03 | P0 | Replay existing event | Replay preserves canonical event ID/type/timestamp, serializes for the selected endpoint's current mode, and creates a new delivery under current endpoint config/secret |
| RPL-04 | P0 | Keep immutable attempts | Earlier attempts remain visible and unchanged |
| RPL-05 | P0 | Require endpoint choice for replay | User selects one or more enabled endpoints; no implicit broadcast to unknown destinations |
| RPL-06 | P0 | Block impossible retry | If historical endpoint configuration or secret version is unavailable, UI explains and offers replay |
| RPL-09 | P0 | Bound manual retry | At most three manual retry operations per delivery; each creates one immediate attempt and no further automatic cycle |
| RPL-07 | P0 | Prevent payment duplication | Retry/replay never re-applies payment transitions or creates a new payment |
| RPL-08 | P1 | Compare attempts | Show side-by-side attempt response status, duration, and error category |

## 7.12 Event Inspector, Transactions, and Logs

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| LOG-01 | P0 | List events | Newest-first, paginated list with event type and related IDs |
| LOG-02 | P0 | Show event details | Event ID, type, timestamp, simulated flag, immutable payload, and related deliveries |
| LOG-03 | P0 | List payments | Filter by status, method, order ID, and time range |
| LOG-04 | P0 | Show payment details | Payment lifecycle, associated order, state history, and event history |
| LOG-05 | P0 | Show deliveries | Delivery grouped by event and endpoint, with attempts visible |
| LOG-06 | P0 | Search identifiers | Search by order ID, payment ID, event ID, endpoint ID, or delivery ID |
| LOG-07 | P0 | Redact sensitive values | Tokens, signatures where configured sensitive, secrets, authorization values, and cookies are masked |
| LOG-08 | P0 | Apply retention caps | Session history uses configured hard caps and evicts oldest completed records first |
| LOG-09 | P0 | Never evict active work | Active/queued attempts cannot be evicted while running; overflow is reported explicitly |
| LOG-10 | P1 | Export sanitized diagnostics | Export includes simulated records and redacts all secrets and custom authorization values |

## 7.13 API Playground and Documentation

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| API-01 | P0 | Provide endpoint catalogue | Native and Compatibility routes are listed separately with auth requirements |
| API-02 | P0 | Provide copyable cURL | Examples run against the current local host after values are replaced |
| API-03 | P0 | Show request/response | Playground displays status, elapsed time, headers, and formatted JSON response |
| API-04 | P0 | Explain errors | Each documented error code includes meaning and corrective action |
| API-05 | P0 | Provide Node/Express examples | Includes order creation, checkout integration, webhook raw body, and signature verification |
| API-06 | P0 | Explain compatibility boundaries | Every unsupported API and checkout option is listed explicitly |
| API-07 | P1 | Save request history | Recent requests retained in-memory with secrets redacted |
| API-08 | P1 | Generate integration snippets | Generate TypeScript/JavaScript code snippets using current configured local URLs |

## 7.14 Settings and Reset

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| SET-20 | P0 | Show server settings | Display host, port, version, runtime, and session-only storage state |
| SET-21 | P0 | Rotate API credentials | Rotation invalidates prior credentials immediately |
| SET-22 | P0 | Show data limits | Current in-memory record counts and configured caps are visible |
| SET-23 | P0 | Reset session data | Explicit confirmation clears orders, payments, events, deliveries, endpoint configurations, and generated API keys |
| SET-24 | P0 | Preserve safe preferences | Reset does not clear non-secret UI theme preferences |
| SET-25 | P0 | Warn before reset | User must type `RESET SESSION` or confirm in a second step |
| SET-26 | P1 | Export/import fixtures | Sanitized fixture export/import is deferred; it must never include secrets |

---

# 8. Payment and Order Domain Model

## 8.1 Core Entity Separation

PAYSIM MUST model these as separate concepts:

- **Order:** A request to collect a specific amount for a merchant application.
- **Payment Attempt:** One attempt to complete an order using a simulated method.
- **Checkout Session:** A short-lived capability that opens the local checkout UI for one payment attempt.
- **Event:** Immutable record of a domain state transition.
- **Webhook Delivery:** A request to send one event to one endpoint.
- **Delivery Attempt:** One HTTP network attempt for a delivery.

A webhook delivery state is never a payment state. A failed webhook does not mean the payment failed.

## 8.2 Order State Machine

Supported order states:

- `created`
- `attempted`
- `paid`

Transitions:

| Current state | Trigger | Next state | Notes |
|---|---|---|---|
| `created` | First payment attempt created | `attempted` | Order has been attempted but not paid |
| `attempted` | Any associated payment becomes captured | `paid` | Paid is terminal in MVP |
| `attempted` | Payment fails or is cancelled | `attempted` | A later sequential attempt may be created |
| `created` | No attempt | `created` | No change |
| `paid` | Any new attempt/capture request | Rejected | No reopening or double capture |

Order is not marked `paid` merely because checkout UI returned a success callback. It is marked paid only after the server-side simulator state machine records a captured payment.

## 8.3 Payment Attempt State Machine

Supported payment states:

- `created`
- `pending`
- `authorized`
- `captured`
- `failed`
- `cancelled`

Allowed transitions:

| Current | Allowed next | Meaning |
|---|---|---|
| `created` | `pending`, `authorized`, `failed`, `cancelled` | Initial simulator outcome |
| `pending` | `authorized`, `failed`, `cancelled` | Developer resolves a pending attempt |
| `authorized` | `captured`, `cancelled` | Capture or cancel/void the authorization |
| `captured` | None | Terminal success |
| `failed` | None | Terminal failure; create a new attempt on the order instead |
| `cancelled` | None | Terminal cancellation; create a new attempt on the order instead |

Any transition not listed above returns `409 INVALID_STATE_TRANSITION` and emits no event.

## 8.4 Core Simulation Outcomes and Event Ordering

A payment-attempt creation is one atomic domain command. It creates the payment attempt, changes the order from `created` to `attempted` when this is the first attempt, and appends `payment.created` exactly once. There is no separate `order.attempted` event in MVP; the `payment.created` event is the observable event for that order transition.

| Command/outcome | State transition | Events, in commit order | Result |
|---|---|---|---|
| Create attempt | Order `created → attempted` if first; Payment `∅ → created` | `payment.created` | Active attempt created |
| Success | Payment `created → authorized → captured`; Order `attempted → paid` | `payment.authorized`, `payment.captured`, `order.paid` | Order becomes paid |
| Pending | Payment `created → pending` | `payment.pending` | Attempt waits for explicit resolution |
| Resolve pending success | Payment `pending → authorized → captured`; Order `attempted → paid` | `payment.authorized`, `payment.captured`, `order.paid` | Order becomes paid |
| Resolve pending failure | Payment `pending → failed` | `payment.failed` | New sequential attempt may be created |
| Resolve pending cancellation | Payment `pending → cancelled` | `payment.cancelled` | New sequential attempt may be created |
| Direct failure | Payment `created → failed` | `payment.failed` | New sequential attempt may be created |
| User-selected cancellation | Payment `created → cancelled` | `payment.cancelled` | New sequential attempt may be created |
| Checkout capability expires | Payment remains `created`; only the session capability is invalidated | None | The same payment attempt may receive a reissued checkout session |

All state changes and their canonical event records are committed atomically by the domain service before webhook delivery is enqueued. Events are ordered by the state-transition commit sequence. Webhook delivery failure never rolls back a committed payment transition. Duplicate identical completion commands return the committed result and emit no duplicate event; conflicting commands return `409 INVALID_STATE_TRANSITION`.

`payment.created` is emitted when a payment attempt is created, not when checkout first opens. The order transition to `attempted` occurs in the same commit and is represented by the `payment.created` event; it does not emit an unlisted event.

## 8.5 Payment Attempt Rules

1. One order may have multiple attempts over time.
2. Only one non-terminal attempt may exist for an order at a time.
3. A new attempt may begin only after the previous attempt is `failed` or `cancelled`.
4. A `pending` or `authorized` attempt must be resolved before a new attempt can begin.
5. When an attempt is captured, its order becomes paid in the same atomic domain operation.
6. No further attempt may begin for a paid order.
7. Payment amount and currency always equal the order amount and currency.
8. Payment method is a simulator label only: `mock_upi`, `mock_card`, or `mock_wallet`.
9. Payment state changes are performed by one domain service using per-order serialization; routes and UI components cannot mutate status directly.
10. The state transition, canonical event append, and payment/order timestamps are committed as one synchronous in-process critical section. Webhook enqueue happens after commit.
11. A duplicate request for an already completed identical transition is idempotent and does not emit a second event; a conflicting outcome returns 409.
12. Checkout-session capability expiry never cancels a payment or emits an event. If the payment remains `created`, issue a new checkout session for the same payment ID; closing the UI alone also does not cancel it.
13. A simulator-generated checkout callback is informational only. Server-side payment state is authoritative.

## 8.6 Pending Resolution

A pending attempt can be resolved from the dashboard or API to:

- `authorized` followed by `captured` (success path),
- `failed`, or
- `cancelled`.

The UI must show pending duration and available actions. Pending payments do not automatically become successful or failed based on elapsed time in MVP.

## 8.7 Amount and Currency Rules

- Amount is a positive safe integer in the smallest unit.
- MVP currency is INR; one rupee equals 100 paise.
- A request for ₹1,299.00 uses `amount: 129900`.
- Floating-point amounts are rejected.
- No conversion, foreign-exchange, rounding, tax, or settlement calculation occurs.
- Amount is displayed using INR formatting in the UI, but stored and transmitted as integer paise.

---

# 9. Razorpay-Style Compatibility Adapter

## 9.1 Purpose

The Compatibility Adapter exists so developers can exercise a defined subset of familiar Razorpay-style backend and checkout integration patterns locally. It is an independent PAYSIM implementation and must always identify its credentials, responses, events, and outcomes as simulated.

## 9.2 Compatibility Contract: Supported in MVP

| Area | Supported subset | Important limitation |
|---|---|---|
| Orders | Create and fetch order | No complete provider Orders API parity |
| Authentication | HTTP Basic using PAYSIM key ID and secret | PAYSIM-issued keys only |
| Amount/currency | Integer amount in paise, INR | INR only |
| Checkout | PAYSIM-hosted local JS shim with familiar constructor/event pattern | Not the official provider checkout script |
| Checkout callback | Success/failure callback shape documented below | Synthetic values and PAYSIM secret only |
| Webhooks | Selected payment/order event names and compatible payload shape | PAYSIM signature and delivery behavior; not provider infrastructure |
| Signature helper | HMAC callback verification helper using PAYSIM key secret | Local test verification only |
| Error format | Documented compatibility-style error envelope | May differ from provider errors outside supported subset |

## 9.3 Compatibility Contract: Explicitly Unsupported in MVP

- Refund APIs.
- Payouts and transfers.
- Customers and saved payment methods.
- Subscriptions and recurring billing.
- Invoices, settlements, disputes, and reconciliation reports.
- Real payment authorization, capture, reversal, or refund.
- Real card, UPI, netbanking, wallet, and EMI operations.
- Android/iOS SDK behavior.
- Every option exposed by official checkout SDKs.
- Provider account configuration, dashboard settings, risk rules, and production signatures.
- Full drop-in compatibility with every official language SDK or its hardcoded network origin.

Unsupported routes must return a clear `501 COMPATIBILITY_FEATURE_NOT_SUPPORTED` response in the local adapter, not silently proxy to the internet.

## 9.4 Compatibility Base URL and Route Catalogue

Default base URL:

`http://127.0.0.1:8787/compat/razorpay`

| Method | Route | Contract | Classification |
|---|---|---|---|
| POST | `/v1/orders` | Create a compatibility-shaped mock order | Supported Orders subset |
| GET | `/v1/orders/:orderId` | Fetch a compatibility-shaped mock order | Supported Orders subset |
| POST | `/v1/orders/:orderId/checkout-sessions` | Atomically create one payment attempt and a bound PAYSIM checkout session | **PAYSIM-specific extension**, not a provider route |
| POST | `/v1/payments/:paymentId/checkout-sessions` | Reissue a session for an existing `created` attempt without creating another attempt | **PAYSIM-specific extension**, not a provider route |

The PAYSIM Node bridge package must accept an explicit `baseURL`, must never default to a provider URL, and must keep `key_secret` server-side. It must not send the compatibility secret to browser code.

### PAYSIM checkout-session extension

Request:

```http
POST /compat/razorpay/v1/orders/order_ps_example/checkout-sessions
Authorization: Basic <base64(PAYSIM_KEY_ID:PAYSIM_KEY_SECRET)>
Content-Type: application/json
Idempotency-Key: checkout-demo-001
```

```json
{
  "method": "mock_upi",
  "parent_origin": "http://127.0.0.1:3000"
}
```

`parent_origin` is required. It must be an exact loopback HTTP origin with an explicit port and no path, query, fragment, username, or password. The order must belong to the authenticating PAYSIM compatibility credential; ownership is enforced through the internal `ownerCredentialId` and is never returned in public DTOs. The created payment attempt snapshots the authenticated credential ID and version for callback-signature generation. PAYSIM creates one sequential payment attempt and one checkout session atomically. If an active attempt already exists, return `409 ACTIVE_PAYMENT_ATTEMPT_EXISTS`; do not create a second active attempt.

Response:

```json
{
  "id": "chk_ps_example",
  "entity": "checkout_session",
  "payment_id": "pay_ps_example",
  "checkout_url": "http://127.0.0.1:8787/checkout/chk_ps_example?parentOrigin=http%3A%2F%2F127.0.0.1%3A3000#<opaque-token>",
  "expires_at": 1793612100,
  "simulated": true,
  "livemode": false
}
```

The example URL and values are illustrative. The opaque token exists only in the URL fragment and is not included in logs or response snapshots. The checkout URL is passed by the server-side bridge to the developer's browser application as the `checkout_url` PAYSIM-specific constructor option. Repeated identical idempotent requests return the existing payment/session while the session is active; after expiry they return `410 CHECKOUT_SESSION_EXPIRED` with the existing payment ID and require the session-reissue route, never a duplicate payment attempt.

### Compatibility checkout-session reissue extension

`POST /compat/razorpay/v1/payments/:paymentId/checkout-sessions` uses the same HTTP Basic authentication and a **new** `Idempotency-Key`. Request body is `{ "parent_origin": "http://127.0.0.1:3000" }`. It verifies that the payment attempt belongs to the authenticating compatibility credential, that the payment is still `created`, and that no unexpired, unrevoked checkout session exists. Ownership failure returns `404 NOT_FOUND` so the route does not reveal another credential's resource IDs. It creates a new checkout session with a new token and nonce but the same payment ID. It does not create another attempt and does not emit `payment.created`. It returns the same response shape as the order-level checkout-session extension. Invalid ownership returns `404 NOT_FOUND` without revealing resource ownership; disallowed payment/session state returns `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`.

## 9.5 Compatibility Authentication

- PAYSIM generates a local `key_id` and `key_secret`.
- The pair is sent as HTTP Basic authentication.
- The server validates the key ID and a salted hash of the secret.
- The key ID must use an unmistakable PAYSIM test prefix, for example `ps_test_`.
- Never accept a real provider key as a credential for PAYSIM.
- Never forward the request to a provider.

## 9.6 Compatibility Create Order Request

`POST /compat/razorpay/v1/orders`

Example:

```http
POST /compat/razorpay/v1/orders
Authorization: Basic <base64(PAYSIM_KEY_ID:PAYSIM_KEY_SECRET)>
Content-Type: application/json
Idempotency-Key: demo-order-001
```

```json
{
  "amount": 129900,
  "currency": "INR",
  "receipt": "demo-order-001",
  "notes": {
    "source": "local-demo"
  }
}
```

Successful response:

```json
{
  "id": "order_ps_example",
  "entity": "order",
  "amount": 129900,
  "amount_paid": 0,
  "amount_due": 129900,
  "currency": "INR",
  "receipt": "demo-order-001",
  "status": "created",
  "attempts": 0,
  "created_at": 1793664000,
  "simulated": true,
  "livemode": false
}
```

IDs and timestamps above are illustrative. Runtime values must be generated by PAYSIM. Additional response fields may be added only if documented and backward compatible.

## 9.7 Compatibility Fetch Order

`GET /compat/razorpay/v1/orders/:orderId`

Returns the compatibility order shape, current order status, amount paid/due, attempt count, and a PAYSIM simulation marker.

## 9.8 Checkout Compatibility Script

Local script path:

`http://127.0.0.1:8787/compat/razorpay/checkout.js`

The script exposes a `window.Razorpay`-compatible constructor only when the developer explicitly loads this local PAYSIM script. The supported PAYSIM shim constructor requires `checkout_url`, which is a PAYSIM-specific extension; a normal provider checkout constructor without this local session URL is not claimed to work. The script header, source banner, and checkout UI must identify it as the **PAYSIM compatibility shim**, not an official provider asset.

### Supported constructor options

| Option | Support | Rule |
|---|---|---|
| `key` | P0 | Must be a PAYSIM compatibility key ID; it is a public identifier, not the secret |
| `order_id` | P0 | Must reference an order in this PAYSIM session |
| `checkout_url` | P0 — PAYSIM extension | Required local checkout URL returned by the server-side checkout-session bridge; must use the configured PAYSIM origin and a valid session capability |
| `paysim.strictOptions` | P1 — PAYSIM extension | Optional boolean; when `true`, unknown or unsupported options fail with `PAYSIM_UNSUPPORTED_OPTION` |
| `amount` | P0 | Must match the order amount |
| `currency` | P0 | Must be `INR` and match the order |
| `name` | P0 | Display-only merchant label, length-limited |
| `description` | P0 | Display-only text, length-limited |
| `handler` | P0 | Invoked after simulated success with synthetic callback response |
| `modal.ondismiss` | P0 | Invoked when developer closes the modal before completion |
| `theme.color` | P1 | Validated color value only |
| `prefill.name` | P1 | Synthetic display-only text; never used to authenticate or charge |
| `prefill.email` | Unsupported | Not accepted in MVP; prevents accidental collection of personal data |
| `prefill.contact` | Unsupported | Not accepted in MVP; prevents accidental collection of personal data |
| `notes` | P1 | Bounded JSON object; same metadata restrictions as Native API |

Unknown options are ignored by default and produce one `console.warn` per unknown option name in development. In production mode, they are ignored without logging. The PAYSIM-specific `paysim.strictOptions: true` flag makes any unknown or explicitly unsupported option fail before the checkout iframe is created, using `PAYSIM_UNSUPPORTED_OPTION`. Known options with invalid values always fail validation; they are never silently coerced.

### Supported methods/events

- Constructor: `new Razorpay(options)`
- `open()` opens the local PAYSIM checkout modal.
- `close()` closes an open modal.
- `on("payment.failed", handler)` registers a failure callback.
- `off("payment.failed", handler)` removes a registered callback.
- `once("payment.failed", handler)` registers a one-time callback.

No other method or event is implied to be compatible unless it is added to the compatibility matrix.

## 9.9 Compatibility Callback Response

On simulated success, the callback receives a documented synthetic response:

```json
{
  "razorpay_payment_id": "pay_ps_example",
  "razorpay_order_id": "order_ps_example",
  "razorpay_signature": "<synthetic-hmac-hex>",
  "simulated": true,
  "livemode": false
}
```

The familiar field names are present to allow local code-path testing. The values and signature are synthetic PAYSIM test values, not provider-issued values. PAYSIM must display this distinction in its UI and documentation.

For this compatibility subset, the synthetic checkout signature is:

`HMAC-SHA256(PAYSIM_COMPAT_KEY_SECRET, order_id + "|" + payment_id)`

The PAYSIM bridge verification helper must compare the signature in constant time. It must not accept production credentials, and it must make the simulator-only nature explicit in its API naming and documentation.

## 9.10 Compatibility Payment Failure Payload

The `payment.failed` event callback receives a synthetic object containing:

- `error.code`
- `error.description`
- `error.source` (always `paysim_simulator`)
- `error.step` (always `simulation`)
- `error.reason` (controlled enum)
- `payment.entity` with PAYSIM payment ID, order ID, amount, currency, status, and `simulated: true`

No actual issuer response, bank decline code, card network response, or UPI failure reason is fabricated.

## 9.11 Compatibility Webhook Events

MVP compatibility event names:

- `payment.created`
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `payment.cancelled` (PAYSIM extension)
- `payment.pending` (PAYSIM extension)
- `order.paid`

The payload shape follows a documented, familiar event envelope with `entity`, `event`, `contains`, `payload`, and `created_at` fields. Every payload includes a PAYSIM simulation marker in the event and relevant entity. Event payload examples are maintained as fixtures and tested for stable schema.

Compatibility delivery uses the header names required by common Razorpay-style receiver code, including `X-Razorpay-Signature` and `x-razorpay-event-id`, but the event ID and signature are generated by PAYSIM using the endpoint's PAYSIM test secret. This is a local compatibility behavior only. The dashboard and docs must warn that these headers do not prove a real provider sent the event.

## 9.12 Compatibility Conformance Tests

The MVP compatibility pack must test:

1. Basic authentication succeeds with a PAYSIM key pair.
2. Wrong secret is rejected.
3. Order create accepts valid INR integer amount.
4. Invalid amount, currency, receipt, and metadata are rejected.
5. Repeated idempotent create request returns the same order.
6. Fetch order returns the expected response fields.
7. The PAYSIM-specific order-level checkout-session extension creates one payment attempt/session and enforces credential ownership.
8. The PAYSIM-specific payment-level checkout-session reissue extension returns a new session for the same `created` payment ID without creating a second payment attempt or `payment.created` event.
7. Checkout shim opens only for a valid PAYSIM order/key.
8. Success invokes handler with expected synthetic callback fields.
9. Failure triggers the documented failure event.
10. Modal dismiss invokes the dismiss callback and does not mark payment paid.
11. Callback signature verifies with PAYSIM helper and fails with a wrong secret or altered value.
12. Compatibility webhook payload and signature match fixture expectations.
13. Unsupported routes do not proxy to external services.
14. Every response includes simulator markers where defined.

---

# 10. Native API Contract

## 10.1 Base URL and Versioning

Default base URL:

`http://127.0.0.1:8787/api/v1`

Only `/api/v1` is part of MVP. Breaking changes require a new major API path. Additive optional fields may be released within v1 when documented.

## 10.2 Authentication

Protected routes require:

`Authorization: Bearer <PAYSIM_TEST_TOKEN>`

The token is local-only and generated by PAYSIM. Health endpoint is public on loopback and must reveal no secrets or full environment variables.

## 10.3 Native API Route Catalogue

| Method | Route | Purpose | Priority |
|---|---|---|---|
| GET | `/health` | Health, version, simulation state | P0 |
| GET | `/orders` | Paginated order list | P0 |
| POST | `/orders` | Create order | P0 |
| GET | `/orders/:orderId` | Retrieve order | P0 |
| POST | `/orders/:orderId/payment-attempts` | Start a payment attempt and create checkout session | P0 |
| POST | `/payments/:paymentId/checkout-sessions` | Reissue checkout session for an existing created attempt after prior session expiry | P0 |
| GET | `/payments` | Paginated payment list | P0 |
| GET | `/payments/:paymentId` | Retrieve payment | P0 |
| POST | `/payments/:paymentId/simulate` | Apply one allowed simulator outcome | P0 |
| POST | `/payments/:paymentId/resolve` | Resolve an existing pending/authorized attempt | P0 |
| GET | `/events` | Paginated event list | P0 |
| GET | `/events/:eventId` | Retrieve immutable event | P0 |
| GET | `/deliveries` | Paginated delivery list | P0 |
| GET | `/deliveries/:deliveryId` | Retrieve delivery and attempts | P0 |
| POST | `/deliveries/:deliveryId/retry` | Manually retry an eligible `failed` or `exhausted` delivery using its original snapshot | P0 |
| POST | `/events/:eventId/replay` | Replay event to selected endpoint IDs | P0 |

Webhook endpoint configuration is managed through the authenticated Control API, not through a developer payment key.

## 10.4 Control API Route Catalogue

Base URL:

`http://127.0.0.1:8787/control/v1`

All Control routes except `POST /session/exchange` require a valid dashboard session cookie. Mutating routes additionally require a valid CSRF token. `POST /session/exchange` requires a one-time control token in its JSON body plus exact loopback Host/Origin validation and login rate limiting; it never accepts the token in a URL or header.

| Method | Route | Purpose | Priority |
|---|---|---|---|
| POST | `/session/exchange` | Exchange one-time terminal control token for dashboard session cookie and CSRF token; Origin/Host protected | P0 |
| GET | `/session` | Current dashboard session and fresh CSRF token | P0 |
| POST | `/session/logout` | End session | P0 |
| GET | `/credentials` | List key metadata; never return full secrets | P0 |
| POST | `/credentials/native` | Generate Native API token | P0 |
| POST | `/credentials/compatibility` | Generate compatibility key pair | P0 |
| POST | `/credentials/:credentialId/rotate` | Rotate credential | P0 |
| GET | `/webhook-endpoints` | List endpoints | P0 |
| POST | `/webhook-endpoints` | Create endpoint | P0 |
| GET | `/webhook-endpoints/:endpointId` | Retrieve endpoint metadata | P0 |
| PATCH | `/webhook-endpoints/:endpointId` | Update label, URL, delivery mode, subscriptions, custom headers | P0 |
| POST | `/webhook-endpoints/:endpointId/enable` | Enable endpoint | P0 |
| POST | `/webhook-endpoints/:endpointId/disable` | Disable endpoint | P0 |
| POST | `/webhook-endpoints/:endpointId/rotate-secret` | Rotate endpoint secret | P0 |
| DELETE | `/webhook-endpoints/:endpointId` | Disable/delete configuration while preserving history | P0 |
| POST | `/session/reset` | Reset session data after explicit confirmation | P0 |
| GET | `/settings/limits` | Read active record/queue limits | P0 |

### Initial dashboard session exchange contract

`POST /control/v1/session/exchange` is the only unauthenticated Control API route. It is still restricted to a same-origin loopback dashboard request and rate-limited. Request body:

```json
{ "controlToken": "<one-time-terminal-token>" }
```

On success, the response is `200` with `Cache-Control: no-store`, a session summary, and a CSRF token. The server sets an HttpOnly, SameSite=Strict cookie scoped to `/control/v1`; `Secure` is set only when the local server is itself using HTTPS. The control token is consumed atomically and cannot be used again. The token must not appear in URL, headers, access logs, analytics, or error messages. On failure, return `401 CONTROL_TOKEN_INVALID` without revealing whether the token was unknown, expired, or already consumed. Rate-limit failures with `429 RATE_LIMITED` and `Retry-After`.

Example success response:

```json
{
  "data": {
    "authenticated": true,
    "csrfToken": "<ephemeral-csrf-token>",
    "idleExpiresAt": "2026-11-03T02:00:00.000Z",
    "absoluteExpiresAt": "2026-11-03T09:30:00.000Z"
  }
}
```

The CSRF token is returned only to the same-origin dashboard and stays in application memory. It must never be written to localStorage, sessionStorage, IndexedDB, or a URL. `GET /session` may return a replacement CSRF token for a valid session. Logout and reset revoke the session and invalidate the CSRF token.

## 10.5 Pagination and Filtering

All list endpoints support:

- `limit`: integer from 1 to 100; default 25.
- `cursor`: opaque cursor returned by the prior response.
- `sort`: only supported documented sort values; default newest first.
- Resource-specific filters such as `status`, `type`, `orderId`, `paymentId`, `endpointId`, and `createdAfter`/`createdBefore`.

Response shape:

```json
{
  "simulated": true,
  "data": [],
  "page": {
    "limit": 25,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Cursor values are opaque and must not expose internal map keys or secrets.

## 10.6 Idempotency Contract

Required on:

- `POST /orders`
- `POST /orders/:orderId/payment-attempts`
- `POST /payments/:paymentId/checkout-sessions`
- Compatibility `POST /v1/orders`
- Compatibility `POST /v1/orders/:orderId/checkout-sessions`
- Compatibility `POST /v1/payments/:paymentId/checkout-sessions`

Header:

`Idempotency-Key: <developer-generated-unique-value>`

Rules:

1. Key length: 8–128 printable ASCII characters.
2. Scope: credential ID + route + active PAYSIM session.
3. Same key and same canonical request body returns the original resource and original logical result.
4. Same key and different canonical request body returns `409 IDEMPOTENCY_KEY_REUSED`.
5. Keys are retained in memory for up to 24 hours or until session reset/server stop, whichever occurs first.
6. Maximum 5,000 idempotency entries per session; overflow is a visible `429 IDEMPOTENCY_STORE_FULL` response and never silently forgets a live entry.
7. Idempotency prevents duplicate resource creation. It does not replace payment state validation or webhook event deduplication.
8. An idempotency response snapshot must never contain a raw checkout token or full checkout URL. For payment-attempt or checkout-session creation, the record stores the payment ID, checkout-session ID, and token-free result metadata; the raw token is held only in the token vault while it remains unconsumed and unexpired.
9. Repeating the same payment-attempt or checkout-session creation key while its capability is still unconsumed and valid returns the same logical result and reconstructs the same checkout URL from the token vault. If that capability has already been consumed, return `409 CHECKOUT_SESSION_ALREADY_CONSUMED` with the existing payment/session IDs; do not mint or reveal another token under the same idempotency key. The browser's existing iframe session remains authorized through its HttpOnly cookie.
10. If the same payment-attempt or checkout-session creation key is repeated after its checkout session has expired or been revoked, return `410 CHECKOUT_SESSION_EXPIRED` with the existing payment ID; use a new idempotency key on the appropriate session-reissue route to create a new session without creating another payment attempt.
11. A checkout-session reissue request uses a new `Idempotency-Key`. A repeated request with that new key returns the same new session while its capability is valid and unconsumed; after consumption, it returns `409 CHECKOUT_SESSION_ALREADY_CONSUMED`; after expiry/revocation, it returns `410 CHECKOUT_SESSION_EXPIRED`.
12. Idempotency-protected resources must not be evicted while their idempotency entry remains unexpired. Expired checkout-session metadata must be retained as a token-free tombstone until linked idempotency records expire. If safe retention cannot be maintained, reject new work rather than evicting a referenced resource.

For payment resolution, the same desired terminal result repeated after completion returns the existing payment state without emitting a second event. A conflicting result returns 409.

## 10.7 Create Order Request — Native API

```http
POST /api/v1/orders
Authorization: Bearer ps_test_example
Content-Type: application/json
Idempotency-Key: order-demo-001
```

```json
{
  "amount": 129900,
  "currency": "INR",
  "receipt": "demo-order-001",
  "description": "Synthetic demo order",
  "metadata": {
    "source": "local-demo"
  }
}
```

Response:

```json
{
  "simulated": true,
  "livemode": false,
  "data": {
    "id": "ord_ps_example",
    "amount": 129900,
    "currency": "INR",
    "status": "created",
    "receipt": "demo-order-001",
    "description": "Synthetic demo order",
    "metadata": {
      "source": "local-demo"
    },
    "createdAt": "2026-11-03T00:00:00.000Z",
    "updatedAt": "2026-11-03T00:00:00.000Z"
  }
}
```

All IDs and timestamps above are examples only.

## 10.8 Create Payment Attempt Request

```http
POST /api/v1/orders/ord_ps_example/payment-attempts
Authorization: Bearer ps_test_example
Content-Type: application/json
Idempotency-Key: attempt-demo-001
```

```json
{
  "method": "mock_upi",
  "parentOrigin": "http://127.0.0.1:3000"
}
```

`parentOrigin` is required for the MVP browser checkout and must be an exact loopback HTTP origin with an explicit port and no path, query, fragment, username, or password. PAYSIM binds it to the checkout session and uses it for the iframe's `frame-ancestors` policy and parent/iframe message checks. It is not a webhook destination. The response includes `payment`, `checkoutUrl`, `checkoutSessionId`, `expiresAt`, `simulated: true`, and `livemode: false`. The checkout URL stores its opaque one-time capability only in the URL fragment.

To reissue a checkout session for the same `created` payment attempt after capability expiry or revocation, call `POST /api/v1/payments/:paymentId/checkout-sessions` with a **new** `Idempotency-Key`, the same `method`, and a currently valid `parentOrigin`. This route creates a new checkout session only; it does not create another payment attempt or emit `payment.created`. It returns `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` if the payment is not `created` or another unexpired, unrevoked session is active. The Compatibility Adapter exposes the matching PAYSIM-specific reissue route under `/compat/razorpay/v1/payments/:paymentId/checkout-sessions`; it additionally enforces credential ownership.

## 10.9 Simulate Payment Request

```http
POST /api/v1/payments/pay_ps_example/simulate
Authorization: Bearer ps_test_example
Content-Type: application/json
```

```json
{
  "outcome": "success"
}
```

Allowed outcomes: `success`, `pending`, `failed`, `cancelled`.

## 10.10 Resolve Pending Payment

```http
POST /api/v1/payments/pay_ps_example/resolve
Authorization: Bearer ps_test_example
Content-Type: application/json
```

```json
{
  "outcome": "success"
}
```

This endpoint is accepted only for a payment in `pending` or `authorized` state, with a transition allowed by Section 8.3.

## 10.11 Standard Error Envelope

```json
{
  "simulated": true,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "amount must be a positive safe integer in paise",
    "requestId": "req_ps_example",
    "details": [
      {
        "field": "amount",
        "issue": "Expected a positive safe integer"
      }
    ]
  }
}
```

Errors must never contain stack traces, source file paths, secrets, environment values, raw authorization headers, or internal network configuration.

## 10.12 HTTP Status Codes

| Status | Use |
|---:|---|
| 200 | Successful read or idempotent repeat |
| 201 | New resource created |
| 400 | Malformed JSON or malformed request syntax |
| 401 | Missing or invalid API credential |
| 403 | Authenticated caller lacks permission or request origin/CSRF check failed |
| 404 | Resource not found in current session |
| 409 | Invalid state transition, idempotency conflict, already paid, active attempt conflict, or consumed checkout capability |
| 410 | Checkout capability expired or revoked; payment state is unchanged |
| 413 | Request body too large |
| 415 | Unsupported content type |
| 422 | Valid JSON but invalid field values or unsupported currency/method |
| 429 | Rate/queue/resource limit exceeded |
| 500 | Unexpected internal error with generic message and request ID |
| 501 | Compatibility route outside documented supported subset |

---

# 11. Webhook Contract and Delivery Semantics

## 11.1 Supported Native Event Types

- `payment.created`
- `payment.pending`
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `payment.cancelled`
- `order.paid`

The event list is a PAYSIM contract. It is not a statement that all event types or payloads match a real provider.

## 11.2 Native Event Envelope

```json
{
  "createdAt": "2026-11-03T00:00:00.000Z",
  "data": {
    "object": {
      "amount": 129900,
      "currency": "INR",
      "id": "pay_ps_example",
      "method": "mock_upi",
      "orderId": "ord_ps_example",
      "simulated": true,
      "status": "captured"
    }
  },
  "id": "evt_ps_example",
  "livemode": false,
  "simulated": true,
  "type": "payment.captured"
}
```

The canonical event is stored mode-neutral and is not assigned webhook wire bytes at event creation. When a delivery is created, the endpoint's snapshotted mode selects a deterministic serializer. Serialization accepts only plain JSON values (null, booleans, strings, finite numbers, arrays, and plain objects); it rejects cycles, `undefined`, functions, symbols, BigInt, non-finite numbers, Date instances, and non-plain objects. Object keys are recursively sorted by JavaScript UTF-16 code-unit order (`Array.prototype.sort()` default comparator), array order is unchanged, and `JSON.stringify` output is encoded as UTF-8 with no insignificant whitespace or trailing newline. The exact resulting bytes, SHA-256 digest, mode, endpoint configuration snapshot, and secret version are stored in the delivery-body vault. Retry uses the exact byte snapshot for that delivery. Replay creates a new delivery and serializes the unchanged canonical event using the selected endpoint's current mode; therefore its body may differ when the selected mode differs. Neither operation mutates the canonical event's original timestamp or payload.

## 11.3 Native Signature Contract

Header:

`X-PaySim-Signature: sha256=<lowercase-hex-digest>`

Digest:

`HMAC-SHA256(endpointSecret, exactRawRequestBodyBytes)`

The receiving example must capture raw request bytes before JSON parsing. Signature comparison must use constant-time comparison after validating the expected digest length and encoding.

This is a PAYSIM-specific format. It must not be documented as a provider signature format.

## 11.4 Compatibility Webhook Contract

Each webhook endpoint has exactly one configured delivery mode at a time: `native` or `compatibility`. The mode is part of the endpoint configuration and is snapshotted into each delivery. A later endpoint mode change affects only new deliveries and Replay; it never rewrites queued/in-progress/retained deliveries.

The canonical domain event is mode-neutral. At delivery creation, the serializer selected by the endpoint's snapshotted mode generates a deterministic JSON body:

- `native`: the exact Native envelope in Section 11.2.
- `compatibility`: the exact compatibility envelope defined by fixtures in `fixtures/events-compat/*.json`, with `entity`, `event`, `contains`, `payload`, `created_at`, `simulated: true`, and `livemode: false`.

Compatibility timestamps use Unix seconds for `created_at`; the native envelope uses ISO-8601 `createdAt`. The compatibility semantic fixture at `fixtures/events-compat/payment.captured.json` and native semantic fixture at `fixtures/events-native/payment.captured.json` are normative; their exact byte counterparts are `payment.captured.body.json` in the same folders. Compatibility signature is `HMAC-SHA256(endpointSecret, exactSerializedCompatibilityBodyBytes)` encoded as lowercase hexadecimal without a prefix in `X-Razorpay-Signature`. `X-Razorpay-Event-Id` contains the PAYSIM event ID. Native mode uses `X-PaySim-Signature: sha256=<lowercase-hex>` and `X-PaySim-Event-Id`. Signature verification always uses the exact received raw bytes, before JSON parsing.

These compatibility headers and payloads are synthetic PAYSIM contracts. Their familiar names do not establish that a real provider originated the event. The compatibility fixture set is authoritative; prose examples must match fixtures byte-for-byte after deterministic serialization.

Compatibility fixture example (`fixtures/events-compat/payment.captured.json`):

```json
{
  "contains": ["payment"],
  "created_at": 1793664000,
  "entity": "event",
  "event": "payment.captured",
  "id": "evt_ps_fixture_001",
  "livemode": false,
  "payload": {
    "payment": {
      "entity": {
        "amount": 129900,
        "captured": true,
        "currency": "INR",
        "id": "pay_ps_fixture_001",
        "order_id": "order_ps_fixture_001",
        "simulated": true,
        "status": "captured"
      }
    }
  },
  "simulated": true
}
```

The compatibility serializer emits object keys in recursive JavaScript UTF-16 code-unit order and array elements in their original order. The readable `.json` fixtures are semantic reference objects; matching `.body.json` fixtures contain the exact compact UTF-8 serializer bytes (no indentation and no trailing newline) used by byte-level signature tests. Fixture timestamps and IDs are fixed test data only, not runtime constants.

## 11.5 Endpoint Subscription Rules

- An endpoint must subscribe to at least one supported event type.
- Default selection in the UI is none; user must explicitly choose event types.
- One event can match zero, one, or multiple endpoints.
- One delivery record is created for each matching enabled endpoint.
- Disabled endpoints receive no new deliveries.
- Endpoint updates apply only to deliveries created after the update, except explicit Replay.

## 11.6 Delivery and Attempt Model

**Webhook Delivery** represents one event-to-endpoint send using one snapshotted wire format and endpoint configuration. It has one or more **Delivery Attempts**.

Delivery statuses:

- `queued`
- `delivering`
- `succeeded`
- `failed` — a completed non-retryable delivery result
- `exhausted` — retryable automatic attempts reached the configured maximum
- `rejected` — no HTTP attempt was made because the queue, target, or payload was rejected
- `interrupted` — graceful shutdown aborted an in-flight attempt before a final receiver result was known

Attempt outcomes:

- `succeeded`
- `http_error`
- `timed_out`
- `connection_failed`
- `redirect_rejected`
- `target_rejected`
- `response_too_large` — receiver response exceeded the configured read cap
- `interrupted_unknown` — process shutdown aborted the request and delivery result is unknown

A delivery rejected before network I/O has no Delivery Attempt; it carries a delivery-level `rejectionCode` and explanatory message. In particular, an oversized serialized event is rejected before send with `DELIVERY_PAYLOAD_TOO_LARGE`; it is not a receiver-response outcome.

## 11.7 HTTP Result Classification

| Receiver result | Attempt outcome | Automatic retry? | Delivery result |
|---|---|---|---|
| 200–299 | `succeeded` | No | `succeeded` |
| 408, 425, 429 | `http_error` | Yes | Retry, then `exhausted` if budget ends |
| 500–599 | `http_error` | Yes | Retry, then `exhausted` if budget ends |
| Other 400–499 | `http_error` | No | `failed` |
| 300–399 | `redirect_rejected` | No | `failed` |
| Connection refused/reset | `connection_failed` | Yes | Retry, then `exhausted` if budget ends |
| Timeout | `timed_out` | Yes | Retry, then `exhausted` if budget ends |
| Destination becomes unsafe | `target_rejected` | No | `rejected` if before connect; otherwise `failed` |
| Receiver response exceeds 64 KB read cap | `response_too_large` | No | `failed` |
| Serialized event exceeds 128 KB before send | No attempt created | No | `rejected` with `DELIVERY_PAYLOAD_TOO_LARGE` |

A 2xx response is success regardless of response JSON. PAYSIM does not infer payment state from receiver response content. Redirects are never followed.

## 11.8 Automatic Retry Policy

MVP uses a fixed bounded policy:

- Attempt 1: immediately.
- Attempt 2: after 500 ms for retryable result.
- Attempt 3: after 2 seconds after attempt 2 for retryable result.
- Maximum automatic attempts: 3 total per delivery.
- No infinite retries and no multi-hour background retry loop.
- After automatic attempts are exhausted, delivery status is `exhausted`.
- User may manually Retry an eligible exhausted delivery.

## 11.9 Retry Semantics

Manual Retry operates on the same delivery record:

- Retains the same event ID, mode, exact serialized request-body bytes, body digest, endpoint ID, endpoint URL/configuration snapshot, custom-header snapshot, and secret version.
- Creates a new immutable attempt ID and increments the delivery attempt sequence.
- The original endpoint/secret version must still exist in the in-memory vault. If not, retry is rejected with `DELIVERY_SNAPSHOT_UNAVAILABLE`; user may Replay instead.
- At most three manual retry operations are allowed per delivery after the initial automatic attempt cycle. Each manual retry creates one immediate attempt and does not start a further automatic retry cycle.
- Retry never creates a new event, payment, or order and never re-applies a payment transition.

## 11.10 Replay Semantics

Replay creates a new delivery record for an existing canonical event:

- The event ID, event type, canonical domain snapshot, and original event timestamp remain unchanged.
- The user must choose one or more currently enabled endpoints.
- Each new delivery snapshots the selected endpoint's current URL, mode, subscriptions, custom headers, config version, and current secret version.
- The canonical event is serialized anew using the selected endpoint's current mode. Therefore, Replay to an endpoint with a different mode may have a different JSON envelope and byte sequence while preserving the same canonical event identity.
- Within the same mode and serializer version, deterministic serialization produces the same body bytes for an unchanged canonical event.
- Replay has a new delivery ID, delivery creation time, attempt IDs, and independent bounded retry budget.
- Replay never updates the original event, payment, or order.

## 11.11 Delivery Queue and Concurrency

- Maximum queued jobs: 100.
- Maximum concurrent outbound requests: 5.
- Default concurrent requests: 3.
- When queue is full, create a visible rejected delivery with `DELIVERY_QUEUE_FULL`; do not block or roll back the payment event.
- A queue overflow must never crash PAYSIM.
- On graceful SIGINT/SIGTERM, the sender stops accepting new jobs, aborts in-flight requests, marks in-memory attempts `interrupted_unknown` and deliveries `interrupted`, and prints a redacted shutdown summary. Because storage is session-only, those records are cleared when the process exits; PAYSIM must not claim that interrupted requests were delivered. No automatic retry occurs during shutdown.

---

# 12. Webhook Destination Security

## 12.1 Allowed URL Format

Only the following are accepted in MVP:

- `http://127.0.0.1:<explicit-port>/<path>`
- `http://[::1]:<explicit-port>/<path>`

The URL must:

- Use the `http` scheme only.
- Use a literal canonical loopback IP, not a DNS hostname.
- Include an explicit port from 1 to 65535.
- Include a path; `/` is valid.
- Exclude username/password, query string, and fragment.
- Exclude non-canonical IP encodings, IPv4-mapped IPv6, zone identifiers, and alternative numeric host forms.
- Not target PAYSIM's own web/API port or its Vite development port.

`localhost`, `.local`, arbitrary hostnames, private LAN IPs, link-local IPs, public IPs, multicast, unspecified, broadcast, and reserved ranges are rejected.

## 12.2 Validation at Two Points

1. Validate when the endpoint is created or updated.
2. Validate immediately before each network connection.

The sender must connect directly to the approved literal IP with proxy environment variables ignored. It must not perform DNS resolution. The actual connected remote address must match the approved loopback address.

## 12.3 Request Restrictions

- Outbound method is always POST.
- Redirects are never followed.
- Only HTTP is allowed because delivery is loopback-only; no TLS setup is required for the MVP local receiver.
- The HTTP client must not use ambient `HTTP_PROXY`, `HTTPS_PROXY`, or similar proxy settings.
- Request and response timeouts are mandatory.
- Maximum body size is enforced.
- Request headers are generated by PAYSIM plus a small safe user-configured header allowlist.
- `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Proxy-*`, and other hop-by-hop headers cannot be overridden.
- Custom Authorization headers may be used only as explicit local endpoint configuration, are stored in memory, are displayed masked, and are never written to logs or exports.
- PAYSIM must reject attempts to target its own API/control listener to avoid delivery loops.

## 12.4 Docker and WSL Compatibility

PAYSIM runs on the host and sends to a host loopback port. To receive events in Docker, the developer must publish the container port to a host loopback port, for example `127.0.0.1:<host-port>:<container-port>`. The PAYSIM target is then the host's `127.0.0.1:<host-port>` endpoint.

For WSL, use a service port that is reachable through the host's loopback forwarding and verify it locally before registration. PAYSIM does not accept arbitrary private WSL/Docker bridge IPs in MVP. The docs must explain this limitation instead of advising users to open the machine to the LAN.

## 12.5 Local Browser Protections

- API and control server bind to loopback only.
- CORS allows only the exact PAYSIM UI origin. The PAYSIM-hosted checkout iframe uses same-origin API calls; the developer parent origin is not added to the API CORS allowlist.
- Host header is validated against the configured local host and port.
- Control routes require a dashboard session, CSRF token, and valid Origin, except the one-time session exchange route which has the separate protection defined in Section 5.10.
- Cookies are HttpOnly and SameSite=Strict; `Secure` is set only when the local origin is HTTPS. No wildcard CORS is allowed.
- No state-changing GET routes exist.
- Control token is never placed in a URL.

## 12.6 Checkout Iframe and Message Protocol

The PAYSIM checkout iframe is a separate PAYSIM origin surface. The browser application must pass `checkout_url` to the shim, so page JavaScript can technically inspect the URL fragment capability while it is in use; PAYSIM does not claim this token is hidden from the parent page. The capability is narrowly scoped to one payment/session, bound to the exact parent origin, short-lived, and exchanged once. After exchange, the iframe uses an HttpOnly checkout-session cookie. The shim never sends the capability token or endpoint signing secret in callback objects or `postMessage` payloads, and it never writes the token to browser storage or logs. Developers must treat all scripts running on their local parent page as part of the same trust boundary.

Protocol requirements:

1. `window.Razorpay` shim creates the iframe using the PAYSIM origin and an exact fragment-bearing checkout capability URL.
2. The iframe's server-generated CSP `frame-ancestors` allows only the validated loopback parent origin supplied for that checkout session. That policy is not wildcarded.
3. Parent and iframe exchange a versioned `paysim.checkout.hello` / `paysim.checkout.ready` handshake with a cryptographically random per-session nonce.
4. Both sides validate `event.origin`, `event.source`, message type, schema version, nonce, and checkout session binding.
5. All `postMessage` calls use a concrete `targetOrigin`; `*` is forbidden.
6. The iframe sends only allowlisted synthetic callback data. It never sends the opaque checkout token, API credentials, webhook secret, or raw vault references to the parent.
7. The iframe performs API calls same-origin. No CORS exception is granted to arbitrary developer origins.
8. The checkout route sets `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and a restrictive CSP. Third-party scripts, fonts, analytics, images, and network requests are prohibited.
9. Unknown, stale, replayed, or nonce-mismatched messages are ignored and recorded as a redacted local diagnostic; they do not change payment state.

# 13. Data Models and Type Contracts

The following are logical TypeScript domain contracts. Implementations may add internal fields but must not remove required semantics or leak secret material.

## 13.1 Order

```ts
export type OrderStatus = "created" | "attempted" | "paid";

export interface MockOrder {
  id: string;
  ownerCredentialId: string; // internal credential ownership; never included in API DTOs
  amount: number; // positive safe integer in paise
  currency: "INR";
  status: OrderStatus;
  receipt?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  paymentAttemptIds: string[];
  simulated: true;
  livemode: false;
  createdAt: string;
  updatedAt: string;
}
```

## 13.2 Payment Attempt

```ts
export type PaymentStatus =
  | "created"
  | "pending"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled";

export type MockPaymentMethod = "mock_upi" | "mock_card" | "mock_wallet";

export interface MockPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: "INR";
  status: PaymentStatus;
  method: MockPaymentMethod;
  attemptNumber: number;
  compatibilityCredentialId?: string; // internal only; set for compatibility-created attempts
  compatibilityCredentialVersion?: number; // pins callback HMAC to the creating key version
  failureReason?: "user_selected_failure" | "simulated_timeout" | "simulated_decline";
  simulated: true;
  livemode: false;
  createdAt: string;
  updatedAt: string;
}
```

`failureReason` is a controlled simulator enum. PAYSIM must not fabricate real bank, issuer, card-network, or UPI failure codes.

## 13.3 Checkout Session

```ts
export interface CheckoutSession {
  id: string;
  paymentId: string;
  credentialId: string;
  credentialVersion: number;
  opaqueTokenHash: string;
  tokenVaultRef: string;
  checkoutCookieHash?: string; // hash/verifier only; raw cookie secret is held by the browser as HttpOnly
  parentOrigin: string;
  nonceHash: string;
  expiresAt: string;
  consumedAt?: string;
  revokedAt?: string;
  createdAt: string;
}
```

The raw checkout token and raw handshake nonce are held only in dedicated ephemeral in-memory vaults. The URL carries the token in a fragment, not a query string. The checkout page exchanges the token in a same-origin POST body. A checkout session expires after 15 minutes. Expiry invalidates only the checkout capability; it never changes payment or order state and emits no payment event. A `created` payment may receive a new session through the reissue route, retaining the same payment ID. Reopening a valid, unexchanged session is allowed; only one token exchange and one payment outcome transition can win.

## 13.4 Canonical Event

```ts
export type MockEventType =
  | "payment.created"
  | "payment.pending"
  | "payment.authorized"
  | "payment.captured"
  | "payment.failed"
  | "payment.cancelled"
  | "order.paid";

export interface MockEvent {
  id: string;
  type: MockEventType;
  createdAt: string;
  orderId: string;
  paymentId?: string;
  simulated: true;
  livemode: false;
  schemaVersion: 1;
  canonicalPayload: Readonly<Record<string, unknown>>;
}
```

A canonical event is mode-neutral and contains no webhook-specific serialized body. The domain service deep-clones and recursively freezes JSON-compatible values before storing them. No route or UI receives a mutable reference to the stored object. Each webhook delivery serializes the canonical event with the serializer selected by its endpoint mode and stores the exact bytes in the delivery-body vault.

## 13.5 Webhook Endpoint

```ts
export type WebhookMode = "native" | "compatibility";

export interface WebhookEndpoint {
  id: string;
  label: string;
  url: string;
  mode: WebhookMode;
  enabled: boolean;
  subscribedEvents: string[];
  customHeaderSetRef: string;
  configVersion: number;
  currentSecretVersion: number;
  createdAt: string;
  updatedAt: string;
}
```

The endpoint mode is a required configuration field. Changing mode increments `configVersion` and applies only to future deliveries and Replay; existing deliveries retain their snapshot. Secret bytes and custom header values are held in separate in-memory vaults and are never included in endpoint serialization.

## 13.6 Delivery

```ts
export type DeliveryStatus =
  | "queued"
  | "delivering"
  | "succeeded"
  | "failed"
  | "exhausted"
  | "rejected"
  | "interrupted";

export interface WebhookDelivery {
  id: string;
  eventId: string;
  endpointId: string;
  mode: WebhookMode;
  status: DeliveryStatus;
  endpointConfigVersion: number;
  endpointSnapshot: {
    url: string;
    mode: WebhookMode;
    customHeaderSetRef: string;
    configVersion: number;
    secretVersion: number;
  };
  bodySnapshotRef: string;
  bodySha256: string;
  secretVersion: number;
  rejectionCode?: string;
  rejectionMessage?: string;
  manualRetryCount: number;
  createdAt: string;
  updatedAt: string;
  attempts: WebhookDeliveryAttempt[];
  parentDeliveryId?: string;
}
```

`bodySnapshotRef` resolves to exact serialized bytes in an ephemeral delivery-body vault. The byte array is never exposed directly; internal reads return defensive copies. A retry uses this exact snapshot. Replay creates a new snapshot according to the selected endpoint's current mode.

## 13.7 Delivery Attempt

```ts
export type DeliveryAttemptOutcome =
  | "succeeded"
  | "http_error"
  | "timed_out"
  | "connection_failed"
  | "redirect_rejected"
  | "target_rejected"
  | "response_too_large"
  | "interrupted_unknown";

export interface WebhookDeliveryAttempt {
  id: string;
  deliveryId: string;
  attemptNumber: number;
  outcome: DeliveryAttemptOutcome;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  responseStatus?: number;
  responseHeadersSanitized?: Record<string, string>;
  responsePreview?: string;
  responsePreviewTruncated?: boolean;
  errorCode?: string;
  errorMessage?: string;
}
```

`response_too_large` applies only to an oversized receiver response. An oversized outbound event body is rejected at delivery creation and creates no attempt record.

## 13.8 Idempotency Record

```ts
export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestFingerprint: string;
  resourceType: "order" | "payment_attempt" | "checkout_session";
  resourceId: string;
  parentPaymentId?: string; // protects the payment aggregate for checkout-session idempotency
  checkoutSessionId?: string;
  responseSnapshot: Record<string, unknown>; // token-free, URL-free metadata only
  createdAt: string;
  expiresAt: string;
}
```

The canonical request fingerprint is generated after schema validation and default application, with object keys sorted recursively and arrays retaining order. The response snapshot must never contain a raw checkout token, full checkout URL, API credential, webhook secret, or arbitrary unredacted request header. An unexpired idempotency record protects its referenced resource from eviction. If an attempt record points to a checkout session that has expired, a repeated create request returns the existing payment ID and `CHECKOUT_SESSION_EXPIRED`; the dedicated checkout-session reissue route is used to obtain a new session URL without creating a new payment attempt.

# 14. In-Memory Limits and Resource Management

These defaults are MVP limits. They are centralized in configuration, validated at startup, and displayed in Settings.

| Resource | Default maximum | Overflow behavior |
|---|---:|---|
| Active webhook endpoints | 10 | Reject with `RESOURCE_LIMIT_REACHED` |
| Credentials | 5 developer credentials total | Reject new credential until one is revoked |
| Orders | 2,000 | Evict only an eligible complete order aggregate; otherwise reject new order |
| Payment attempts | 3,000 | Evict only with its eligible parent order aggregate; never independently orphan references |
| Checkout sessions | 3,000 | Expired/revoked sessions may be removed after linked token-vault entries are cleared |
| Events | 2,000 | Evict only when no retained/active delivery references the event and aggregate policy permits it |
| Deliveries | 5,000 | Evict completed delivery plus nested attempts and body snapshot together |
| Delivery attempts | 10,000 | Retained as children of delivery; never independently orphaned |
| Idempotency entries | 5,000 | Remove expired entries first; if no slot exists, reject with `IDEMPOTENCY_STORE_FULL` |
| Queue jobs | 100 | Create rejected delivery with `DELIVERY_QUEUE_FULL`; no attempt is made |
| Concurrent webhooks | 5 max; 3 default | Remaining jobs wait in bounded queue |
| Event body | 128 KB | Reject delivery before network I/O with `DELIVERY_PAYLOAD_TOO_LARGE` |
| API request body | 1 MB | Return 413 |
| Total response bytes read | 64 KB | Abort receiver response read and classify `response_too_large` |
| Captured response preview | 16 KB | Truncate preview and set `responsePreviewTruncated: true` |
| Custom headers per endpoint | 10 | Reject excess headers |
| Custom header value | 2 KB | Reject excess value length |
| Metadata per order | 8 KB | Reject metadata exceeding limit |

## 14.1 Referential Integrity and Eviction Graph

A single `RetentionCoordinator` owns all record eviction. Individual repositories must not independently delete records that another retained record references.

The minimum retention graph is:

```text
Order
  └── Payment Attempts
        └── Checkout Sessions
Order/Payment
  └── Canonical Events
        └── Webhook Deliveries
              └── Delivery Attempts
              └── Delivery Body Snapshot
Idempotency Record ──references──> Order, Payment Attempt, or Checkout Session; checkout-session entries also protect their parent payment aggregate
Endpoint ──references──> Secret/Header Vault Versions
```

Eviction rules:

1. Never evict an order aggregate containing a created, pending, or authorized payment attempt.
2. Never evict a resource referenced by an unexpired idempotency record.
3. Never evict an event while any queued, delivering, retry-eligible, or retained delivery references it.
4. When an order aggregate becomes eligible, delete in a deterministic order: expired checkout sessions and token-vault entries; eligible completed deliveries and their attempt/body snapshots; unreferenced canonical events; terminal payment attempts; expired idempotency entries; then the order.
5. A webhook endpoint may be deleted from active configuration while its historical delivery snapshots remain. Its secret/header vault versions are retained only while an eligible delivery needs them.
6. If aggregate deletion cannot be completed without breaking references, do not partially delete. Reject the new operation with `RESOURCE_LIMIT_REACHED` and explain which cap is full.
7. Reset clears repositories, queues, token vaults, compatibility-secret vaults, webhook-secret vaults, custom-header vaults, delivery-body vaults, idempotency entries, rate-limit counters, control sessions, and generated credentials in one session-reset operation. Safe UI preferences are preserved.

Eviction is deterministic, test-covered, and visible. The server never evicts an active payment attempt or an executing delivery. If no safe candidate exists, it rejects new work rather than orphaning references.

# 15. Technical Architecture

## 15.1 Architecture Style

Use a small modular monolith. The MVP does not need microservices, Redis, message brokers, or a database. The architecture must still separate UI, HTTP transport, domain logic, in-memory storage, and outbound webhook delivery.

## 15.2 High-Level Diagram

```text
Browser
  |
  | loopback HTTP
  v
PAYSIM Web UI (React + TypeScript)
  |
  | same-origin control API / Native API calls
  v
PAYSIM Local Server (Node.js + Express)
  |
  +--> Control Session + Credential Service
  |
  +--> Native API Adapter --------------------+
  |                                             |
  +--> Razorpay-style Compatibility Adapter    |
  |                                             |
  +---------------------------------------------+
                        |
                        v
                 Shared Domain Layer
                        |
          +-------------+--------------+
          |             |              |
      Order Service  Payment State  Event Builder
                      Machine          |
          |             |              |
          +-------------+--------------+
                        |
                        v
                 In-Memory Repositories
                        |
                        v
                 Webhook Dispatcher
                        |
                  Bounded Queue
                        |
                        v
              Loopback Target Validator
                        |
                        v
            Developer's Local HTTP Receiver
```

## 15.3 Repository Structure

```text
paysim/
├── apps/
│   ├── web/                         # React + TypeScript + Vite UI
│   └── server/                      # Node.js + Express local server
├── packages/
│   ├── contracts/                   # Shared schemas, DTOs, enums, API contracts
│   ├── domain/                      # Orders, payments, state machine, event creation
│   ├── adapters-native/             # Native API route/controller layer
│   ├── adapters-compat/             # Razorpay-style Orders and Checkout adapter
│   ├── webhook-engine/              # Queue, target validation, HMAC, retries, replay
│   ├── storage-memory/              # In-memory repositories and limits
│   └── sdk-node/                    # Optional Node bridge and signature helpers
├── examples/
│   ├── express-native-receiver/
│   ├── express-compat-receiver/
│   ├── react-checkout-demo/
│   └── curl/
├── fixtures/
│   ├── events-native/
│   │   ├── payment.captured.json
│   │   └── payment.captured.body.json
│   └── events-compat/
│       ├── payment.captured.json
│       └── payment.captured.body.json
├── docs/
│   ├── PRD.md
│   ├── PRD_v1.0_ARCHIVE.md
│   ├── PRD_v2.0_ARCHIVE.md
│   ├── PRD_v2.1_ARCHIVE.md
│   ├── PRD_v2.2_CHANGELOG.md
│   ├── PRD_v2.2_RESOLUTION_REGISTER.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── API_DOCUMENTATION.md
│   ├── COMPATIBILITY_MATRIX.md
│   ├── WEBHOOK_SECURITY.md
│   ├── TESTING_STRATEGY.md
│   └── TROUBLESHOOTING.md
├── scripts/
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
├── README.md
└── LICENSE
```

The exact package boundaries may be refined during implementation, but domain services must not import Express, React, or browser-only modules. Adapters may depend on domain contracts; the domain layer must not depend on HTTP transport.

## 15.4 Technology Stack

| Layer | Choice | Requirement |
|---|---|---|
| Language | TypeScript | Strict mode enabled |
| Frontend | React | Functional components and explicit component boundaries |
| Build/dev server | Vite | Development proxy to local server |
| Styling | Tailwind CSS plus CSS variables | Design tokens, responsive states, no remote runtime CSS |
| Backend | Node.js + Express | Local HTTP server and static asset serving |
| Validation | Zod | Runtime validation at all untrusted input boundaries |
| Testing | Vitest | Unit and contract tests |
| HTTP integration testing | Supertest or native fetch-based test harness | Route-level tests |
| Browser testing | Playwright | Checkout and dashboard critical-path tests |
| IDs | `crypto.randomUUID()` or cryptographic random bytes | No predictable sequential public IDs |
| Signing | Node.js `crypto` | HMAC-SHA256, timing-safe comparison |
| Storage | In-memory maps/repositories | No database in MVP |
| Package manager | npm workspaces | Single lockfile and reproducible install |

Package versions must be selected at implementation time from supported stable releases, pinned by the lockfile, and tested on Node.js 24.x and 26.x LTS. Do not use alpha/current-only runtimes for the MVP release baseline.

## 15.5 Runtime Commands

Required scripts:

- `npm install` — install all workspaces.
- `npm run dev` — start API and Vite development UI.
- `npm run build` — build all workspaces and production UI.
- `npm start` — run local server and serve built UI on `127.0.0.1:8787`.
- `npm test` — run unit and integration tests.
- `npm run test:e2e` — run Playwright critical-path tests.
- `npm run typecheck` — strict TypeScript check.
- `npm run lint` — static lint checks.
- `npm run format:check` — verify formatting.

The README must document Windows PowerShell commands as well as macOS/Linux equivalents where command syntax differs.

## 15.6 Configuration

Supported environment variables:

| Variable | Default | Validation |
|---|---|---|
| `PAYSIM_HOST` | `127.0.0.1` | Only `127.0.0.1` or `::1` |
| `PAYSIM_PORT` | `8787` | Integer 1024–65535; reject reserved internal conflicts |
| `PAYSIM_WEB_DEV_PORT` | `5173` | Development only; loopback only |
| `PAYSIM_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `PAYSIM_DATA_LIMIT_PROFILE` | `default` | Only documented profiles |
| `PAYSIM_CONTROL_TOKEN` | generated | Optional explicit local override; never commit to source control |

Unknown or invalid environment settings must fail startup with actionable errors. Secrets must not be printed except the one-time control token and one-time generated credentials in the intended setup flow.

## 15.7 Internal Domain Service Boundaries

- `OrderService`: order creation, retrieval, listing, idempotency integration.
- `PaymentService`: attempt creation, outcome selection, pending resolution, state transitions.
- `CheckoutSessionService`: opaque token generation, expiry, validation, consumption.
- `EventService`: immutable event construction and retention.
- `WebhookEndpointService`: endpoint CRUD, subscriptions, secret versions.
- `WebhookDispatcher`: queue, HTTP delivery, timeout, retries, response capture.
- `DestinationPolicy`: loopback URL parsing and connection-time enforcement.
- `CredentialService`: local token/key generation, hashing, rotation, validation.
- `SessionService`: control token exchange, CSRF, cookie session.
- `DiagnosticsService`: redacted logs and request IDs.

## 15.8 Concurrency and Atomicity

Node.js runs domain services in one process. State mutation must still be atomic at the application level:

- Validate state and update related Order/Payment records in one domain-service operation.
- Do not `await` between reading current state and committing a transition unless a keyed mutex or equivalent serialisation protects the aggregate.
- Prevent two simultaneous requests from creating two active attempts for one order.
- Prevent two simultaneous success requests from capturing an order twice.
- Store event creation and state mutation as one synchronous in-memory transaction boundary.
- Webhook delivery is dispatched only after the event and payment state are committed.

---

# 16. User Interface and Experience Requirements

## 16.1 Visual Direction

PAYSIM should look like a premium developer utility, not a consumer banking app. Prioritize information hierarchy, readable data tables, precise status chips, fast inspection, and strong empty/error states. Avoid deceptive bank/payment branding.

Design characteristics:

- Professional technical dashboard.
- Clear light/dark theme support as a P1 enhancement.
- High contrast and accessible status labels.
- Dense but readable event and request inspectors.
- Monospaced formatting for IDs, headers, signatures, and JSON.
- Simulation disclosure visible at every payment decision point.
- No animation that delays a critical developer action.

## 16.2 Primary Navigation

1. Overview
2. Payment Lab
3. Transactions
4. Webhook Studio
5. Events
6. API Playground
7. Compatibility
8. Documentation
9. Settings

## 16.3 Screen Requirements

### Overview

- Session summary cards.
- Recent orders and payment attempts.
- Event activity.
- Delivery success/failure summary.
- Current local URL and storage notice.
- Persistent simulation banner.

### Payment Lab

- Create order form with amount in INR and optional receipt/description.
- Clear note that amount is mock data and stored as paise.
- Create attempt and launch checkout actions.
- Scenario quick actions for success, pending, failure, and cancel.
- Pending resolution action.
- Related order/payment/event links.

### Checkout

- PAYSIM brand.
- Simulation warning.
- Order summary.
- Mock UPI/card/wallet selectors.
- Test outcome controls clearly identified as developer simulation controls.
- No fields for real payment credentials.
- Result/return actions.
- Illustrative QR, if present, visibly marked not payable and not scannable.

### Transactions

- Order and payment attempts are distinguishable.
- Search by ID/receipt.
- Filters for order status, payment status, mock method, and time.
- Detail drawer with attempt timeline and event links.
- No assumption that one order equals one payment attempt.

### Webhook Studio

- Endpoint list with enabled/disabled state and event subscriptions.
- Create/edit endpoint form with live loopback URL validation.
- Reveal-once secret panel.
- Rotate secret action and confirmation.
- Endpoint config version and last-delivery summary.
- Delivery history and retry/replay actions.
- Explicit error display for unsupported Docker/WSL/LAN targets.

### Events

- Event list with type, ID, order/payment ID, and timestamp.
- JSON payload inspector.
- Copy raw body action.
- Related deliveries and attempts.
- Native/Compatibility mode badge.

### API Playground

- Choose Native or Compatibility mode.
- Endpoint/method selector.
- Request headers and body editor.
- Use current local test credentials without displaying them in plaintext by default.
- Send request to local PAYSIM only.
- Inspect status, elapsed time, response headers, response JSON, and error code.
- Copy cURL with credential placeholder by default.

### Compatibility

- Supported feature matrix.
- Base URL and test credential instructions.
- Checkout script URL.
- Supported option table and callback contract.
- Unsupported feature list.
- Compatibility conformance test status.

### Documentation

- Quick start.
- Native API reference.
- Compatibility reference.
- Webhook setup and verification.
- Node/Express examples.
- Troubleshooting.
- Simulation vs real-provider disclaimer.

### Settings

- Runtime and local URLs.
- Current session status and storage explanation.
- Credential management and rotation.
- Resource limits.
- Session reset with typed confirmation.
- Diagnostics level; secrets remain redacted at every level.

## 16.4 UX States

Every data-driven screen must have:

- Initial loading state.
- Empty state with next step.
- Populated state.
- Validation errors adjacent to inputs.
- Recoverable server/network error state.
- Disabled or unavailable state with an explanation.
- Success confirmation after mutation.

Status is never communicated by color alone. Text labels and accessible attributes are required.

## 16.5 Responsive Requirements

- Desktop is the primary MVP target.
- Tablet layout remains fully usable.
- Mobile may stack data tables into cards or use accessible horizontal scrolling.
- Checkout must work on narrow screens.
- No critical action can be hidden or unreachable on a small viewport.

## 16.6 Accessibility Requirements

- Keyboard-accessible navigation, modals, tables, forms, and actions.
- Visible focus indicator.
- Semantic headings and button labels.
- Form controls have programmatic labels.
- Dialogs trap and restore focus correctly.
- Status and error updates are announced where appropriate.
- JSON inspector supports copy without requiring mouse-only interaction.
- Respect reduced-motion settings.

---

# 17. Error Catalogue

Error codes must be stable, documented, and actionable.

| Code | HTTP | Meaning | User action |
|---|---:|---|---|
| `VALIDATION_ERROR` | 422 | Invalid input field or unsupported value | Correct the field using the documented schema |
| `MALFORMED_JSON` | 400 | Request body is not valid JSON | Send valid JSON |
| `UNAUTHORIZED` | 401 | Missing/invalid local test credential | Generate or use the correct PAYSIM test credential |
| `CONTROL_TOKEN_INVALID` | 401 | One-time dashboard control token is invalid, expired, or already consumed | Read the current token from the launching terminal or restart PAYSIM to create a new one |
| `CONTROL_SESSION_EXPIRED` | 401 | Dashboard session reached idle or absolute expiry | Exchange a fresh one-time control token |
| `CSRF_INVALID` | 403 | Missing or invalid control-plane CSRF token | Refresh the dashboard session CSRF token and retry |
| `FORBIDDEN` | 403 | Session, origin, CSRF, or permission failure | Re-authenticate or use the local dashboard origin |
| `NOT_FOUND` | 404 | Resource is not present in current session | Verify ID or recreate session data |
| `INVALID_STATE_TRANSITION` | 409 | Requested payment transition is not allowed | Inspect current payment state |
| `ORDER_ALREADY_PAID` | 409 | New attempt requested for paid order | Use a new mock order |
| `ACTIVE_PAYMENT_ATTEMPT_EXISTS` | 409 | Another attempt is pending/authorized/created | Resolve or cancel the active attempt first |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key used with a different body | Use a new key or repeat the original body |
| `IDEMPOTENCY_STORE_FULL` | 429 | Idempotency capacity is full and no expired entry can be removed | Reset the session or wait until entries expire; no live entry is silently evicted |
| `CHECKOUT_SESSION_EXPIRED` | 410 | Checkout capability expired or was revoked; payment state is unchanged | Call the checkout-session reissue route if the payment remains `created` |
| `CHECKOUT_SESSION_REISSUE_NOT_ALLOWED` | 409 | Checkout session cannot be reissued because payment is not `created` or an unexpired session is still active | Inspect the payment and current checkout sessions |
| `PAYSIM_UNSUPPORTED_OPTION` | 422 | Compatibility shim option is unknown or explicitly unsupported in strict mode | Remove the option or use a documented supported option |
| `DELIVERY_SNAPSHOT_UNAVAILABLE` | 409 | Original delivery configuration or secret version is no longer available for Retry | Use Replay with a currently enabled endpoint |
| `WEBHOOK_URL_REJECTED` | 422 | URL is outside loopback policy | Use an allowed literal loopback IP and port |
| `WEBHOOK_TARGET_CHANGED` | 422 | Target fails validation at send time | Re-register a safe endpoint |
| `WEBHOOK_TIMEOUT` | 504 | Local receiver did not respond before timeout | Check receiver and timeout setting |
| `WEBHOOK_CONNECTION_FAILED` | 502 | Could not connect to local receiver | Verify local app and published port |
| `WEBHOOK_RESPONSE_ERROR` | 502 | Receiver returned a non-success status | Inspect response body/status |
| `WEBHOOK_RESPONSE_TOO_LARGE` | 502 | Receiver response exceeded the 64 KB read limit | Fix the receiver to return a bounded response, then Replay |
| `DELIVERY_PAYLOAD_TOO_LARGE` | 413 | Serialized webhook event exceeds 128 KB before send | Reduce event metadata or use a smaller test event |
| `WEBHOOK_REDIRECT_REJECTED` | 502 | Receiver responded with redirect | Configure the final loopback endpoint directly |
| `DELIVERY_QUEUE_FULL` | 429 | Bounded queue is full | Wait for queued jobs or reduce concurrency load |
| `RESOURCE_LIMIT_REACHED` | 429 | In-memory resource cap reached | Reset session or remove eligible records |
| `RATE_LIMITED` | 429 | Local request limit exceeded | Retry after the indicated delay |
| `COMPATIBILITY_FEATURE_NOT_SUPPORTED` | 501 | Route/option outside supported compatibility subset | Use Native API or supported adapter operation |
| `INTERNAL_ERROR` | 500 | Unexpected internal failure | Use request ID in local diagnostics; do not expose stack trace |

A webhook endpoint returning a non-2xx response is a delivery result only. It never changes payment status.

---

# 18. Security and Privacy Requirements

## 18.1 Threat Model

PAYSIM is a local developer tool with an outbound webhook capability. Main risks include:

- A malicious webpage trying to access or mutate a local PAYSIM server.
- A user unintentionally configuring a sensitive local service as a webhook destination.
- An attacker attempting to turn PAYSIM into an SSRF or network-scanning proxy.
- Credentials or signing secrets leaking through logs, browser storage, error messages, or exports.
- Duplicate requests causing duplicate payment or order state changes.
- Oversized request/response payloads exhausting memory.
- Compatibility mode being mistaken for a real provider or its production signature.

## 18.2 Security Controls

| Risk | Required control |
|---|---|
| Local API exposure | Bind loopback only |
| Cross-origin browser access | Exact CORS allowlist, Origin/Host validation, CSRF token, SameSite cookie |
| Unrestricted outbound request | Literal loopback-only URL policy; no DNS; no redirects; no proxy |
| Internal service targeting | Reject PAYSIM's own ports and require explicit endpoint registration |
| Secret leakage | One-time reveal, in-memory secret vault, redaction, no browser localStorage |
| Signature spoofing | HMAC-SHA256 over raw bytes, constant-time compare in examples |
| Duplicate order/payment | Idempotency key and atomic state machine |
| Duplicate webhook action | Stable event ID and receiver-side deduplication examples |
| Resource exhaustion | Body, queue, concurrency, event, attempt, and response-size caps |
| Misleading payment result | Persistent simulation labels and no credential collection |
| Compatibility confusion | Explicit adapter name, local base URL, feature matrix, non-affiliation notice |

## 18.3 Secret Management

- Use `crypto.randomBytes` for control tokens, API tokens, checkout tokens, nonces, and signing secrets with at least 256 bits of entropy where used as bearer/signing material.
- Use scrypt with a per-secret random salt for Native bearer token verification and Compatibility Basic-auth verification.
- Compatibility key secret is held in two forms: a salted verifier hash for Basic authentication and a raw `Buffer` in a dedicated ephemeral vault for PAYSIM synthetic checkout callback HMAC generation. The raw buffer is never persisted to disk. Rotation immediately disables that version for new authenticated API requests, but the raw buffer remains in the ephemeral vault while any payment attempt created under that version is non-terminal or any linked checkout session remains usable. It is purged only after every linked attempt is terminal and every linked session is consumed, expired, or revoked.
- Webhook endpoint secrets are held as raw `Buffer` values only in a separate in-memory vault, because delivery signing requires the original bytes. Each delivery snapshots a secret version reference, not the secret itself.
- One-time secrets are displayed once. Clear reveal-state UI memory after acknowledgement/navigation; never store secrets in browser localStorage/sessionStorage.
- Checkout capability tokens are stored as hashes in session records and raw tokens in a separate ephemeral token vault. The raw token is carried only in the URL fragment and the same-origin exchange POST body, never in query strings or referrers.
- Do not put secrets in URLs, query parameters, error payloads, request previews, event payloads, or exports.
- Redact `Authorization`, `Cookie`, `Set-Cookie`, `X-PaySim-Signature`, `X-Razorpay-Signature`, and configured sensitive custom headers from default logs/inspectors.
- Never commit `.env` files or test credentials.
- On server shutdown, clear all secret/token vault buffers best-effort before process exit. JavaScript runtime memory zeroization is best-effort and must not be represented as a guarantee against forensic memory inspection.

## 18.4 Raw Body and Signature Verification

Webhook receiver examples must use raw request bytes for signature verification before JSON parsing. A parsed-and-reserialized JSON object is not equivalent to the exact signed request body.

The sample receiver must:

1. Read raw body with an explicit maximum size.
2. Validate signature format and length.
3. Recompute HMAC-SHA256 using the configured PAYSIM webhook secret.
4. Compare digest using constant-time comparison.
5. Parse JSON only after the signature is valid.
6. Deduplicate by event ID before performing a business action.
7. Return a success response only after the event has been accepted into the sample application's processing boundary.

## 18.5 Data Privacy

- No analytics or telemetry in MVP.
- No external calls required for normal workflows.
- Synthetic data only.
- Session data clears on server stop/reset.
- Local logs are redacted and remain on the developer's machine.
- Exported diagnostics are opt-in and sanitized.
- No real payment credentials may be entered into PAYSIM.

## 18.6 Production Warning

PAYSIM itself is not intended to run as a public service. The MVP server must refuse non-loopback bind hosts. Production payment integration must use the real provider's official documentation, credentials, test mode, webhook verification, and production readiness process.

---

# 19. Non-Functional Requirements

| Category | Requirement | Acceptance measurement |
|---|---|---|
| Startup | Runs without external service or database | Clean install and start succeeds offline after dependency installation |
| Portability | Windows, macOS, Linux | CI or documented manual smoke test on supported OS targets |
| Runtime | Node 24.x and 26.x LTS | Build and tests pass on both supported majors |
| Performance | Normal local CRUD operations feel immediate | Typical dashboard actions complete without perceptible wait, excluding user-configured webhook delay |
| Reliability | Failed receiver cannot crash server | Connection and timeout integration tests pass without process crash |
| Determinism | Same scenario produces same logical state/event contract | Contract fixtures and state-machine tests pass |
| Type safety | Strict TypeScript | `typecheck` passes with no implicit `any` in core domain packages |
| Maintainability | Domain logic separate from adapters | Domain tests run without Express or browser runtime |
| Accessibility | Keyboard, semantics, status labels | Critical-path keyboard and accessibility checks pass |
| Security | Local-only, loopback restrictions, redacted secrets | Security suite covers all disallowed URL classes and secret leakage |
| Observability | Useful local diagnostics without secrets | Each request/attempt has correlation ID and error code |
| Cost | ₹0 required service cost | No paid API/hosted service needed for full core local workflow |
| Offline operation | No product telemetry or runtime external requests | Network inspection shows no required external requests after install |

---

# 20. Rate Limits and Abuse Controls

The tool runs locally, but limits are required to protect the developer's machine and avoid accidental loops.

Default limits:

- API request rate: 120 requests/minute per credential, with short burst allowance.
- Control-plane mutation rate: 60 requests/minute per dashboard session.
- Order creation: 30/minute per credential.
- Payment attempt creation: 30/minute per credential.
- Webhook endpoint creation: 10 active endpoints/session.
- Webhook dispatch: 5 concurrent, 100 queued.
- Request body: 1 MB.
- Event payload: 128 KB.
- Response preview: 16 KB.

Rate-limited response includes `429`, `RATE_LIMITED`, and a bounded `Retry-After` value when applicable. Rate limits must not be implemented in a way that causes a payment state change to occur twice or be partially applied.

---

# 21. Testing Strategy

## 21.1 Unit Tests — Domain

Additional v2.2 requirements:
- Creation of an attempt atomically moves first-use order `created → attempted` and emits exactly one `payment.created`.
- All transitions in the event matrix emit exactly the listed events in the listed order; invalid transitions emit none.
- Checkout expiry while payment is `created` atomically cancels and emits one `payment.cancelled`; expiry after `pending`/`authorized` does not mutate payment.
- Per-order serialization prevents two concurrent attempt creations or competing terminal outcomes from both committing.
- Amount above `MAX_ORDER_AMOUNT_PAISE` is rejected by both API surfaces.
- Idempotency response snapshots never contain checkout capability tokens or checkout URLs.

- Order creation and amount/currency validation.
- Order state transitions.
- Payment attempt creation and attempt sequencing.
- Payment state transition table.
- Pending resolution.
- Success path and order paid transition.
- Conflicting simultaneous attempts.
- Duplicate identical outcomes.
- Rejection of conflicting outcomes.
- Idempotency key request fingerprint behavior.
- Event snapshot immutability.
- Event ID uniqueness.
- Checkout token generation, expiry, and one-time semantics.
- API key generation and secret hash comparison.
- HMAC signature generation and constant-time verification helper.
- Secret redaction.
- Resource caps and eviction behavior.

## 21.2 Unit Tests — Webhook Engine and Security

Additional v2.2 requirements:
- Native and Compatibility endpoint modes produce their own deterministic serialized event bodies and signatures.
- Endpoint mode/configuration changes affect only new deliveries and Replay; prior delivery retries use the original body/config/secret version.
- Retry uses byte-identical stored body bytes; Replay reserializes the same canonical event under the selected endpoint's current mode.
- Oversized outbound event creates a rejected delivery with no HTTP attempt; oversized receiver response creates `response_too_large`.
- Three automatic attempts and at most three manual retry operations are enforced.
- Queue-full and unsafe-target rejections create no network attempt.
- Eviction preserves all reference invariants across order, payment, event, delivery, idempotency, and vault records.

- Accept literal `127.0.0.1` with explicit port.
- Accept literal `[::1]` with explicit port.
- Reject `localhost` and all DNS names.
- Reject public IPv4 and IPv6 addresses.
- Reject private LAN, link-local, multicast, unspecified, broadcast, and reserved destinations.
- Reject IPv4-mapped IPv6, zone IDs, non-canonical numeric host strings, username/password, query, fragment, and unsupported schemes.
- Reject PAYSIM's own server ports.
- Revalidate destination immediately before connect.
- Verify connected remote address.
- Confirm redirects are not followed.
- Confirm proxy environment variables are ignored.
- Enforce request and response size limits.
- Enforce timeout.
- Enforce queue and concurrency limits.
- Classify 2xx, retryable, non-retryable, redirect, timeout, and connection failure outcomes.
- Verify retry and replay preserve event ID and exact body bytes.
- Verify retry uses original secret version and replay uses current secret version.

## 21.3 API Integration Tests

- Create and list order.
- Retrieve order by ID.
- Create payment attempt.
- Create second sequential attempt after failure.
- Reject concurrent active attempt.
- Simulate success, pending, failure, and cancellation.
- Resolve pending payment.
- Reject invalid transitions.
- Verify order is paid only after capture.
- Verify duplicate order creation is idempotent.
- Verify idempotency conflict when body changes.
- Verify list pagination and filters.
- Verify standard error envelope and HTTP status.

## 21.4 Webhook Integration Tests

Use a dedicated test receiver bound to a loopback port.

Scenarios:

1. Receiver returns 200.
2. Receiver returns 204.
3. Receiver returns 400 (no auto retry).
4. Receiver returns 429 (bounded retry).
5. Receiver returns 500 (bounded retry).
6. Receiver redirects (redirect rejected; no redirect target contacted).
7. Receiver never responds (timeout).
8. Receiver port is closed (connection failure).
9. Receiver responds with large body (preview truncation).
10. Receiver receives exact event bytes and can validate HMAC.
11. Payload byte alteration fails signature verification.
12. Retry creates additional attempt and preserves prior attempts.
13. Replay creates a new delivery but preserves event ID and event body.
14. Delivery failure does not alter payment state.
15. Queue overflow is visible and does not crash the server.

## 21.5 Compatibility Tests

Additional v2.2 requirements:
- Checkout shim and iframe handshake validate exact origins, source window, protocol version, nonce, and session binding.
- Wildcard `postMessage` target origin is absent from the implementation.
- Checkout capability token appears only in the URL fragment and the one-time same-origin exchange POST body; it is not placed in query strings, referrers, browser storage, logs, callback objects, or `postMessage` payloads. The parent page can inspect the `checkout_url` value supplied to the shim.
- Parent developer origin is not added to general PAYSIM API CORS allowlist.
- Compatibility key rotation rejects the old version for new requests but retains its in-memory callback-signing secret while any linked payment attempt remains non-terminal; tests cover attempts whose checkout session has already expired or been consumed.
- Compatibility callback HMAC uses the correct credential version and fails closed if the vault reference is unavailable.

Use fixed JSON fixtures for supported request/response and event contracts.

- Basic auth with PAYSIM credentials.
- Invalid credentials.
- Create/fetch Orders.
- Amount/currency validation.
- Idempotency.
- Checkout shim constructor and supported options.
- `open`, `close`, `on`, `off`, `once`.
- Success callback fields and synthetic signature.
- Failure event shape.
- Modal dismiss behavior.
- Webhook compatibility payload envelope.
- Compatibility signature header.
- Unsupported routes return 501 and never contact internet.
- Compatibility dashboard shows supported and unsupported features.

## 21.6 UI and End-to-End Tests

- First-run token entry and session creation.
- Credential generation and one-time reveal.
- Create order and launch checkout.
- Simulate each supported outcome.
- Resolve pending payment.
- View order/payment history.
- Register safe endpoint.
- Reject unsafe target with reason.
- Rotate secret and verify version messaging.
- Inspect webhook delivery and response.
- Retry failed delivery.
- Replay event to selected endpoint.
- Reset session with typed confirmation.
- Verify no horizontal overflow or inaccessible primary action on target viewports.
- Verify all simulation disclosures are visible.

## 21.7 Security Acceptance Tests

Additional v2.2 requirements:
- Session exchange consumes the control token once; replayed token is rejected.
- Session idle and absolute expiry are enforced.
- Login attempt rate limits are enforced without permanent lockout.
- CSRF, Host, Origin, and cookie-scope rules are tested.
- Checkout frame ancestor policy is exact-origin and non-wildcard.
- Message nonce/source/origin mismatches do not change payment state.
- Secret version vault lifecycle is correct on rotation, checkout expiry, retry, reset, and shutdown.

- PAYSIM cannot bind to `0.0.0.0` via environment variable.
- Cross-origin request cannot mutate Control API.
- Missing/invalid CSRF token blocks mutation.
- Dashboard control token is not accepted as Native API key.
- Real-looking provider credentials are not sent externally.
- No outbound internet request occurs during core workflow.
- No secrets appear in logs, browser local storage, exports, or error responses.
- Arbitrary network destination attempts are rejected.
- No credentials are requested in checkout.

## 21.8 Test Quality Gates

MVP release gate:

- All P0 unit tests pass.
- All P0 API integration tests pass.
- All P0 webhook/security tests pass.
- All P0 compatibility conformance tests pass.
- Critical-path UI tests pass on Chromium.
- `typecheck`, `lint`, `format:check`, and `build` pass.
- No known critical/high security defect remains open.

Do not claim test counts or pass rates in documentation until tests have actually been run in the implementation repository.

---

## 21.9 v2.2 Contract Regression Tests

The following tests are mandatory before implementation can be called complete:

| Test ID | Scenario | Expected result |
|---|---|---|
| V22-01 | Exchange valid one-time control token | One session cookie and CSRF token are issued; token is atomically consumed |
| V22-02 | Reuse or submit invalid control token | Generic `401 CONTROL_TOKEN_INVALID`; no session created |
| V22-03 | Rotate compatibility credential while an attempt is active | Old version cannot authenticate new requests; callback signing remains possible for the bound attempt until terminal |
| V22-04 | Create compatibility checkout session for another credential's order | Rejected; no payment attempt or session created |
| V22-05 | Change endpoint mode after a delivery is created | Existing delivery keeps old mode and exact bytes; new delivery uses new mode |
| V22-06 | Retry a delivery | Exact body bytes, URL, mode, and secret version are reused |
| V22-07 | Replay to an endpoint in another mode | New delivery uses the selected endpoint's current mode serializer; canonical event identity remains unchanged |
| V22-08 | Expire a checkout capability while payment is `created` | Session token is invalidated; payment/order state and event count do not change |
| V22-09 | Reissue after capability expiry | New checkout session references the same payment ID; no duplicate attempt or `payment.created` event |
| V22-10 | Reissue while payment is not `created` | `409 CHECKOUT_SESSION_REISSUE_NOT_ALLOWED`; no session created |
| V22-11 | Run compatibility shim from a different parent origin | Shim refuses to open; no iframe or payment request is created |
| V22-12 | Send malformed, stale, wildcard, or wrong-source postMessage | Message is ignored; payment state does not change |
| V22-13 | Serialize native and compatibility event fixtures | Deterministic UTF-8 bytes match committed test fixtures |
| V22-14 | Attempt eviction of an order owned by a live idempotency record | Aggregate remains intact or request is rejected; no dangling references |
| V22-15 | Expire a consumed checkout capability while payment remains `created` | Payment remains `created`; a new session can be issued for the same payment ID |
| V22-16 | Reissue compatibility checkout session after prior session expiry/consumption | Credential ownership is rechecked; same payment ID is returned with no duplicate attempt/event |
| V22-17 | Serialize compact webhook fixture | Serializer bytes exactly match `.body.json` fixture without trailing newline |
| V22-18 | Rotate compatibility key while linked attempt is non-terminal but session is expired | New auth with old key is rejected; callback signing for the linked attempt still succeeds |
| V22-19 | Exchange checkout capability | One-time token is consumed and an HttpOnly, SameSite=Strict, session-scoped cookie is set |
| V22-20 | Reload/reopen checkout iframe after token exchange | Valid checkout cookie authorizes the same session until expiry/revocation; token is not exchanged again |
| V22-21 | Replay idempotency key after checkout token was consumed | Return `409 CHECKOUT_SESSION_ALREADY_CONSUMED`; do not issue a second token |
| V22-22 | Reissue checkout session | Requires a new idempotency key and an expired/revoked prior session; payment ID remains unchanged |

# 22. Definition of Done — MVP Release Gate

PAYSIM MVP is complete only when all statements below are true:

1. A developer can install and start PAYSIM on a supported OS using documented commands.
2. PAYSIM binds to loopback only and refuses public bind configuration.
3. PAYSIM works without a database, merchant account, KYC document, provider credential, paid API, or external runtime service.
4. Dashboard control session and developer API credentials are separate.
5. Native API creates, lists, and retrieves orders.
6. Compatibility API creates and fetches the documented order subset using PAYSIM-issued Basic credentials.
7. Checkout opens locally and shows a prominent simulation warning.
8. Checkout never collects real financial credentials or creates payable QR/UPI intents.
9. Order and payment attempt are separate resources with tested state machines.
10. One order supports multiple sequential attempts but not parallel active attempts.
11. Success, pending, failure, and cancellation flows work deterministically.
12. Pending payments can be resolved later.
13. Order becomes paid only after capture.
14. Idempotency behavior is correct and fully tested for P0 creation operations.
15. Events are immutable and generated once per accepted transition.
16. Webhook endpoints accept only literal loopback targets and are revalidated before connection.
17. Webhook requests are signed over exact raw bytes.
18. Receiver examples verify signature before parsing or processing.
19. Bounded automatic retry, manual retry, and replay work as specified.
20. Retry/replay do not mutate payment state or event payload.
21. Delivery failure is separate from payment failure.
22. Request, queue, event, attempt, and response limits are enforced.
23. Secrets are shown once, held in memory only where necessary, and redacted from logs/exports.
24. Docker/WSL limitations and port publishing guidance are documented.
25. Compatibility matrix documents exactly what is supported and not supported.
26. API, compatibility, webhook, security, examples, and troubleshooting docs are complete.
27. All P0 test suites pass and no critical/high security issue remains open.

---

# 23. Milestones and Delivery Plan

## Milestone 0 — Repository and Runtime Foundation

**Scope:** Monorepo, scripts, TypeScript, shared contracts, local server, first-run session.

Tasks:
- Initialize npm workspaces.
- Configure TypeScript strict mode and path aliases.
- Configure lint, format, test, and build scripts.
- Create React/Vite app and Express server.
- Implement loopback-only host/port configuration.
- Implement health route and server startup diagnostics.
- Implement control-token setup and session cookie.
- Add basic app shell and simulation disclosure.

Exit criteria: clean install, start, local health check, and dashboard session succeed offline.

## Milestone 1 — Orders and Payment Domain

**Scope:** Domain types, in-memory repositories, order/payment services, state machine, idempotency.

Tasks:
- Implement Order, Payment, and CheckoutSession models.
- Implement amount/currency validation.
- Implement order creation/retrieval/listing.
- Implement payment attempt sequencing.
- Implement state transition service.
- Implement pending resolution.
- Implement immutable event generation.
- Implement bounded repositories and session reset.

Exit criteria: complete state-machine and API tests pass without UI dependency.

## Milestone 2 — Checkout and Compatibility Adapter

**Scope:** Local checkout UI, Native checkout sessions, compatibility order subset, checkout shim, bridge.

Tasks:
- Implement local checkout page.
- Implement four outcomes and three mock method labels.
- Add non-payable QR visual rule.
- Implement compatibility Orders API.
- Implement PAYSIM checkout shim.
- Implement callback signature helper.
- Add compatibility fixtures and supported-feature matrix.

Exit criteria: Native and compatibility flows complete against local services with no external requests.

## Milestone 3 — Webhook Studio and Delivery Engine

**Scope:** Endpoint CRUD, local target policy, secret management, event delivery, retries, replay.

Tasks:
- Implement endpoint configuration and subscriptions.
- Implement one-time secret generation and rotation.
- Implement literal loopback target parser and connection guard.
- Implement HMAC raw-body signing.
- Implement bounded queue and concurrency.
- Implement timeout/response capture and retry classification.
- Implement manual retry and replay semantics.

Exit criteria: receiver obtains signed payload; unsafe targets are rejected; delivery errors are inspectable and recoverable.

## Milestone 4 — Developer Console and Documentation

**Scope:** Dashboard, transactions, events, logs, API Playground, examples, docs.

Tasks:
- Complete overview and transaction views.
- Complete Event Inspector and delivery timeline.
- Complete endpoint configuration UX.
- Complete API Playground and cURL snippets.
- Write Node/Express Native and Compatibility examples.
- Write raw-body signature verification guide.
- Write Docker/WSL troubleshooting guide.

Exit criteria: a new developer can complete the full local workflow using only the README and in-app documentation.

## Milestone 5 — Hardening and Release

**Scope:** Security review, browser tests, supported OS smoke tests, docs audit, release packaging.

Tasks:
- Run all P0 test suites.
- Run security target validation suite.
- Validate no external network access during core workflow.
- Test Node 24.x and 26.x LTS.
- Test Windows 11, macOS, and Linux where CI/hardware is available.
- Validate accessibility and responsive UI.
- Audit logs, exports, errors, and browser storage for secrets.
- Write release notes and known limitations.

Exit criteria: Section 22 Definition of Done is satisfied.

---

# 24. Success Metrics

MVP is evaluated as a developer tool, not by payment volume.

Success indicators:

- New developer completes setup without a database or external service.
- New developer completes order → checkout → outcome → webhook in one guided session.
- Native and Compatibility APIs pass all documented P0 fixtures.
- Local receiver can validate PAYSIM signature from raw body.
- Retry and replay reproduce the same event without duplicate payment transitions.
- Disallowed webhook targets are rejected consistently.
- Typical test failure can be diagnosed from PAYSIM's event and delivery inspectors.
- No mandatory telemetry is collected.

No exact performance or adoption claim may be published until measured against an actual release build.

---

# 25. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Users confuse PAYSIM with real payment gateway | High | Persistent labels, no live payment controls, explicit non-goals, synthetic IDs and credentials |
| Compatibility adapter is mistaken for full Razorpay parity | High | Narrow compatibility matrix, explicit unsupported routes, no official branding, contract tests |
| User assumes official SDK works unchanged | High | Require local base URL/bridge and checkout shim; state hardcoded remote SDKs are unsupported |
| Local webhook sender becomes SSRF proxy | High | Literal loopback only, no DNS, no redirects, no proxy, target revalidation and port restrictions |
| Secret leaks from inspector/log | High | One-time reveal, redaction, memory-only vault, automated leak tests |
| Duplicate payment state from concurrent requests | High | Single domain transition service, keyed serialization, idempotency, concurrency tests |
| Webhook delivered but receiver repeats work | Medium | Stable event ID, raw-body verification example, receiver-side dedupe guide |
| Session data lost on restart | Medium | Visible session-only warning, reset explanation; persistence deferred |
| Docker/WSL target not reachable | Medium | Host-published loopback port instructions; do not relax target policy |
| Memory growth | Medium | Hard caps, deterministic eviction, bounded queue and response capture |
| Feature creep | Medium | P0 release gate and deferred feature list |
| Outdated Node runtime/package support | Medium | Support maintained LTS versions and revalidate at release time |

---

# 26. Explicitly Deferred Features

These are not MVP blockers and must not be added before P0 scope is stable unless a separate decision approves them.

| Feature | Target phase | Reason |
|---|---|---|
| JSON-file persistence | P1 | First MVP remains simple and session-only |
| SQLite persistence | P2 | Optional persistence without a database server |
| Multiple workspaces/projects | P2 | Introduces data isolation and credential complexity |
| Export/import fixtures | P1 | Must be sanitized and secret-free |
| Custom event templates | P2 | More flexible but increases validation and security scope |
| Advanced scenario scripting | P2 | Not needed for initial checkout/webhook workflow |
| Additional currencies | P2 | Requires currency-specific minor-unit rules |
| Public webhook relay/tunnel | Out of scope | Increases attack surface and contradicts local-only design |
| Hosted collaboration | Out of scope | Requires auth, persistence, hosting, and security operations |
| Refunds, subscriptions, payouts | Out of scope | Different financial workflows and larger compatibility scope |
| Additional provider adapters | P2 | Only after PAYSIM Native and first compatibility subset are stable |
| Scheduled webhook simulation | P2 | Adds background scheduling and lifecycle complexity |
| WebSocket live updates | P1 | Add only if polling is insufficient |
| Plugin marketplace | Out of scope | Not necessary for the core developer tool |

---

# 27. Resolution Register — Issues Found in PRD v1.0 and v2.0

The original 28 v1.0 issues remain resolved as recorded below. The v2.1 follow-up findings are mapped in `PRD_v2.1_RESOLUTION_REGISTER.md` with the precise amended sections and required tests. A row marked resolved describes a specification decision; it does not claim implementation completion.

| # | Previously identified v1.0 issue | Resolution in v2.1 |
|---:|---|---|
| 1 | Razorpay compatibility unclear | Section 9 defines a scoped local compatibility adapter, bridge, checkout shim, supported and unsupported feature matrix |
| 2 | Order and Payment had same lifecycle | Section 8 separates Order status from Payment Attempt status and defines transition/event ordering |
| 3 | Pending workflow incomplete | Sections 8.3–8.6 and API resolve route define pending resolution |
| 4 | Webhook endpoint management incomplete | Section 7.9 defines create, list, edit, enable/disable, delete, subscriptions, mode, and rotate |
| 5 | Retry vs Replay unclear | Sections 5.8 and 11.8–11.10 define distinct semantics, byte snapshots, mode serialization, and bounded manual retry |
| 6 | Localhost-only security incomplete | Section 12 limits to literal loopback IPs, no DNS, no redirects, no proxy, and connection-time revalidation |
| 7 | Webhook secret storage contradictory | Sections 5.6, 13.5–13.6, and 18.3 define a memory-only vault with versioned references |
| 8 | API key generation workflow missing | Sections 6.1, 7.3, and 10.4 define setup and credential management |
| 9 | API endpoints incomplete | Sections 10.3 and 10.4 provide Native and Control route catalogues, including session exchange and checkout-session reissue |
| 10 | Idempotency incomplete | Sections 10.6, 13.8, and 14 define scope, canonical fingerprint, expiry, token-free snapshots, and retention safety |
| 11 | UPI simulation vague | Section 7.7 defines mock-only method and non-network behavior |
| 12 | Fake QR behavior unsafe/unclear | Sections 7.6 and 7.7 prohibit payable/scannable QR and UPI payloads |
| 13 | Payment method selection undefined | Sections 7.5–7.7 define mock method enums and UI behavior |
| 14 | Event subscriptions missing | Sections 7.9 and 11.5 define endpoint subscriptions |
| 15 | Event routing unclear | Section 11.5 defines one delivery per matching enabled endpoint |
| 16 | Delivery outcomes incomplete | Sections 11.6–11.8 distinguish HTTP outcomes, pre-send rejection, and oversized receiver responses |
| 17 | History/payload limits missing | Sections 7.10, 14, and 20 define bounded limits and aggregate eviction |
| 18 | Pagination missing | Section 10.5 defines cursor pagination and maximum page size |
| 19 | Filtering missing | Sections 7.12 and 10.5 define supported filters |
| 20 | API Playground behavior incomplete | Sections 7.13 and 16.3 define requests, responses, cURL, and docs |
| 21 | Session reset UX missing | Sections 7.14 and 14 define reset of repositories, queues, vaults, sessions, and rate counters |
| 22 | Concurrency limits missing | Sections 7.10, 11.11, and 15.8 define queue, parallelism, and atomic transitions |
| 23 | Delivery queue model missing | Sections 11.6–11.11 define Delivery vs Attempt and bounded queue semantics |
| 24 | Project/workspace isolation unclear | MVP is explicitly single local session; multi-workspace/project support is deferred to P2 |
| 25 | Port defaults unresolved | Section 5.3 locks 5173 dev UI and 8787 local API/server |
| 26 | Docker/WSL behavior unclear | Section 12.4 documents host-published loopback ports and rejects private bridge IPs |
| 27 | Runtime version vague | Sections 3.3 and 15.4 lock supported Node 24.x/26.x LTS lines, revalidated at release time |
| 28 | Test acceptance too generic | Sections 21 and 22 define P0 test categories and release gates; v2.1 adds scenario-specific acceptance tests |

**Resolution status:** Specification gaps identified in the v1.0 audit and follow-up v2.0 audit are addressed by explicit requirements or documented deferrals. Implementation readiness still depends on architecture review, coding, and actual automated test execution.

## 27.1 PRD v2.1 Follow-up Audit Closure

The v2.0 follow-up audit findings are resolved by the following normative amendments:

1. Dashboard control authentication now has an explicit one-time token exchange route, CSRF issuance, session lifetime, and login rate limit (Sections 5.10, 7.1, 10.4, 17).
2. Native and Compatibility credential storage now distinguish verifier hashes from ephemeral signing-secret vault references (Sections 5.5, 13.3, 18.3).
3. Webhook endpoint mode is explicit, snapshotted, and drives deterministic per-delivery serialization; retries preserve exact body bytes while Replay serializes the canonical event under the selected endpoint's current mode (Sections 5.8, 11.4, 11.9–11.10, 13.4–13.7).
4. Checkout uses a PAYSIM-hosted same-origin iframe, exact-origin nonce-bound `postMessage`, per-session frame policy, and fragment-only capability token transport (Sections 5.9, 6.3, 12.6).
5. Checkout expiry, modal dismissal, pending-state handling, and reissue are deterministic and separately specified (Sections 5.11, 7.5, 8.4–8.6, 10.3).
6. `payment.created`, order `attempted` transition, event commit ordering, and delivery enqueue ordering are explicitly mapped (Sections 8.4, 11.1, 21.1).
7. Delivery status/outcome classifications distinguish pre-send payload rejection from oversized receiver response and include graceful-shutdown interruption semantics (Sections 11.6–11.11, 13.6–13.7, 17).
8. Aggregate eviction preserves idempotency and all referential integrity edges; reset clears all vaults and queues (Sections 13.8, 14).
9. The order amount cap, manual retry cap, unsupported prefill fields, deterministic option validation, and missing error codes are now locked (Sections 5.11, 9.8, 11.9, 14, 17).

The complete issue-to-section-to-test mapping is in `PRD_v2.1_RESOLUTION_REGISTER.md`.

## 27.2 PRD v2.2 Follow-up Audit Closure

The v2.1 follow-up audit findings are resolved by these normative contracts:

1. Dashboard control-session exchange is fully specified with request/response schema, one-time token consumption, cookie, CSRF, timeout, and rate-limit behavior (Sections 5.10 and 10.4).
2. Compatibility checkout-session creation is a documented PAYSIM extension with server-side Basic authentication, order ownership validation, payment/session atomicity, idempotency, and a `checkout_url` passed to the browser without exposing the key secret (Sections 5.2, 5.9, 6.3, 9.4, and 9.8).
3. Compatibility secret rotation retains the prior in-memory signing secret only while linked attempts can still require a callback signature; new API authentication immediately rejects the old version (Sections 5.5 and 18.3).
4. Webhook endpoint mode is an explicit required field, is editable under versioned configuration, and is snapshotted into every delivery (Sections 7.9, 10.4, 11.4–11.5, and 13.5–13.6).
5. Canonical events are mode-neutral; deterministic per-delivery serialization creates immutable body snapshots; Retry uses exact bytes and Replay serializes for the selected endpoint's current mode (Sections 11.2, 11.4, 11.9–11.10, and 13.4–13.6).
6. Checkout capability expiry invalidates only the capability, leaves a `created` payment unchanged, and permits session reissue without a new payment attempt or duplicate `payment.created` event (Sections 5.11, 7.5, 8.5, 10.3, 10.8, 13.3, and 17).
7. Compatibility fixtures define the synthetic event envelope; native and compatibility raw-body signatures are verified against exact serialized bytes (Section 11.4 and `fixtures/`).
8. Order ownership, bounded retention, reset scope, delivery interruption, response/payload size classification, and manual retry limits remain explicit and testable (Sections 13–14 and 21).

The detailed issue-to-section-to-acceptance-test mapping is in `PRD_v2.2_RESOLUTION_REGISTER.md`. The v2.1 document is preserved unchanged as `PRD_v2.1_ARCHIVE.md`.

# 28. Glossary

| Term | Meaning in PAYSIM |
|---|---|
| Order | Mock request to collect a fixed INR amount; has its own order lifecycle |
| Payment attempt | One simulated attempt to pay an order |
| Checkout session | Short-lived, single-use local capability for one payment attempt; its token expires after 15 minutes and expiry never changes payment state |
| Checkout iframe handshake | Versioned, nonce-bound exact-origin `postMessage` protocol between developer page and PAYSIM-hosted checkout iframe |
| Canonical event | Mode-neutral immutable domain event before Native or Compatibility webhook serialization |
| Delivery body snapshot | Exact serialized body bytes stored per delivery for byte-identical retry |
| Webhook mode | Endpoint-level choice of Native or Compatibility wire format |
| Secret vault | Ephemeral in-memory storage for raw signing material that must be used to generate HMACs |
| Captured | Terminal simulated state representing a successful mock payment outcome |
| Authorized | Intermediate simulated payment state before capture |
| Pending | Non-terminal payment state waiting for developer-selected resolution |
| Event | Immutable record describing a domain state transition |
| Webhook endpoint | Explicitly registered local receiver URL and event subscription |
| Delivery | Intention to send one event to one endpoint |
| Delivery attempt | One HTTP request attempt for a delivery |
| Retry | Another attempt for the same event/endpoint delivery |
| Replay | New delivery of an existing event to selected endpoint(s) |
| Test secret | PAYSIM-generated secret used only for local simulated signatures |
| Compatibility adapter | PAYSIM implementation of a documented subset of Razorpay-style API/checkout patterns |
| Loopback | The local machine's own interface, typically `127.0.0.1` or `::1` |
| Idempotency | Repeating the same logical request without creating duplicate resources or transitions |
| Raw body | Exact bytes received/sent over HTTP before JSON parsing or re-serialization |
| Session-only storage | In-memory data cleared when PAYSIM server stops or session reset occurs |

---

# 29. Final Product Statement

PAYSIM is a local-first payment workflow simulator and webhook testing tool for developers. Its MVP provides a Native API, a scoped Razorpay-style compatibility adapter, a local simulated checkout, deterministic payment state transitions, signed webhook delivery to explicitly authorized loopback endpoints, event inspection, bounded retry/replay, and copy-ready integration examples.

PAYSIM requires no merchant onboarding or KYC because it does not provide financial services or process real payments. It does not connect to banks, UPI, card networks, Razorpay, or any other provider. All credentials, orders, payments, callbacks, events, and webhook signatures generated by PAYSIM are synthetic and local-only.

The product succeeds when a developer can safely reproduce the application-side logic of a payment integration and diagnose webhook behavior before testing against a real provider's official sandbox. PRD v2.1 is the normative specification baseline; it is not a declaration that code, tests, compatibility, or security controls have already been implemented.

---

# 30. Reference Notes

The following public references inform the compatibility boundary and runtime support. PAYSIM's compatibility behavior remains its own contract and must be verified with PAYSIM fixtures rather than inferred from these references.

1. Razorpay API and integration entry points: https://razorpay.com/integrations/
2. Razorpay Orders API examples and payment integration resources: https://razorpay.com/payment-gateway/
3. Razorpay webhook signature, raw-body, delivery, and recovery guidance: https://razorpay.com/blog/payment-gateway-webhooks-india/
4. Razorpay security checklist: https://security.razorpay.com/security/checklist/
5. Node.js official supported release schedule: https://nodejs.org/en/about/previous-releases

**Reference handling rule:** At implementation and each release, re-check the provider's current public documentation for any compatibility assumptions. Do not copy an undocumented behavior into PAYSIM and call it provider-compatible.
