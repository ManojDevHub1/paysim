import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Checkout API Integration (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let bearerToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);
    bearerToken = appContext.control.getActiveNativeToken()!;
  });

  describe('1. Capability Token Exchange', () => {
    it('exchanges capability token for iframe session credentials', async () => {
      // 1. Create Order & Payment
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 45000, currency: 'INR' });
      const orderId = orderRes.body.id;

      const payRes = await request(app)
        .post(`/api/v1/orders/${orderId}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_card',
          parentOrigin: 'http://localhost:3000',
        });
      const paymentId = payRes.body.id;

      // 2. Create Checkout Session
      const sessionRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/checkout-sessions`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ parentOrigin: 'http://localhost:3000' });

      const { sessionId, capabilityToken } = sessionRes.body;

      // 3. POST /checkout/:sessionId/exchange
      const exchangeRes = await request(app)
        .post(`/checkout/${sessionId}/exchange`)
        .send({ capabilityToken });

      expect(exchangeRes.status).toBe(200);
      expect(exchangeRes.body.sessionAccessToken).toMatch(/^sat_ps_/);
      expect(exchangeRes.body.order.id).toBe(orderId);
      expect(exchangeRes.body.order.amount).toBe(45000);
      expect(exchangeRes.body.payment.id).toBe(paymentId);
      expect(exchangeRes.body.payment.status).toBe('created');
    });

    it('rejects invalid capability token with 401 CONTROL_TOKEN_INVALID', async () => {
      // Create session
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 10000, currency: 'INR' });

      const payRes = await request(app)
        .post(`/api/v1/orders/${orderRes.body.id}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_upi',
          parentOrigin: 'http://localhost:3000',
        });

      const sessionRes = await request(app)
        .post(`/api/v1/payments/${payRes.body.id}/checkout-sessions`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ parentOrigin: 'http://localhost:3000' });

      const { sessionId } = sessionRes.body;
      const fakeToken = '0'.repeat(64);

      const exchangeRes = await request(app)
        .post(`/checkout/${sessionId}/exchange`)
        .send({ capabilityToken: fakeToken });

      expect(exchangeRes.status).toBe(401);
      expect(exchangeRes.body.error.code).toBe('CONTROL_TOKEN_INVALID');
    });

    it('returns 404 for unknown checkout session ID', async () => {
      const res = await request(app)
        .post('/checkout/sess_ps_nonexistent_12345/exchange')
        .send({ capabilityToken: '1'.repeat(64) });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('2. Checkout Token Rotation', () => {
    it('rotates session access token and establishes 30s grace window', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 20000, currency: 'INR' });

      const payRes = await request(app)
        .post(`/api/v1/orders/${orderRes.body.id}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_card',
          parentOrigin: 'http://localhost:3000',
        });

      const sessionRes = await request(app)
        .post(`/api/v1/payments/${payRes.body.id}/checkout-sessions`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ parentOrigin: 'http://localhost:3000' });

      const { sessionId } = sessionRes.body;

      // Rotate token
      const rotateRes = await request(app)
        .post(`/checkout/${sessionId}/rotate-token`)
        .send({ reason: 'security_cycle' });

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.sessionAccessToken).toMatch(/^sat_ps_/);
      expect(rotateRes.body.previousTokenGraceExpiresAt).toBeDefined();
      expect(rotateRes.body.expiresAt).toBeDefined();
    });
  });
});
