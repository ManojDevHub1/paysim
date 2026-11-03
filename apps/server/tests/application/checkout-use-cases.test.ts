import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext,
  CHECKOUT_SESSION_TTL_MS,
} from '../../src/application/index.js';

describe('Application Service Layer — Checkout Use Cases (Phase 03.3.3)', () => {
  let app: ApplicationContext;

  beforeEach(() => {
    app = createApplicationContext();
  });

  describe('1. Create Checkout Session Use Case', () => {
    it('creates a Checkout Session, returns capability token, and stores only its SHA-256 hash in RootState', async () => {
      const order = await app.orders.createOrder({ request: { amount: 25000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });

      const sessionRes = await app.checkout.createSession({
        paymentId: payment.id,
        request: {
          parentOrigin: 'http://localhost:5173',
          theme: 'dark',
        },
      });

      expect(sessionRes.sessionId).toMatch(/^sess_ps_/);
      expect(sessionRes.paymentId).toBe(payment.id);
      expect(sessionRes.orderId).toBe(order.id);
      expect(sessionRes.checkoutUrl).toContain(sessionRes.sessionId);
      expect(sessionRes.capabilityToken).toHaveLength(64);

      // Verify RootState stores ONLY the token hash, never the raw capability token
      const stored = app.coordinator.sessions.get(sessionRes.sessionId);
      expect(stored).toBeDefined();
      expect(stored?.opaqueTokenHash).toHaveLength(64);
      expect(stored?.opaqueTokenHash).not.toBe(sessionRes.capabilityToken);
      // @ts-expect-error Verify raw token is absent on entity
      expect(stored?.capabilityToken).toBeUndefined();
    });

    it('rejects checkout session creation for non-existent payment (NOT_FOUND)', async () => {
      await expect(
        app.checkout.createSession({
          paymentId: 'pay_ps_missing_123',
          request: { parentOrigin: 'http://localhost:5173' },
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
    });

    it('rejects checkout session creation on paid order (ORDER_ALREADY_PAID)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });

      await app.payments.simulateOutcome({
        paymentId: payment.id,
        request: { outcome: 'success' },
      });

      await expect(
        app.checkout.createSession({
          paymentId: payment.id,
          request: { parentOrigin: 'http://localhost:5173' },
        })
      ).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
        httpStatus: 409,
      });
    });
  });

  describe('2. Retrieve and Exchange Capability Token Use Cases', () => {
    it('retrieves session by session ID', async () => {
      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      const session = app.checkout.getSession(created.sessionId);
      expect(session.id).toBe(created.sessionId);
      expect(session.status).toBe('active');
    });

    it('exchanges valid capability token for session access credentials and marks session consumed', async () => {
      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      const exchangeRes = await app.checkout.exchangeToken({
        sessionId: created.sessionId,
        capabilityToken: created.capabilityToken,
      });

      expect(exchangeRes.sessionAccessToken).toMatch(/^sat_ps_/);
      expect(exchangeRes.csrfToken).toMatch(/^csrf_ps_/);
      expect(exchangeRes.order.id).toBe(order.id);
      expect(exchangeRes.payment.id).toBe(payment.id);

      // Verify session status updated to consumed
      const stored = app.checkout.getSession(created.sessionId);
      expect(stored.status).toBe('consumed');
      expect(stored.consumedAt).toBeDefined();
    });

    it('rejects exchange when capability token is incorrect (CONTROL_TOKEN_INVALID)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      // Pass wrong token
      const wrongToken = 'a'.repeat(64);
      await expect(
        app.checkout.exchangeToken({
          sessionId: created.sessionId,
          capabilityToken: wrongToken,
        })
      ).rejects.toMatchObject({
        code: 'CONTROL_TOKEN_INVALID',
        httpStatus: 401,
      });

      // Session remains active
      expect(app.checkout.getSession(created.sessionId).status).toBe('active');
    });

    it('rejects exchange when session has expired (CHECKOUT_SESSION_EXPIRED)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      // Manually simulate expiration in RootState
      await app.coordinator.transaction({}, async (ctx) => {
        const s = ctx.sessions.get(created.sessionId)!;
        ctx.sessions.update({
          ...s,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          status: 'expired',
        });
      });

      await expect(
        app.checkout.exchangeToken({
          sessionId: created.sessionId,
          capabilityToken: created.capabilityToken,
        })
      ).rejects.toMatchObject({
        code: 'CHECKOUT_SESSION_EXPIRED',
        httpStatus: 410,
      });
    });
  });

  describe('3. Rotate Checkout Token Use Case', () => {
    it('rotates capability token and issues new active token with grace window', async () => {
      const order = await app.orders.createOrder({ request: { amount: 20000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      const rotated = await app.checkout.rotateToken({
        sessionId: created.sessionId,
        request: { reason: 'expiry_refresh' },
      });

      expect(rotated.sessionAccessToken).toMatch(/^sat_ps_/);
      expect(rotated.previousTokenGraceExpiresAt).toBeDefined();
      expect(new Date(rotated.expiresAt).getTime()).toBeGreaterThan(Date.now() + CHECKOUT_SESSION_TTL_MS - 5000);

      // RootState reflects active session with new hash
      const stored = app.checkout.getSession(created.sessionId);
      expect(stored.status).toBe('active');
    });

    it('rejects rotation of an expired session (CHECKOUT_SESSION_EXPIRED)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 20000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });
      const created = await app.checkout.createSession({
        paymentId: payment.id,
        request: { parentOrigin: 'http://localhost:5173' },
      });

      // Simulate expired session
      await app.coordinator.transaction({}, async (ctx) => {
        const s = ctx.sessions.get(created.sessionId)!;
        ctx.sessions.update({
          ...s,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          status: 'expired',
        });
      });

      await expect(
        app.checkout.rotateToken({
          sessionId: created.sessionId,
        })
      ).rejects.toMatchObject({
        code: 'CHECKOUT_SESSION_EXPIRED',
        httpStatus: 410,
      });
    });
  });
});
