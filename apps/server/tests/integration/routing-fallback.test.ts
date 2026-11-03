import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Routing, Fallback Precedence & Error Handling (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let bearerToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);
    bearerToken = appContext.control.getActiveNativeToken()!;
  });

  describe('1. Architectural Fallback Precedence', () => {
    it('Level 1: returns 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED for known unsupported Razorpay features', async () => {
      const unsupportedEndpoints = [
        '/compat/razorpay/v1/refunds',
        '/compat/razorpay/v1/payouts',
        '/compat/razorpay/v1/subscriptions',
        '/compat/razorpay/v1/transfers',
        '/compat/razorpay/v1/invoices',
        '/compat/razorpay/v1/virtual_accounts',
        '/compat/razorpay/v1/items',
        '/compat/razorpay/v1/customers',
      ];

      for (const endpoint of unsupportedEndpoints) {
        const res = await request(app).post(endpoint).send({});
        expect(res.status).toBe(501);
        expect(res.body.simulated).toBe(true);
        expect(res.body.error.code).toBe('COMPATIBILITY_FEATURE_NOT_SUPPORTED');
        expect(res.body.error.message).toContain('outside the supported PAYSIM subset');
        expect(res.body.error.requestId).toMatch(/^req_ps_/);
      }
    });

    it('Level 2: returns 405 METHOD_NOT_ALLOWED with RFC 9110 Allow header on known routes', async () => {
      // GET /health only supports GET
      const resHealth = await request(app).delete('/health');
      expect(resHealth.status).toBe(405);
      expect(resHealth.header.allow).toBe('GET');
      expect(resHealth.body.simulated).toBe(true);
      expect(resHealth.body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(resHealth.body.error.allowedMethods).toEqual(['GET']);

      // /api/v1/orders supports POST and GET
      const resOrders = await request(app).delete('/api/v1/orders');
      expect(resOrders.status).toBe(405);
      expect(resOrders.header.allow).toContain('POST');
      expect(resOrders.header.allow).toContain('GET');
      expect(resOrders.body.error.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('Level 3: returns 404 NOT_FOUND for completely unknown routes', async () => {
      const res = await request(app).get('/api/v1/totally-unknown-resource');
      expect(res.status).toBe(404);
      expect(res.body.simulated).toBe(true);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('No route matches the path');
      expect(res.body.error.requestId).toMatch(/^req_ps_/);
    });
  });

  describe('2. Request Parsing & Validation Errors', () => {
    it('returns 400 MALFORMED_JSON when request payload is unparseable JSON', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('Content-Type', 'application/json')
        .send('{"amount": 500, broken_json');

      expect(res.status).toBe(400);
      expect(res.body.simulated).toBe(true);
      expect(res.body.error.code).toBe('MALFORMED_JSON');
      expect(res.body.error.requestId).toMatch(/^req_ps_/);
    });

    it('returns 422 VALIDATION_ERROR when request payload violates Zod constraints', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          amount: -100, // Invalid negative amount
          currency: 'INVALID',
        });

      expect(res.status).toBe(422);
      expect(res.body.simulated).toBe(true);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(res.body.error.requestId).toMatch(/^req_ps_/);
    });
  });

  describe('3. Request ID Propagation & CORS Invariants', () => {
    it('preserves client-provided X-Request-Id header in response', async () => {
      const customId = 'req_custom_trace_98765';
      const res = await request(app).get('/health').set('X-Request-Id', customId);

      expect(res.status).toBe(200);
      expect(res.header['x-request-id']).toBe(customId);
    });

    it('generates standard req_ps_... when X-Request-Id is omitted', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.header['x-request-id']).toMatch(/^req_ps_/);
    });

    it('applies loopback CORS headers for allowed origins', async () => {
      const allowedOrigin = 'http://127.0.0.1:5173';
      const res = await request(app)
        .get('/health')
        .set('Origin', allowedOrigin);

      expect(res.status).toBe(200);
      expect(res.header['access-control-allow-origin']).toBe(allowedOrigin);
      expect(res.header['access-control-allow-credentials']).toBe('true');
    });

    it('denies CORS headers for non-loopback untrusted origins', async () => {
      const untrustedOrigin = 'https://malicious-website.com';
      const res = await request(app)
        .get('/health')
        .set('Origin', untrustedOrigin);

      expect(res.header['access-control-allow-origin']).toBeUndefined();
    });
  });
});
