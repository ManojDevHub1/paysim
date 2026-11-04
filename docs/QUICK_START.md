# PAYSIM — Developer Quick Start Guide

Welcome to **PAYSIM** — the local-first payment gateway simulator and webhook testing laboratory.

This guide walks you through the entire developer journey in 12 simple steps: from cloning the repository to creating orders, simulating payment transitions, receiving authentic HMAC-signed webhooks through the local loopback interface, and verifying cryptographic HMAC-SHA256 signatures.

---

## Prerequisites

- **Node.js**: `v24.0.0` or higher (`node -v`)
- **npm**: `v10.0.0` or higher (`npm -v`)
- **Operating System**: Windows 11, macOS, or Linux
- **No external accounts, API keys, or cloud databases required.**

---

## 1. Clone & Install Dependencies

Clone the repository and install all workspace packages:

```bash
git clone https://github.com/ManojDevHub1/paysim.git
cd paysim
npm install
```

---

## 2. Verify Your Environment

Run PAYSIM Doctor to ensure your runtime, dependencies, build artifacts, and loopback networking are in a healthy state:

```bash
npm run doctor
```

All checks should display `[PASS]`.

---

## 3. One-Command Application Startup

Start both the API backend and the developer dashboard with a single command:

```bash
npm run dev
```

You will see the startup banner in your terminal:

```text
========================================================================
  PAYSIM — Local Payment Gateway Simulator & Webhook Testing Laboratory
  Version: 1.0.0 | Runtime: Node.js v24.x | Platform: win32
========================================================================

  Frontend Dashboard   : http://127.0.0.1:5173
  Backend API Server   : http://127.0.0.1:8787
  Health Check Endpoint: http://127.0.0.1:8787/health
  Webhook Confinement  : http://127.0.0.1:[1024-65535] (loopback only)

  Press Ctrl+C to terminate all services cleanly.
========================================================================

+----------------------------------------------------------------------+
|  [SECURITY] Bootstrap Control Token (one-time terminal disclosure):  |
|  ps_ctrl_bootstrap_...                                               |
|  Notice: This token is never written to disk or configuration files. |
+----------------------------------------------------------------------+
```

> [!NOTE]
> The **Bootstrap Control Token** is generated securely in-memory and printed once to terminal stdout (SET-02/SET-03). It is never saved to disk or `.env` files.

---

## 4. Open the Developer Dashboard

In your browser, navigate to:

👉 **[http://127.0.0.1:5173](http://127.0.0.1:5173)**

The dashboard connects directly to the Express backend running on `http://127.0.0.1:8787` (via Vite proxy).

---

## 5. Start the Sample Webhook Receiver

Open a **second terminal window** and run the included sample webhook receiver:

```bash
cd examples/node-webhook-receiver
npm start
```

The sample receiver will start on `http://127.0.0.1:9001` with default signing secret:
`sample_secret_key_1234567890abcdef`.

---

## 6. Register your Webhook Endpoint

### In the Dashboard:
1. Navigate to the **Webhooks** view (`http://127.0.0.1:5173/webhooks`).
2. Click **Create Webhook Endpoint**.
3. Fill in:
   - **Endpoint URL**: `http://127.0.0.1:9001/webhook`
   - **Mode**: `native`
   - **Subscribed Events**: Select `payment.captured` and `payment.failed` (or enter `*` for all).
   - **Secret**: `sample_secret_key_1234567890abcdef`
   - **Description**: `Local Sample Receiver`
4. Click **Create Endpoint**.

### Or via curl / HTTP:
```bash
# Windows PowerShell
$headers = @{
  "Authorization" = "Bearer ps_native_live_key_..."
  "Content-Type"  = "application/json"
}
$body = @{
  url = "http://127.0.0.1:9001/webhook"
  mode = "native"
  events = @("payment.captured", "payment.failed")
  secret = "sample_secret_key_1234567890abcdef"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/v1/webhook-endpoints" -Method Post -Headers $headers -Body $body
```

---

## 7. Create an Order

### In the Dashboard:
1. Navigate to the **Orders** view (`http://127.0.0.1:5173/orders`).
2. Click **Create Order**.
3. Set **Amount** to `50000` (₹500.00) and **Currency** to `INR`.
4. Click **Create Order**.

### Or via API:
```bash
curl -X POST http://127.0.0.1:8787/api/v1/orders \
  -H "Authorization: Bearer <your-native-token>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50000, "currency": "INR"}'
```

---

## 8. Initiate a Payment Attempt

1. Under the created Order in the dashboard, click **Create Payment Attempt**.
2. Select Payment Method: `Mock Card` or `Mock UPI`.
3. The payment is created in `attempted` state with a unique `pay_ps_...` identifier.

---

## 9. Simulate a Payment Outcome

1. Select the Payment Attempt in the dashboard.
2. Under the **Simulation Lab** panel, choose an outcome:
   - `success` $\to$ Captures the payment and transitions Order to `paid`.
   - `failed` $\to$ Marks the payment attempt as `failed` with a selected reason.
   - `pending` $\to$ Leaves the payment in pending state for asynchronous resolution.
3. Click **Simulate Outcome**.

---

## 10. Observe Webhook Dispatch & Verification

Switch to your **Sample Webhook Receiver** terminal. You will immediately see:

```text
------------------------------------------------------------
[RECEIVER] Webhook request received on /webhook
[RECEIVER] Payload size: 412 bytes
[RECEIVER] Signature Header (x-paysim-signature): sha256=a8f4c...
[RECEIVER] ✅ Signature successfully verified with HMAC-SHA256
[RECEIVER] 📦 Event Processed:
           - Event ID : evt_ps_99f2e...
           - Type     : payment.captured
           - Object   : ID=pay_ps_12a7..., Amount=50000
```

The receiver verified the signature over the raw body bytes using constant-time comparison (`crypto.timingSafeEqual`).

---

## 11. Inspect Deliveries & Replay Events

### In the Dashboard:
1. Navigate to **Deliveries** (`http://127.0.0.1:5173/deliveries`).
2. View the delivery record:
   - Status: `succeeded`
   - HTTP Status: `200`
   - Latency: `< 20ms`
   - Secret Version: `1`
3. Click **Inspect Payload** to view the exact canonical JSON bytes dispatched over the wire.
4. Click **Replay Event** to re-dispatch the exact canonical event to all registered endpoints.

---

## 12. Clean Shutdown

In your `npm run dev` terminal, press:

`Ctrl + C`

PAYSIM cleanly stops the Webhook Engine worker pool, flushes pending state, closes the HTTP listener, and terminates child process trees on Windows and POSIX without leaving orphan background processes:

```text
[paysim] Shutting down services...
[paysim] All services stopped cleanly.
```
