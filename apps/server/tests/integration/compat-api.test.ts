import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Compatibility API Integration (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let basicAuthHeader: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);

    const cred = appContext.control.getActiveCompatCredential()!;
    const rawCredentials = `${cred.keyId}:${cred.keySecret}`;
    basicAuthHeader = `Basic ${Buffer.from(rawCredentials).toString('base64')}`;
  });

  describe('1. Basic Authentication Gate', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).post('/compat/razorpay/v1/orders').send({ amount: 5000 });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid Basic credentials with 401 UNAUTHORIZED', async () => {
      const badHeader = `Basic ${Buffer.from('rzp_test_bad:wrongsecret').toString('base64')}`;
      const res = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', badHeader)
        .send({ amount: 5000 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts active Basic credentials', async () => {
      const res = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', basicAuthHeader)
        .send({ amount: 5000, receipt: 'rcpt_compat_1' });

      expect(res.status).toBe(201);
      expect(res.body.entity).toBe('order');
      expect(res.body.amount).toBe(5000);
    });
  });

  describe('2. Compatibility Order & Checkout Operations', () => {
    it('creates and fetches Razorpay compatibility order entity', async () => {
      const createRes = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', basicAuthHeader)
        .send({
          amount: 80000,
          currency: 'INR',
          receipt: 'rcpt_rzp_99',
          notes: { channel: 'magento' },
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.entity).toBe('order');
      expect(createRes.body.id).toMatch(/^ord_ps_/);
      expect(createRes.body.amount).toBe(80000);
      expect(createRes.body.amount_paid).toBe(0);
      expect(createRes.body.amount_due).toBe(80000);
      expect(createRes.body.currency).toBe('INR');
      expect(createRes.body.status).toBe('created');
      expect(createRes.body.attempts).toBe(0);
      expect(createRes.body.receipt).toBe('rcpt_rzp_99');
      expect(createRes.body.notes.channel).toBe('magento');
      expect(typeof createRes.body.created_at).toBe('number');

      const orderId = createRes.body.id;

      // GET /compat/razorpay/v1/orders/:id
      const getRes = await request(app)
        .get(`/compat/razorpay/v1/orders/${orderId}`)
        .set('Authorization', basicAuthHeader);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(orderId);
      expect(getRes.body.entity).toBe('order');
      expect(getRes.body.amount).toBe(80000);
    });

    it('creates bound checkout session via compat interface', async () => {
      // 1. Create Order
      const createRes = await request(app)
        .post('/compat/razorpay/v1/orders')
        .set('Authorization', basicAuthHeader)
        .send({
          amount: 15000,
          currency: 'INR',
        });
      const orderId = createRes.body.id;

      // 2. Create bound checkout session (PAYSIM Extension)
      const sessionRes = await request(app)
        .post(`/compat/razorpay/v1/orders/${orderId}/checkout-sessions`)
        .set('Authorization', basicAuthHeader)
        .send({
          parentOrigin: 'http://localhost:8000',
        });

      expect(sessionRes.status).toBe(201);
      expect(sessionRes.body.sessionId).toMatch(/^sess_ps_/);
      expect(sessionRes.body.capabilityToken).toBeDefined();
      expect(sessionRes.body.checkoutUrl).toContain(sessionRes.body.sessionId);
    });
  });
});
