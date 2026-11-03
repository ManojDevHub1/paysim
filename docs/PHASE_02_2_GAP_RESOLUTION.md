# PAYSIM — Phase 02.2 Final Technical Gap Resolution Specification

**Document Version:** 1.0.0  
**Phase:** Phase 02.2 — Final Technical Gap Resolution  
**Status:** Complete & Approved  
**Current Normative Baseline:** PRD v2.3.0 (`docs/PRD_v2.3.md`)  
**Auditor & Lead Architect:** Principal Software Architect and Security Engineer  
**Date:** 3 November 2026  

---

## 1. Executive Summary & Purpose

This specification provides the definitive engineering and cryptographic resolution for the final set of technical gaps identified during the independent architecture review of PAYSIM.

It resolves six core technical domains:
1. **Checkout Authentication & Lifecycle:** Detailed sequence of capability exchange, parent-memory capability ownership, iframe reload recovery, access-token expiration, session revocation, and concurrency control with concrete HTTP request/response DTOs.
2. **Compatibility Secret Lifecycle & Callback Signing:** Strict, atomic 6-step execution ordering ensuring old credential versions remain accessible only for authorized pending operations.
3. **Payment and Event Atomicity:** Capacity reservation, entity mutations, event generation, idempotency caching, and asynchronous webhook dispatching with deterministic failure modes.
4. **Webhook Overflow & Concurrency Boundaries:** Queue saturation, storage saturation, process shutdown interruption, and active retry collision prevention.
5. **Loopback Security & Network Confinement:** Strict IP parser specifications, port validation, anti-SSRF protections, and realistic threat boundaries.
6. **Environment Compatibility Matrix:** Native Windows, macOS, Linux, Docker, and WSL2 supported configurations versus unsupported network topologies.

---

## 2. Checkout Authentication & Lifecycle Architecture

### 2.1 Parent-Memory Capability Ownership & Iframe Reload Recovery

```mermaid
sequenceDiagram
    autonumber
    actor DevApp as Developer Web Application (http://127.0.0.1:3000)
    participant Shim as window.Razorpay Shim (Parent Context)
    participant Iframe as PAYSIM Checkout Iframe (http://127.0.0.1:8787)
    participant Server as PAYSIM Local Server
    participant Vault as TokenVault & SessionStore

    Note over DevApp,Shim: Shim initialized with options: { key, order_id, checkout_url }
    Note over Shim: Parent JS retains checkout_url#opaqueToken in window memory
    DevApp->>Shim: rzp.open()
    Shim->>Iframe: Mounts <iframe> pointing to checkout_url#opaqueToken
    
    Note over Iframe: Extracts opaqueToken from fragment; scrubs URL bar immediately
    Iframe->>Server: POST /checkout/chk_ps_001/exchange { capabilityToken }
    Server->>Vault: Validate hash(capabilityToken) & TTL (15m)
    Vault-->>Server: Token Valid & Active (Lock acquired)
    Server->>Vault: Mark session consumedAt; Store sessionAccessToken
    Server-->>Iframe: 200 OK { sessionAccessToken, nonce, expiresAt }
    
    Note over Iframe: Iframe retains sessionAccessToken in process memory
    Iframe->>DevApp: postMessage(paysim.checkout.hello, targetOrigin: parentOrigin)
    DevApp->>Iframe: postMessage(paysim.checkout.ready, { nonce })

    opt Developer Reloads Iframe or Re-opens Modal (Same Session)
        DevApp->>Shim: rzp.open() (Re-instantiates <iframe> with checkout_url#opaqueToken)
        Iframe->>Server: POST /checkout/chk_ps_001/exchange { capabilityToken }
        Server->>Vault: Validate hash(capabilityToken) & TTL (15m)
        Note over Server: Idempotent Check: Session already consumedAt, but payment is created & unexpired
        Server-->>Iframe: 200 OK { sessionAccessToken (Re-issued/Active), nonce, expiresAt }
        Note over Iframe: Iframe seamlessly recovers session without payment reset or duplicate events
    end
```

#### Exact Request and Response Specifications:

##### 1. Capability Token Exchange Request
```http
POST /checkout/chk_ps_001/exchange HTTP/1.1
Host: 127.0.0.1:8787
Origin: http://127.0.0.1:8787
Content-Type: application/json
Accept: application/json

{
  "capabilityToken": "cap_ps_live_8f3a2b1c9e4d5f6a7b8c9d0e1f2a3b4c"
}
```

##### 2. Successful Exchange Response (200 OK)
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Referrer-Policy: no-referrer
Set-Cookie: paysim_chk_session=sat_ps_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a; Path=/checkout/chk_ps_001; SameSite=Lax; HttpOnly

{
  "simulated": true,
  "data": {
    "sessionId": "chk_ps_001",
    "paymentId": "pay_ps_001",
    "orderId": "ord_ps_001",
    "amount": 129900,
    "currency": "INR",
    "parentOrigin": "http://127.0.0.1:3000",
    "sessionAccessToken": "sat_ps_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
    "nonce": "nce_ps_9a8b7c6d5e4f3a2b",
    "expiresAt": "2026-11-03T03:30:00.000Z"
  }
}
```

##### 3. Repeated Exchange / Recovery Behavior
* If the request is repeated with the **identical valid capability token** for an **unexpired, non-terminal payment attempt**, the server returns `200 OK` with the active `sessionAccessToken` (or a fresh access token bound to the remaining session TTL).
* If repeated after **session expiration (15m)**: returns `410 CHECKOUT_SESSION_EXPIRED`.
* If repeated after **payment attempt is terminal** (`captured`, `failed`, `cancelled`): returns `409 PAYMENT_ALREADY_TERMINAL`.
* If token is invalid or tampered: returns `401 CHECKOUT_TOKEN_INVALID`.

##### 4. Internal Iframe API Request using Bearer Authentication
```http
POST /checkout/chk_ps_001/simulate HTTP/1.1
Host: 127.0.0.1:8787
Origin: http://127.0.0.1:8787
Authorization: Bearer sat_ps_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a
Content-Type: application/json

{
  "outcome": "success"
}
```

##### 5. Concurrent Exchange Handling
All exchange requests for a given `sessionId` synchronize on an in-memory lock: `AsyncLock.acquire("session_exchange:" + sessionId)`. The first thread processes token consumption; subsequent concurrent threads inspect the committed session state and return the active `sessionAccessToken` without token collision.

---

## 3. Compatibility Secret Lifecycle & Callback Signing

To ensure cryptographic integrity and eliminate race conditions between payment state commits and secret rotations, the Compatibility Payment Simulator enforces a strict 6-step pipeline:

```mermaid
flowchart TD
    Start([Simulation Command: Success]) --> Step1[Step 1: Validate Payment Operation & Lock Order Mutex]
    Step1 --> CheckCred{Check Payment's Pinned Credential Version}
    CheckCred --> Step2[Step 2: Generate Compatibility Callback Signature]
    
    Step2 --> SecretCheck{Raw Secret in Vault?}
    SecretCheck -- No --> FailClosed[Fail Closed: 500 CREDENTIAL_VERSION_UNAVAILABLE\nRelease Mutex; Payment Remains Unchanged]
    SecretCheck -- Yes --> ComputeHMAC[Compute HMAC-SHA256: order_id + '|' + payment_id]
    
    ComputeHMAC --> Step3[Step 3: Complete Payment & Order State Transition]
    Step3 --> CommitState[Atomic Commit: Payment captured; Order paid; Session revoked]
    
    CommitState --> Step4[Step 4: Emit Canonical Domain Events]
    Step4 --> CommitEvents[Append payment.authorized, payment.captured, order.paid]
    
    CommitEvents --> Step5[Step 5: Perform Secret Retention Evaluation]
    Step5 --> ActiveCheck{Any other non-terminal attempt\npinned to this key version?}
    
    ActiveCheck -- Yes --> RetainSecret[Retain Raw Secret in CompatSecretVault]
    ActiveCheck -- No --> VersionCheck{Is this the current active key version?}
    VersionCheck -- Yes --> RetainSecret
    VersionCheck -- No --> Step6[Step 6: Best-Effort Zeroization: buffer.fill-0 & Evict]
    
    RetainSecret --> Finish([Release Mutex; Trigger Asynchronous Webhook Dispatch])
    Step6 --> Finish
```

### Exact 6-Step Execution Sequence:
1. **Validate Payment Operation:** Acquire order-level mutex (`AsyncLock.acquire(orderId)`). Verify that payment is in `created` or `pending` state and order is `attempted`. Retrieve the payment's pinned `(compatibilityCredentialId, compatibilityCredentialVersion)`.
2. **Generate Compatibility Callback Signature:** Lookup raw secret buffer in `CompatibilitySecretVault`. If the secret buffer is missing, **halt immediately**: release mutex and return `500 CREDENTIAL_VERSION_UNAVAILABLE`. Payment state mutation does **not** occur. If present, compute `HMAC-SHA256(secretBuffer, order_id + "|" + payment_id)`.
3. **Complete Payment State Transition:** Atomically mutate payment status to `captured` and parent order to `paid`. Mark active checkout session as `revokedAt = now()`. Commit entities to repositories.
4. **Emit Domain Events:** Construct `payment.authorized`, `payment.captured`, and `order.paid` canonical events. Append to `EventRepository`.
5. **Perform Secret Retention Evaluation:** Query `PaymentRepository` for any remaining non-terminal attempts (`created`, `pending`, `authorized`) pinned to this credential version.
6. **Best-Effort Zeroization:** If no non-terminal payment attempts reference this version AND this version is not the current active key, execute `secretBuffer.fill(0)` and remove the entry from `CompatibilitySecretVault`. Release mutex.

---

## 4. Payment and Event Atomicity & Failure Modes

### 4.1 Synchronous In-Process Transaction Boundaries

```text
[HTTP Request: POST /payments/:id/simulate]
   │
   ▼
[Acquire AsyncLock(orderId)] ─────────────────────────────────────────────────────────────┐
   │                                                                                      │
   ├─► 1. Pre-Commit Capacity Reservation                                                │
   │      - RetentionCoordinator.reserveCapacity({ payments: 0, events: 3, idempotency: 1 })│
   │      - If full & unevictable ──► ABORT: Return 429 RESOURCE_LIMIT_REACHED            │
   │                                                                                      │
   ├─► 2. State Invariant & Transition Validation                                        │
   │      - If invalid state transition ──► ABORT: Return 409 INVALID_STATE_TRANSITION    │
   │      - If order already paid ──► ABORT: Return 409 ORDER_ALREADY_PAID               │
   │                                                                                      │
   ├─► 3. Atomic Entity Mutation                                                          │
   │      - Payment.status = "captured"; Order.status = "paid"; Session.revokedAt = now()│
   │                                                                                      │
   ├─► 4. Canonical Event Construction & Freezing                                         │
   │      - Construct payment.authorized, payment.captured, order.paid                    │
   │      - Object.freeze() all event payloads                                           │
   │                                                                                      │
   ├─► 5. Repository & Vault Commit                                                       │
   │      - OrderRepository.save(), PaymentRepository.save()                              │
   │      - EventRepository.saveBatch([evt1, evt2, evt3])                                 │
   │      - IdempotencyStore.saveSnapshot(key, tokenFreeResponse)                         │
   │                                                                                      │
   └─► 6. Secret Retention & Zeroization Sweep (if applicable)                            │
[Release AsyncLock(orderId)] ─────────────────────────────────────────────────────────────┘
   │
   ├─► [Return HTTP 200 OK Response to Client]
   │
   ▼
[Post-Commit Asynchronous Phase: Webhook Dispatcher]
   - Evaluates active subscriptions per endpoint
   - Enqueues delivery jobs to Bounded Queue (Max 100)
   - Note: Webhook queue failure NEVER rolls back the committed domain state!
```

### 4.2 Deterministic Failure Mode Invariants:
* **Queue Saturation:** If the outbound delivery queue has 100 jobs, the Webhook Dispatcher marks the delivery as `rejected` with `rejectionCode = "DELIVERY_QUEUE_FULL"`. The payment remains `captured`, the order remains `paid`, and events remain committed.
* **Event Storage Exhaustion:** If event storage hits 2,000 records and no completed aggregates can be safely evicted, the pre-commit capacity reservation fails closed with `429 RESOURCE_LIMIT_REACHED`. Zero entities are mutated.
* **Concurrent Payment Captures:** Two concurrent requests targeting the same `orderId` serialize on `AsyncLock(orderId)`. The first commits the capture. The second enters the lock, detects order status is already `paid`, and returns `409 ORDER_ALREADY_PAID` (or cached snapshot if idempotency key matches). Double capture is impossible.

---

## 5. Webhook Overflow & Concurrency Boundaries

| Scenario | System State / Trigger | Deterministic Behavior | Resulting Delivery Status | Impact on Payment State |
|---|---|---|---|---|
| **Delivery Queue Full** | Queue contains 100 pending jobs | Creates `WebhookDelivery` record with `rejectionCode = "DELIVERY_QUEUE_FULL"`. No network socket opened. | `rejected` | Payment remains `captured`; Order remains `paid` |
| **Event Storage Full** | 2,000 events reached and all in active retention | Pre-mutation capacity check fails closed with `429 RESOURCE_LIMIT_REACHED`. | `[No Delivery Created]` | Payment command rejected; Zero mutations occur |
| **Delivery Storage Full** | 5,000 deliveries reached | `RetentionCoordinator` evicts oldest completed deliveries. If all 5,000 are in-flight/retryable, fails with `429 RESOURCE_LIMIT_REACHED`. | `rejected` | Payment remains `captured`; Order remains `paid` |
| **Process Shutdown During Delivery** | SIGINT/SIGTERM received while HTTP socket in-flight | Socket aborted immediately via `AbortController`. Attempt outcome marked `interrupted_unknown`. | `interrupted` | Payment remains `captured`; Never falsely marked succeeded |
| **Concurrent Manual Retry** | User clicks Manual Retry while an attempt is `delivering` | Delivery lock `AsyncLock("delivery:" + id)` detects active attempt. Rejects call with `409 ACTIVE_DELIVERY_ATTEMPT_IN_PROGRESS`. | `delivering` (Unchanged) | Prevents parallel socket execution on same delivery |

---

## 6. Loopback Security & Network Confinement

### 6.1 Strict IP Parsing Specifications
Outbound webhook destination URLs are evaluated against a strict canonical grammar:
`^http://(127\.0\.0\.1|\[::1\]):([1-9][0-9]{3,4})(/[a-zA-Z0-9_\-\./]*)$`

* **Strict IPv4 Rules:**
  - Matches **only** literal dotted-decimal `127.0.0.1`.
  - Non-canonical encodings are strictly rejected:
    - Hexadecimal (`http://0x7f.0.0.1:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
    - Octal (`http://0177.0.0.1:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
    - Dword / Integer (`http://2130706433:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
    - Shortened forms (`http://127.1:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
* **Strict IPv6 Rules:**
  - Matches **only** bracketed literal `[::1]`.
  - IPv4-mapped IPv6 (`http://[::ffff:127.0.0.1]:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
  - Zone identifiers (`http://[::1%eth0]:3000`) $\rightarrow$ `422 WEBHOOK_URL_REJECTED`
* **Hostname Policy:**
  - `localhost`, `*.localhost`, `.local`, and all DNS hostnames $\rightarrow$ STRICTLY REJECTED.
  - Eliminates DNS rebinding vulnerabilities where a remote domain resolves to `127.0.0.1` at send time.
* **Port Validation & Restricted Ports:**
  - Port is mandatory and must be an integer between `1024` and `65535`.
  - Well-known system ports (`<1024`) are rejected.
  - PAYSIM's own listening port (`8787`) and Vite port (`5173`) are rejected to prevent delivery loops.
  - Standard sensitive daemon ports (e.g. `2375/2376` Docker daemon, `5000` Docker registry, `4243` cloud agents) are rejected.
* **Transport Protections:**
  - Scheme is restricted to plain `http` (local loopback does not require TLS).
  - Outbound client enforces `redirect: 'manual'`; 3xx responses are marked `redirect_rejected` and never followed.
  - Outbound client strictly ignores ambient `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` environment variables.

> [!WARNING]
> **SSRF Threat Boundary Disclaimer:**  
> Loopback restriction prevents PAYSIM from being used to attack remote web targets or private LAN subnets. However, because PAYSIM delivers to local host ports, it connects to loopback services running on the developer's machine. PAYSIM does not guarantee total protection against malicious local services if a developer registers a sensitive local port. Control Plane authentication and CSRF protections prevent unauthorized third-party scripts from registering endpoints.

---

## 7. Environment Compatibility Matrix

| Environment | Supported? | Networking Setup & Requirements | Notes / Remediation |
|---|---|---|---|
| **Windows Native (Win 11)** | **YES** | Native Node.js 24/26 LTS; Loopback `127.0.0.1:8787` | Primary platform; PowerShell commands supported |
| **macOS (Sonoma/Sequoia)** | **YES** | Native Node.js 24/26 LTS; Loopback `127.0.0.1:8787` | Apple Silicon & Intel supported natively |
| **Linux (Ubuntu, Debian, Fedora)**| **YES** | Native Node.js 24/26 LTS; Loopback `127.0.0.1:8787` | Standard systemd / terminal support |
| **Docker Host Mode** | **YES** | PAYSIM on Host; Webhook Receiver in Docker container | Receiver must publish port to host: `-p 127.0.0.1:3000:3000`. Register as `http://127.0.0.1:3000/...` |
| **WSL2 (Windows Subsystem for Linux)**| **YES** | PAYSIM on Windows host; Receiver in WSL2 (or vice versa)| Receiver must use `localhostForwarding=true` in `.wslconfig` or `netsh interface portproxy` |
| **Docker Virtual Bridge (`172.17.x.x`)**| **NO** | Direct addressing of container bridge IPs | **REJECTED**: Violates loopback SSRF confinement policy |
| **LAN Cross-Machine (`192.168.x.x`)**| **NO** | Addressing devices across local Wi-Fi / Ethernet | **REJECTED**: PAYSIM is local-first; LAN routing is disabled |
| **Public Tunnels (ngrok, Cloudflare)**| **NO** | Tunneling loopback to public URLs | **REJECTED**: Public WAN endpoints are rejected |
| **Non-Loopback Server Bind (`0.0.0.0`)**| **NO** | Binding PAYSIM listener to public interface | **FATAL**: Server process immediately halts on startup |

---

## 8. Conclusion

All six technical gap domains have been fully specified with deterministic state logic, cryptographic boundaries, and failure invariants. The PAYSIM design is formally closed and sealed for Phase 03 foundation engineering.
