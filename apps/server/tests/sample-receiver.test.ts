import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createApplicationContext } from '../src/application/index.js';

describe('Sample Webhook Receiver Integration (Phase 03.7)', () => {
  const TEST_PORT = 9005;
  const SECRET = 'sample_secret_key_1234567890abcdef';
  let receiverServer: http.Server;
  const receivedRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown>;
    verified: boolean;
  }> = [];

  beforeAll(async () => {
    // Start sample receiver logic directly on TEST_PORT
    receiverServer = http.createServer(async (req, res) => {
      const isNative = req.url === '/webhook';
      const sigHeader = isNative ? req.headers['x-paysim-signature'] : req.headers['x-razorpay-signature'];

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks);

      let verified = false;
      if (sigHeader) {
        const sigHex = (isNative ? (sigHeader as string).replace('sha256=', '') : (sigHeader as string)).trim();
        const computed = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
        if (sigHex.length === computed.length) {
          verified = crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(computed, 'hex'));
        }
      }

      if (!verified) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ verified: false, error: 'UNAUTHORIZED' }));
        return;
      }

      const body = JSON.parse(rawBody.toString('utf8'));
      receivedRequests.push({ headers: req.headers, body, verified });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, verified: true }));
    });

    await new Promise<void>((resolve) => {
      receiverServer.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      receiverServer.close(() => resolve());
    });
  });

  it('receives and verifies authentic PAYSIM webhook deliveries', async () => {
    const appContext = createApplicationContext({
      runtimeConfig: {
        backendPort: 8787,
        frontendPort: 5173,
      },
      autoStartEngine: true,
    });
    const app = createApp(appContext);
    const nativeToken = appContext.control.getActiveNativeToken()!;

    // Register receiver endpoint
    const endpointRes = await request(app)
      .post('/api/v1/webhook-endpoints')
      .set('Authorization', `Bearer ${nativeToken}`)
      .send({
        url: `http://127.0.0.1:${TEST_PORT}/webhook`,
        mode: 'native',
        events: ['payment.captured'],
        secret: SECRET,
        description: 'Automated Test Receiver',
      });

    expect(endpointRes.status).toBe(201);

    // Create Order and successful payment
    const order = await appContext.orders.createOrder({ request: { amount: 25000, currency: 'INR' } });
    const attempt = await appContext.payments.createPaymentAttempt({
      orderId: order.id,
      request: { method: 'mock_card', parentOrigin: 'http://localhost:3000' },
    });
    await appContext.payments.simulateOutcome({ paymentId: attempt.id, request: { outcome: 'success' } });

    // Wait for delivery to succeed
    const maxWaitMs = 5000;
    const start = Date.now();
    let delivered = false;

    while (Date.now() - start < maxWaitMs) {
      if (receivedRequests.length > 0) {
        delivered = true;
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    expect(delivered).toBe(true);
    expect(receivedRequests[0].verified).toBe(true);
    expect(receivedRequests[0].body.type).toBe('payment.captured');
    expect(receivedRequests[0].headers['x-paysim-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    await appContext.engine.stop();
  });

  it('rejects tampered or unauthenticated webhook deliveries with 401', async () => {
    // Direct HTTP call to receiver with wrong secret
    const tamperedPayload = Buffer.from(JSON.stringify({ type: 'payment.captured', id: 'evt_fake' }));
    const fakeSig = crypto.createHmac('sha256', 'wrong_secret_key_1234567890123456').update(tamperedPayload).digest('hex');

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PaySim-Signature': `sha256=${fakeSig}`,
      },
      body: tamperedPayload,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.verified).toBe(false);
  });
});
