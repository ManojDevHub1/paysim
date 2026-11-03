# PAYSIM Sample Webhook Receiver

A minimal, zero-dependency Node.js webhook receiver demonstrating production-grade HMAC-SHA256 signature verification and event deduplication for PAYSIM.

---

## Features

- **Zero Third-Party Dependencies**: Runs strictly on Node.js standard modules (`node:http`, `node:crypto`).
- **Raw-Byte Buffering**: Computes HMAC over the unparsed request byte stream, avoiding JSON serialization discrepancies.
- **Constant-Time Verification**: Uses `crypto.timingSafeEqual` to prevent timing attacks against signature comparison.
- **Dual Format Support**:
  - **Native PAYSIM**: Reads `X-PaySim-Signature: sha256=<hex>` on `/webhook`.
  - **Razorpay Compat**: Reads `X-Razorpay-Signature: <hex>` on `/compat/webhook`.
- **In-Memory Deduplication**: Tracks processed event IDs to safely acknowledge duplicate webhook deliveries with `200 OK`.
- **Interactive Event Log**: Inspect all received events via `http://127.0.0.1:9001/events`.

---

## Quick Start

### 1. Start the Receiver

From this directory:

```bash
node server.mjs
```

Or using npm:

```bash
npm start
```

By default, the receiver listens on `http://127.0.0.1:9001` with the default signing secret:
`sample_secret_key_1234567890abcdef`.

### 2. Custom Secret or Port

To match a specific secret generated in PAYSIM:

**Windows PowerShell:**
```powershell
$env:PORT="9001"
$env:WEBHOOK_SECRET="your_webhook_signing_secret_here"
npm start
```

**Windows Command Prompt (cmd.exe):**
```cmd
set PORT=9001
set WEBHOOK_SECRET=your_webhook_signing_secret_here
npm start
```

**macOS / Linux:**
```bash
PORT=9001 WEBHOOK_SECRET="your_webhook_signing_secret_here" npm start
```

---

## Register in PAYSIM

### Via PAYSIM Dashboard (`http://127.0.0.1:5173`)

1. Open the **Webhooks** view.
2. Click **Create Webhook Endpoint**.
3. Set:
   - **URL**: `http://127.0.0.1:9001/webhook`
   - **Mode**: `native`
   - **Events**: `*` (or specific events like `payment.captured`)
   - **Secret**: `sample_secret_key_1234567890abcdef`
4. Click **Create Endpoint**.

### Via PAYSIM API

```http
POST http://127.0.0.1:8787/api/v1/webhook-endpoints
Authorization: Bearer <your-native-bearer-token>
Content-Type: application/json

{
  "url": "http://127.0.0.1:9001/webhook",
  "mode": "native",
  "events": ["payment.captured", "payment.failed"],
  "secret": "sample_secret_key_1234567890abcdef",
  "description": "Local test receiver"
}
```

---

## Testing Webhook Delivery

1. Create an Order in PAYSIM:
   `POST http://127.0.0.1:8787/api/v1/orders` with `{"amount": 50000, "currency": "INR"}`
2. Initiate a Payment Attempt:
   `POST http://127.0.0.1:8787/api/v1/orders/:id/payment-attempts`
3. Simulate Payment Success:
   `POST http://127.0.0.1:8787/api/v1/payments/:id/simulate` with `{"outcome": "success"}`
4. Observe the terminal output in this receiver window:
   - Signature verification: `✅ Signature successfully verified with HMAC-SHA256`
   - Event details: `payment.captured`
5. Inspect received events in your browser:
   `http://127.0.0.1:9001/events`
