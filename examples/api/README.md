# PAYSIM API Examples

Ready-to-use HTTP request definitions covering the core PAYSIM workflows.

---

## Files

| File | Purpose |
|------|---------|
| [`create-order.http`](./create-order.http) | Credential generation, order creation, order retrieval, and order listing |
| [`simulate-payment.http`](./simulate-payment.http) | Payment attempt initiation, outcome simulation (`success`, `failed`, `pending`), and resolution |
| [`create-webhook.http`](./create-webhook.http) | Registering native and compatibility endpoints, secret rotation |
| [`replay-event.http`](./replay-event.http) | Querying canonical events and replaying events to webhook destinations |
| [`retry-delivery.http`](./retry-delivery.http) | Inspecting delivery attempt history and executing manual/forced retries |

---

## How to Execute

### 1. Using VS Code REST Client

1. Install the **REST Client** extension (`humao.rest-client`).
2. Open any `.http` file in this directory.
3. Replace the placeholder variables:
   - `{{bootstrapToken}}`: Your one-time bootstrap token shown during `npm run dev`.
   - `{{nativeToken}}`: The native API bearer token obtained from `/control/v1/credentials`.
   - `{{orderId}}`, `{{paymentId}}`, `{{endpointId}}`, `{{eventId}}`, `{{deliveryId}}`.
4. Click **Send Request** directly above any request block.

### 2. Using JetBrains HTTP Client (IntelliJ / WebStorm)

Open any `.http` file and click the green **Run** arrow next to the request.

### 3. Using curl

```bash
# Create an order
curl -X POST http://127.0.0.1:8787/api/v1/orders \
  -H "Authorization: Bearer <your-native-token>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50000, "currency": "INR"}'
```

### 4. Using Windows PowerShell

```powershell
$headers = @{
  "Authorization" = "Bearer <your-native-token>"
  "Content-Type"  = "application/json"
}
$body = '{"amount": 50000, "currency": "INR"}'
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/v1/orders" -Method Post -Headers $headers -Body $body
```
