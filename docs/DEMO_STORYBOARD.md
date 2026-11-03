# PAYSIM — 60–90 Second Product Demonstration Storyboard

> **A step-by-step developer walkthrough: Order Creation &rarr; Payment Simulation &rarr; Real Webhook Delivery &rarr; Cryptographic HMAC Verification.**
> **Audience:** Developers, engineering leads, open-source evaluators, and API integrators.
> **Total Runtime:** ~75–90 Seconds.

---

## Storyboard Overview

| Time | Scene | Action / Workflow | Visual / Terminal Output |
|:---|:---|:---|:---|
| **0:00 – 0:15** | **1. One-Command Launch** | Launch PAYSIM development environment | ASCII banner, port check, and bootstrap token disclosure |
| **0:15 – 0:30** | **2. Receiver & Dashboard Setup** | Start sample receiver and register webhook endpoint | Terminal split-screen with receiver listening on `127.0.0.1:9001` |
| **0:30 – 0:45** | **3. Order Creation** | Create order and initiate payment attempt | Order `ord_ps_...` created with `created` state in dashboard |
| **0:45 – 1:05** | **4. Payment Simulation Lab** | Deterministically trigger `success` transition | Atomic state transition: Order &rarr; `paid`, Payment &rarr; `captured` |
| **1:05 – 1:20** | **5. Webhook Delivery & HMAC Check** | Outbound HTTP dispatch to receiver | Receiver logs `X-PaySim-Signature` verification passing |
| **1:20 – 1:30** | **6. Clean Shutdown** | Ctrl+C termination | Clean process-tree exit with zero orphan processes |

---

## Detailed Scene-by-Scene Script

### Scene 1: One-Command Launch (0:00 – 0:15)

**Narrative / Action**:
Developer opens a terminal in the cloned repository and runs the unified dev command:

```bash
npm run dev
```

**What the Screen Shows**:
- Pre-flight port availability validation checks ports `8787` (API) and `5173` (Frontend) on `127.0.0.1`.
- The PAYSIM ASCII startup banner appears:
  ```text
  ========================================================================
    PAYSIM — Local Payment Gateway Simulator & Webhook Testing Laboratory
    Version: 1.0.0 | Runtime: Node.js v24.22.1 | Platform: win32
  ========================================================================
    Frontend Dashboard   : http://127.0.0.1:5173
    Backend API Server   : http://127.0.0.1:8787
    Health Check Endpoint: http://127.0.0.1:8787/health
    Webhook Confinement  : http://127.0.0.1:[1024-65535] (loopback only)
  ========================================================================
  ```
- A highlighted security disclosure box displays the single-use **Bootstrap Control Token** generated in volatile RAM (SET-02/SET-03).
- Notice confirming zero disk persistence.

---

### Scene 2: Receiver & Dashboard Setup (0:15 – 0:30)

**Narrative / Action**:
In a second terminal, start the included zero-dependency sample webhook receiver:

```bash
cd examples/node-webhook-receiver
npm start
```

**What the Screen Shows**:
- Receiver output:
  ```text
  [RECEIVER] Listening on http://127.0.0.1:9001
  [RECEIVER] Mode: Native (X-PaySim-Signature) & Razorpay Compat (X-Razorpay-Signature)
  [RECEIVER] Ready to receive and verify webhook dispatches...
  ```
- Developer opens **http://127.0.0.1:5173** in the browser.
- The dark fintech dashboard loads immediately with deep slate/charcoal styling (`#080c14`).
- Developer navigates to **Endpoints** (`/webhooks`), clicks **Register Endpoint**, and enters:
  - **URL**: `http://127.0.0.1:9001/webhook`
  - **Mode**: Native PAYSIM
  - **Secret**: `sample_secret_key_1234567890abcdef`
  - **Events**: `payment.captured`, `order.paid`

---

### Scene 3: Order & Payment Creation (0:30 – 0:45)

**Narrative / Action**:
Developer creates an order and payment attempt via the UI or REST client:

```http
POST /api/v1/orders HTTP/1.1
Host: 127.0.0.1:8787
Authorization: Bearer <native-token>
Content-Type: application/json

{
  "amount": 150000,
  "currency": "INR",
  "receipt": "rcpt_demo_001"
}
```

**What the Screen Shows**:
- Order `ord_ps_99182a...` appears in the **Orders** view with status `created`, amount `₹1,500.00`.
- Payment attempt `pay_ps_88219c...` is created for this order with method `mock_card`.

---

### Scene 4: Payment Simulation Lab (0:45 – 1:05)

**Narrative / Action**:
Developer switches to the **Payments** view and expands the **Simulation Lab** drawer:

- Selects **Outcome**: `Success (Capture)`
- Clicks **Execute Simulation**.

**What the Screen Shows**:
- Instant, deterministic state transitions:
  - Payment moves atomically from `created` &rarr; `authorized` &rarr; `captured`.
  - Order moves atomically from `attempted` &rarr; `paid`.
- The **Events** view immediately records canonical domain events:
  - `payment.authorized`
  - `payment.captured`
  - `order.paid`
- Status indicators turn vibrant fintech green (`#22c55e`).

---

### Scene 5: Real Webhook Delivery & HMAC Verification (1:05 – 1:20)

**Narrative / Action**:
The PAYSIM background delivery worker pool (5 concurrent workers) detects the committed event and dispatches an authentic HTTP `POST` request to `http://127.0.0.1:9001/webhook`.

**What the Screen Shows**:
- The **Deliveries** view in the dashboard updates in real time:
  - Shows delivery `del_ps_...` with status `succeeded` (HTTP 200).
  - Clicking the row reveals the raw JSON payload and request headers:
    `X-PaySim-Signature: sha256=c59f2269466ada3d6f10c3221420a4ffa8bc72a576aa138b9228d7bc753d9f37`
- Terminal 2 (Receiver stdout) logs the incoming webhook in real time:
  ```text
  [RECEIVER] POST /webhook (782 bytes)
  [RECEIVER] Received Signature: sha256=c59f2269466ada3d6f10c3221420a4ffa8bc72a576aa138b9228d7bc753d9f37
  [RECEIVER] HMAC-SHA256 Verification: VALID (crypto.timingSafeEqual PASSED)
  [RECEIVER] Event Processed: payment.captured (ID: evt_ps_...)
  [RECEIVER] Responded: 200 OK
  ```

---

### Scene 6: Clean Shutdown (1:20 – 1:30)

**Narrative / Action**:
Developer returns to Terminal 1 and presses `Ctrl+C`.

**What the Screen Shows**:
- PAYSIM traps the termination signal:
  ```text
  [paysim] Shutting down services...
  [paysim] All services stopped cleanly.
  ```
- Both backend (8787) and frontend (5173) ports release immediately.
- Verification confirms zero orphan background processes remain running.

---

## Key Takeaways Demonstrated

1. **Zero External Accounts**: No merchant signup, KYC approval, or credit cards required.
2. **Real Network I/O**: Actual HTTP socket dispatch and HMAC signature verification on localhost.
3. **Dual Wire Compatibility**: Supports both native PAYSIM payloads and Razorpay API compatibility.
4. **Deterministic Testing**: Simulate failures, declines, timeouts, or successes on demand.
5. **Zero Persistent Storage**: In-memory architecture ensures a clean slate whenever restarted.
