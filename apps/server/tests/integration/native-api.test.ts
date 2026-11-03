import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Native API Integration (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let bearerToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);
    bearerToken = appContext.control.getActiveNativeToken()!;
  });

  describe('1. Authentication Gate', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/v1/orders');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid bearer token with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', 'Bearer ps_test_invalid_token_123');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts valid active bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.object).toBe('list');
    });
  });

  describe('2. Orders Lifecycle & Idempotency', () => {
    it('creates an order with 201 Created and retrieves it', async () => {
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          amount: 50000,
          currency: 'INR',
          receipt: 'rcpt_http_101',
          notes: { client: 'integration_test' },
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.id).toMatch(/^ord_ps_/);
      expect(createRes.body.amount).toBe(50000);
      expect(createRes.body.status).toBe('created');

      const orderId = createRes.body.id;

      const getRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(orderId);
      expect(getRes.body.receipt).toBe('rcpt_http_101');
    });

    it('enforces 5-tuple idempotency on order creation', async () => {
      const idempotencyKey = 'idem_native_order_001';
      const payload = {
        amount: 25000,
        currency: 'INR',
        receipt: 'rcpt_idem_1',
      };

      // 1. Initial request
      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);

      // 2. Exact replay returns identical cached body
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(res1.body.id);

      // 3. Payload mismatch with same key returns 409 IDEMPOTENCY_KEY_REUSED
      const res3 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          ...payload,
          amount: 99999, // Mismatched amount
        });

      expect(res3.status).toBe(409);
      expect(res3.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('returns 404 for non-existent order ID', async () => {
      const res = await request(app)
        .get('/api/v1/orders/ord_ps_nonexistent')
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('3. Payments, Simulation & Checkout Session Lifecycle', () => {
    it('creates payment attempt, reissues checkout session, and simulates outcome', async () => {
      // 1. Create Order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 12000, currency: 'INR' });
      const orderId = orderRes.body.id;

      // 2. Create Payment Attempt
      const payRes = await request(app)
        .post(`/api/v1/orders/${orderId}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_card',
          parentOrigin: 'http://localhost:3000',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.id).toMatch(/^pay_ps_/);
      expect(payRes.body.status).toBe('created');
      const paymentId = payRes.body.id;

      // 3. Single active attempt invariant
      const duplicatePayRes = await request(app)
        .post(`/api/v1/orders/${orderId}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_upi',
          parentOrigin: 'http://localhost:3000',
        });

      expect(duplicatePayRes.status).toBe(409);
      expect(duplicatePayRes.body.error.code).toBe('ACTIVE_PAYMENT_ATTEMPT_EXISTS');

      // 4. Reissue Checkout Session
      const sessionRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/checkout-sessions`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ parentOrigin: 'http://localhost:3000' });

      expect(sessionRes.status).toBe(201);
      expect(sessionRes.body.sessionId).toMatch(/^sess_ps_/);
      expect(sessionRes.body.capabilityToken).toBeDefined();

      // 5. Simulate Outcome: Success / Captured
      const simRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/simulate`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ outcome: 'success' });

      expect(simRes.status).toBe(200);
      expect(simRes.body.status).toBe('captured');
      expect(simRes.body.captured).toBe(true);

      // Verify order transitioned to 'paid'
      const orderAfterRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(orderAfterRes.body.status).toBe('paid');
      expect(orderAfterRes.body.amountPaid).toBe(12000);
    });

    it('simulates pending outcome and resolves payment', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 30000, currency: 'INR' });
      const orderId = orderRes.body.id;

      const payRes = await request(app)
        .post(`/api/v1/orders/${orderId}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_netbanking',
          parentOrigin: 'http://localhost:3000',
        });
      expect(payRes.status).toBe(201);
      const paymentId = payRes.body.id;

      // Simulate pending
      const pendingRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/simulate`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ outcome: 'pending' });

      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.status).toBe('pending');

      // Resolve pending
      const resolveRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/resolve`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ resolution: 'success' });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.status).toBe('captured');
    });
  });
});
