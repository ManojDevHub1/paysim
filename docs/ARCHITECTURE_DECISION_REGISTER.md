# PAYSIM — Architecture Decision Register (ADR)

**Document Version:** 1.1.0  
**Status:** Approved Architectural Baseline (Hardened for v2.3.0)  
**Project:** PAYSIM  
**Normative Baseline Specification:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Historical Baseline Reference:** PRD v2.2.0 (`docs/PRD.md`)  
**Last Updated:** November 2026  

---

## Overview

This Architecture Decision Register (ADR) records key architectural and design decisions established during Phase 02 (System Architecture). It captures the context, problem statement, evaluation criteria, chosen option, architectural rationale, and consequences of each critical design choice.

---

## Index of Architecture Decision Records

| ADR ID | Title | Status | Date | Addressed Area |
|---|---|---|---|---|
| **ADR-001** | Dual Interface Architecture over Unified In-Memory Domain Core | Approved | 2026-11-03 | API Architecture |
| **ADR-002** | Resolution of Section 21.1 Checkout Expiry Contradiction vs Locked Decisions | Approved | 2026-11-03 | State Machine & Expiry |
| **ADR-003** | Dual Secret Representation and Ephemeral Vault Lifecycle for Compatibility Keys | Approved | 2026-11-03 | Secret Management |
| **ADR-004** | URL Fragment Capability Transport with One-Time Exchange into HttpOnly Cookie | Approved | 2026-11-03 | Browser Security |
| **ADR-005** | Strict Literal Loopback Policy & Anti-SSRF Confinement | Approved | 2026-11-03 | Webhook Security |
| **ADR-006** | Deterministic Webhook Serialization and Byte-Preserving Delivery Snapshots | Approved | 2026-11-03 | Webhook Engine |
| **ADR-007** | Centralized Retention Coordinator & Aggregate-Safe Cascading Eviction | Approved | 2026-11-03 | Memory Management |
| **ADR-008** | Internal Credential Ownership Binding for Multi-Tenant Compatibility Isolation | Approved | 2026-11-03 | Compatibility Adapter |
| **ADR-009** | Strict Origin-Bound Handshake with Cryptographic Nonce for Checkout Iframe | Approved | 2026-11-03 | Checkout Shim |
| **ADR-010** | Token-Free Idempotency Snapshots & Capability Tombstone Retention | Approved | 2026-11-03 | Idempotency |

---

## ADR-001: Dual Interface Architecture over Unified In-Memory Domain Core

### Status: Approved
**Deciders:** Senior Software Architect, Domain Modeling Team  
**Consulted:** PRD Sections 5.1, 5.2, 9, 10, 15.1  

### Context
PAYSIM must cater to two developer audiences:
1. Developers building new systems who desire a clean, modern, well-branded REST API (`/api/v1`).
2. Developers testing existing integrations written against Razorpay's Orders API and Standard Checkout (`/compat/razorpay/v1`).

### Decision
Implement a single unified domain core (`packages/domain`) shared by two separate protocol adapters (`packages/adapters-native` and `packages/adapters-compat`). The domain layer owns the Order, Payment Attempt, Checkout Session, and Event aggregates. It exposes pure TypeScript domain command handlers (e.g., `createOrder()`, `createPaymentAttempt()`, `simulatePaymentOutcome()`).

### Consequences
- **Positive:** Zero duplication of payment state machines, validation rules, or event emission logic. Complete behavioral parity between Native and Compatibility flows.
- **Positive:** Clear architectural isolation: protocol quirks (HTTP Basic auth, snake_case DTOs, Unix timestamp formatting) remain strictly confined to the compatibility adapter.
- **Negative:** Compatibility requests must be mapped to and from native domain models, requiring translation layers.

---

## ADR-002: Resolution of Section 21.1 Checkout Expiry Contradiction vs Locked Decisions

### Status: Approved
**Deciders:** Senior Software Architect  
**Consulted:** PRD Sections 5.11, 7.5 (PAY-15), 8.4, 8.5 (Rule 12), 10.3, 10.8, 13.3, 17, 21.1, 21.9 (V22-08, V22-09, V22-15); Resolution Register V22-08  

### Context
A text contradiction exists in PRD v2.2.0:
- **Locked Decisions (Sections 5.11, 7.5, 8.4, 8.5, 10.3, 10.8, 13.3, 17, and Resolution Register V22-08):** Version 2.2 explicitly locks that checkout session capability expiry **only invalidates the checkout capability**. It does **not** change payment or order state and emits **no** payment event. A payment attempt that remains in `created` state stays in `created` state. A new checkout session can be issued for that same payment ID without creating a duplicate attempt or duplicate `payment.created` event.
- **Section 21.1 (Unit Tests — Domain, Line 2374):** An unremoved remnant sentence from the older v2.1 draft states: *"Checkout expiry while payment is `created` atomically cancels and emits one `payment.cancelled`; expiry after `pending`/`authorized` does not mutate payment."*

### Decision
The system architecture strictly adheres to the normative locked decisions in **Sections 5.11, 7.5, 8.4, 8.5, 10.3, 10.8, 13.3, 17, and Resolution Register V22-08**:
1. When a 15-minute checkout session capability expires, **payment state remains unchanged**. If the payment was in `created` state, it remains in `created` state.
2. No domain event is emitted upon session expiry.
3. The developer application may call the checkout session reissue route (`POST /api/v1/payments/:id/checkout-sessions` or compatibility extension) to obtain a new checkout session URL referencing the same payment ID.
4. Line 2374 in Section 21.1 is formally classified as a stale textual relic from PRD v2.1 that was superseded by the v2.2 audit closure. The domain unit test suite must test that capability expiry does **not** cancel the payment attempt (as specified in regression test `V22-08`).

### Consequences
- **Positive:** Full consistency across all domain models, state machines, API contracts, error catalogues, and resolution register items.
- **Positive:** Enables developers to safely reopen or reissue checkout sessions without having to restart the entire order-to-payment cycle.
- **Negative:** Requires explicit documentation in this ADR to prevent implementers from building contradictory cancellation logic.

---

## ADR-003: Dual Secret Representation and Ephemeral Vault Lifecycle for Compatibility Keys

### Status: Approved
**Deciders:** Senior Software Architect, Security Engineering  
**Consulted:** PRD Sections 5.5, 7.3 (AUTH-03), 13.2, 13.3, 18.3, 21.9 (V22-03, V22-18)  

### Context
In Razorpay-style integrations, the merchant backend verifies checkout callbacks using `HMAC-SHA256(key_secret, order_id + "|" + payment_id)`. Because PAYSIM simulates this callback from its checkout host, PAYSIM must compute this exact synthetic signature. However, for security best practices, credentials stored on a server should only be stored as one-way salted hashes (e.g. scrypt).

### Decision
Store Compatibility Key Secrets in two distinct representations for two distinct purposes:
1. **Salted scrypt verifier hash:** Stored in the credential repository to authenticate incoming HTTP Basic requests.
2. **Ephemeral Raw Secret Buffer:** Retained exclusively in process memory in a dedicated `CompatibilitySecretVault`, keyed by `(credentialId, version)`.

#### Lifecycle and Rotation Rules:
- When a credential is rotated from version $V_1$ to $V_2$:
  - Incoming HTTP Basic requests using $V_1$ are **immediately rejected** with `401 UNAUTHORIZED`.
  - The raw secret bytes for $V_1$ are retained in `CompatibilitySecretVault` **only** while any payment attempt created under $V_1$ is still in a non-terminal state (`created`, `pending`, `authorized`).
  - Once all payment attempts linked to $V_1$ reach terminal status (`captured`, `failed`, `cancelled`) and their checkout sessions expire, $V_1$ secret bytes are zeroized and purged from memory.
  - Raw secret bytes are never written to disk, exported, logged, or revealed after initial generation.

### Consequences
- **Positive:** Synthetically generated callbacks can be verified by developer backends using standard Razorpay SDK helpers.
- **Positive:** Inbound API access using old/rotated credentials is immediately cut off.
- **Negative:** Memory retention requires careful event-driven lifecycle management via the `RetentionCoordinator`.

---

## ADR-004: URL Fragment Capability Transport with One-Time Exchange into HttpOnly Cookie

### Status: Approved
**Deciders:** Senior Software Architect, Browser Security Team  
**Consulted:** PRD Sections 5.9, 6.3, 9.4, 9.8, 12.6, 21.9 (V22-19, V22-20)  

### Context
When the developer application initializes the checkout modal via `new Razorpay({ checkout_url: "..." })`, the browser page receives a checkout URL. If the capability token is passed in query parameters, it risks leaking via browser history, HTTP referrers, server access logs, and network proxies.

### Decision
1. The checkout capability token is passed strictly in the URL fragment:
   `http://127.0.0.1:8787/checkout/chk_ps_001?parentOrigin=http%3A%2F%2F127.0.0.1%3A3000#<opaque_capability_token>`
2. The URL fragment is never transmitted over the wire in HTTP request headers.
3. The checkout iframe JavaScript reads `window.location.hash`, immediately wipes it using `history.replaceState()`, and performs a one-time same-origin exchange via `POST /checkout/:sessionId/exchange`.
4. On successful exchange, the server issues an `HttpOnly`, `SameSite=Strict` cookie scoped exclusively to `/checkout/:sessionId`.
5. The raw capability token is atomically consumed and purged from the `TokenVault`. Subsequent iframe requests are authenticated via the scoped cookie until the session expires or is revoked.

### Consequences
- **Positive:** Zero token leakage in server access logs, `Referer` headers, or browser address bars.
- **Positive:** Capability token cannot be replayed or stolen by external scripts.
- **Negative:** Requires an initial client-side token exchange step before the iframe checkout UI can render its interactive options.

---

## ADR-005: Strict Literal Loopback Policy & Anti-SSRF Confinement

### Status: Approved
**Deciders:** Senior Software Architect, Security Engineering  
**Consulted:** PRD Sections 5.7, 7.9, 11.7, 12.1, 12.2, 12.3, 12.4, 18.2  

### Context
A developer tool that dispatches outbound HTTP webhooks poses Server-Side Request Forgery (SSRF) risks if an attacker or malicious script can trick the server into probing local networks, cloud metadata services, or host services.

### Decision
Enforce a strict, zero-trust literal loopback policy for all outbound webhook destinations:
1. Accept **only** literal IP URLs with explicit ports:
   `http://127.0.0.1:<port>/<path>` or `http://[::1]:<port>/<path>`.
2. Strictly reject `localhost`, all DNS hostnames, `.local` domains, and alternative numeric IP notations (e.g. `0x7f.1`, `2130706433`).
3. Strictly reject public WAN IPs, private LAN ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local IPs (`169.254.0.0/16`), and cloud metadata IPs (`169.254.169.254`).
4. Reject PAYSIM's own listening ports (`8787` and Vite `5173`) to prevent recursive delivery loops.
5. Re-validate the destination IP immediately before socket connection.
6. Prohibit 3xx HTTP redirect following (record redirect as `redirect_rejected` outcome).
7. Ignore ambient system proxies (`HTTP_PROXY`, `HTTPS_PROXY`).

### Consequences
- **Positive:** Total immunity against DNS rebinding, internal network scanning, and cloud metadata theft.
- **Positive:** Predictable, deterministic local socket connectivity.
- **Negative:** Developers running receivers inside Docker containers must explicitly map ports to host loopback (`-p 127.0.0.1:8080:3000`) rather than pointing PAYSIM to container bridge IPs.

---

## ADR-006: Deterministic Webhook Serialization and Byte-Preserving Delivery Snapshots

### Status: Approved
**Deciders:** Senior Software Architect, Webhook Engine Team  
**Consulted:** PRD Sections 5.8, 11.2, 11.3, 11.4, 11.9, 13.4, 13.6, 21.9 (V22-05, V22-06, V22-07, V22-13, V22-17)  

### Context
Webhook receivers verify authenticity by calculating `HMAC-SHA256(secret, rawBody)`. If the sender re-serializes JSON payloads between retries, differing key ordering, whitespace, or floating-point formatting will cause HMAC verification to fail intermittently on the receiver.

### Decision
1. **Canonical Domain Events are mode-neutral:** Stored in memory as structured, immutable domain objects.
2. **Deterministic Mode Serialization:** At delivery creation time, the serializer corresponding to the endpoint's wire mode (`native` or `compatibility`) executes a deterministic serialization algorithm:
   - Object keys are recursively sorted using UTF-16 code units (`Array.prototype.sort()`).
   - Serialized with compact JSON separators (`:` and `,` with no whitespace).
   - Encoded as raw UTF-8 bytes with no trailing newline.
3. **Byte-Exact Vault Snapshots:** The exact serialized `Buffer` is stored in the `DeliveryBodyVault`.
4. **Retry vs. Replay Invariant:**
   - **Retry:** Reuses the **exact byte buffer** from the delivery snapshot. The bytes sent to the receiver are bit-for-bit identical across all attempts.
   - **Replay:** Serializes the unchanged canonical event anew using the selected endpoint's current mode.

### Consequences
- **Positive:** 100% reliable webhook HMAC verification across retries.
- **Positive:** Perfect conformity with committed byte fixtures (`payment.captured.body.json`).
- **Negative:** Storage requires keeping raw byte buffers in memory alongside delivery metadata.

---

## ADR-007: Centralized Retention Coordinator & Aggregate-Safe Cascading Eviction

### Status: Approved
**Deciders:** Senior Software Architect, Storage Team  
**Consulted:** PRD Sections 5.4, 13.8, 14, 14.1, 21.9 (V22-14)  

### Context
PAYSIM operates strictly in-memory with bounded capacities (e.g. 2,000 orders, 5,000 deliveries). If repositories delete records independently when hitting limits, dangling references (e.g. a delivery referencing an evicted event, or an attempt referencing an evicted order) will corrupt system invariants.

### Decision
Implement a centralized `RetentionCoordinator` that acts as the single authority for all record eviction:
1. **No Independent Deletions:** Individual repositories are prohibited from evicting entities autonomously.
2. **Eviction Protection Rules:** An order aggregate cannot be evicted if:
   - It contains any non-terminal payment attempt (`created`, `pending`, `authorized`).
   - It is referenced by an unexpired idempotency record.
   - Any associated event has an in-flight, queued, or retry-eligible delivery.
3. **Cascading Cascade Sequence:** When an order aggregate is eligible for eviction, deletion proceeds in a strict topological order:
   `TokenVault -> DeliveryBodyVault -> DeliveryAttempts -> WebhookDeliveries -> CanonicalEvents -> TerminalPayments -> ExpiredIdempotency -> Order`.
4. **Fail-Closed on Saturated Safe Storage:** If capacity limits are reached and no eligible records can be safely evicted without breaking references, the server rejects new requests with `429 RESOURCE_LIMIT_REACHED` rather than corrupting memory.

### Consequences
- **Positive:** Zero dangling references or orphaned entities in memory.
- **Positive:** Predictable memory footprint capped at safe bounds.
- **Negative:** Under heavy write loads with long-running uncompleted payments, the server may reject new orders until older transactions complete.

---

## ADR-008: Internal Credential Ownership Binding for Multi-Tenant Compatibility Isolation

### Status: Approved
**Deciders:** Senior Software Architect, Security Engineering  
**Consulted:** PRD Sections 9.4, 13.1, 21.9 (V22-04)  

### Context
Developers may generate multiple local compatibility credentials for testing different applications or environments. Compatibility APIs authenticate using HTTP Basic credentials. If orders are global, one credential could inspect or trigger checkout sessions on another credential's orders.

### Decision
1. Every mock order entity includes an internal field: `ownerCredentialId: string`.
2. When creating an order via `/compat/razorpay/v1/orders`, `ownerCredentialId` is populated with the authenticated PAYSIM Key ID.
3. When creating checkout sessions via `/compat/razorpay/v1/orders/:orderId/checkout-sessions`, PAYSIM validates that the authenticating credential ID matches the order's `ownerCredentialId`.
4. If an order belongs to another credential, the API returns `404 NOT_FOUND` (rather than 403) to prevent resource enumeration.
5. The `ownerCredentialId` field is strictly internal: it is stripped from all public DTOs, API responses, logs, and webhook payloads.

### Consequences
- **Positive:** Multi-credential isolation prevents accidental or malicious cross-test interference.
- **Positive:** Prevents resource ID leakage via 404 response masking.
- **Negative:** Requires an extra authorization lookup step in compatibility controllers.

---

## ADR-009: Strict Origin-Bound Handshake with Cryptographic Nonce for Checkout Iframe

### Status: Approved
**Deciders:** Senior Software Architect, Frontend Security  
**Consulted:** PRD Sections 5.9, 6.3, 12.6, 21.9 (V22-11, V22-12)  

### Context
Cross-window communication between the developer's web application and the PAYSIM-hosted checkout iframe using `postMessage` is vulnerable to message spoofing, clickjacking, and origin confusion if wildcards (`*`) or unvalidated origins are permitted.

### Decision
1. **Server-Bound `parentOrigin`:** When a checkout session is created, the backend explicitly requires and binds an exact loopback `parentOrigin` (e.g. `http://127.0.0.1:3000`).
2. **Strict CSP `frame-ancestors`:** The checkout iframe document is served with a Content Security Policy restricting embedding strictly to that `parentOrigin`:
   `Content-Security-Policy: frame-ancestors http://127.0.0.1:3000;`
3. **Versioned Handshake Protocol:**
   - Iframe emits `paysim.checkout.hello` targeting `parentOrigin`.
   - Parent shim replies with `paysim.checkout.ready` containing the session nonce.
4. **Strict Verification Rules:**
   - Both parent and iframe validate `event.origin` matches the expected peer origin.
   - Both validate that `event.source` matches the peer window.
   - Both validate the message payload against a strict Zod schema including protocol version and cryptographic nonce.
   - All `postMessage` calls specify concrete target origins; wildcard `*` is strictly forbidden.

### Consequences
- **Positive:** Complete protection against cross-origin iframe hijacking and message injection.
- **Positive:** Prevents malicious websites from opening and interacting with local checkout sessions.
- **Negative:** Developers must register and configure exact loopback ports for parent applications.

---

## ADR-010: Token-Free Idempotency Snapshots & Capability Tombstone Retention

### Status: Approved
**Deciders:** Senior Software Architect, Storage & Idempotency  
**Consulted:** PRD Sections 10.6, 13.8, 14, 21.9 (V22-21, V22-22)  

### Context
Idempotency records cache response snapshots for duplicate requests. For payment attempt and checkout session creation, the initial response includes an opaque capability token. If the token is cached in the idempotency store, replaying the idempotency key after the token was consumed or expired could leak a reusable or invalid token.

### Decision
1. **Token-Free Response Snapshots:** Idempotency records for checkout session creation store only token-free metadata (`paymentId`, `checkoutSessionId`, status, timestamps). Raw capability tokens and full URLs are **never** stored in idempotency snapshots.
2. **State-Aware Idempotent Replays:**
   - **While capability is valid and unconsumed:** Repeating the request reconstructs the checkout URL by retrieving the active capability from `TokenVault`.
   - **After capability is consumed:** Repeating the request returns `409 CHECKOUT_SESSION_ALREADY_CONSUMED` with the existing payment/session IDs. It does not mint or reveal a second token.
   - **After session expires:** Repeating the request returns `410 CHECKOUT_SESSION_EXPIRED` with the existing payment ID, directing the caller to the reissue route.
3. **Capability Tombstones:** When a checkout session capability expires or is consumed, the session metadata is retained as a token-free tombstone while the associated idempotency record remains unexpired. This guarantees consistent 409/410 responses without dangling references.

### Consequences
- **Positive:** Eliminates replay attacks and token leakage via cached idempotency payloads.
- **Positive:** Consistent and deterministic error states for repeated client requests.
- **Negative:** Requires state lookups against the session and token vault during idempotency resolution.

---

## Summary of Architectural Commitments

All architectural decisions recorded in this register are locked and binding for the PAYSIM Phase 02 baseline. Any future deviation must be proposed via a formal ADR revision and must uphold PAYSIM's local-first, zero-KYC, and simulation-only tenets.
