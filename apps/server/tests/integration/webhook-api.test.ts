import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../../src/application/index.js';

describe('HTTP Webhooks & Deliveries API Integration (Phase 03.4)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let bearerToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);
    bearerToken = appContext.control.getActiveNativeToken()!;
  });

  describe('1. Webhook Endpoint Registration & Port Confinement', () => {
    it('registers a valid loopback webhook endpoint with one-time secret disclosure', async () => {
      const res = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'http://127.0.0.1:4500/webhook',
          mode: 'native',
          events: ['payment.captured', 'payment.failed'],
          description: 'Local development listener',
        });

      expect(res.status).toBe(201);
      expect(res.body.endpoint.id).toMatch(/^we_ps_/);
      expect(res.body.endpoint.url).toBe('http://127.0.0.1:4500/webhook');
      expect(res.body.secret).toMatch(/^whsec_/);

      const endpointId = res.body.endpoint.id;

      // GET endpoint does NOT expose raw secret
      const getRes = await request(app)
        .get(`/api/v1/webhook-endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(endpointId);
      expect(getRes.body.secret).toBeUndefined();
    });

    it('rejects sensitive ports with 422 VALIDATION_ERROR', async () => {
      // Sensitive Docker port 5000
      const resDocker = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'http://127.0.0.1:5000/webhook',
          mode: 'native',
          events: ['payment.captured'],
        });

      expect(resDocker.status).toBe(422);
      expect(resDocker.body.error.code).toBe('VALIDATION_ERROR');

      // Reserved PAYSIM server port 8787
      const resPaysim = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'http://127.0.0.1:8787/webhook',
          mode: 'native',
          events: ['payment.captured'],
        });

      expect(resPaysim.status).toBe(422);
      expect(resPaysim.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-loopback external URLs with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'https://example.com/webhook',
          mode: 'native',
          events: ['payment.captured'],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Endpoint Mutation & Secret Rotation', () => {
    it('patches endpoint and rotates signing secret with idempotency', async () => {
      const createRes = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'http://127.0.0.1:4500/webhook-1',
          mode: 'native',
          events: ['payment.created'],
        });
      const endpointId = createRes.body.endpoint.id;

      // Update endpoint
      const patchRes = await request(app)
        .patch(`/api/v1/webhook-endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          description: 'Updated description',
          status: 'disabled',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.description).toBe('Updated description');
      expect(patchRes.body.status).toBe('disabled');

      // Rotate secret
      const rotateRes = await request(app)
        .post(`/api/v1/webhook-endpoints/${endpointId}/rotate-secret`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .set('X-Idempotency-Key', 'idem_secret_rot_01')
        .send({ reason: 'Routine rotation' });

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.secret).toMatch(/^whsec_/);
      expect(rotateRes.body.secretVersion).toBe(2);
    });

    it('lists endpoints with paginated envelope', async () => {
      const res = await request(app)
        .get('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.object).toBe('list');
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('3. Canonical Events & Replay', () => {
    it('lists canonical events in wire format and replays to active endpoints', async () => {
      // 1. Create Endpoint subscribed to payment.captured
      const epRes = await request(app)
        .post('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          url: 'http://127.0.0.1:4500/webhook-events',
          mode: 'native',
          events: ['payment.captured'],
        });
      const endpointId = epRes.body.endpoint.id;

      // 2. Trigger domain lifecycle generating payment.captured event
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ amount: 15000, currency: 'INR' });

      const payRes = await request(app)
        .post(`/api/v1/orders/${orderRes.body.id}/payment-attempts`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({
          method: 'mock_card',
          parentOrigin: 'http://localhost:3000',
        });

      await request(app)
        .post(`/api/v1/payments/${payRes.body.id}/simulate`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ outcome: 'success' });

      // 3. GET /api/v1/events
      const eventsRes = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.object).toBe('list');
      expect(eventsRes.body.data.length).toBeGreaterThanOrEqual(1);

      const capturedEvent = eventsRes.body.data.find(
        (e: { type: string }) => e.type === 'payment.captured'
      );
      expect(capturedEvent).toBeDefined();

      // 4. Replay event to endpoint
      const replayRes = await request(app)
        .post(`/api/v1/events/${capturedEvent.id}/replay`)
        .set('Authorization', `Bearer ${bearerToken}`)
        .send({ endpointIds: [endpointId] });

      expect(replayRes.status).toBe(200);
      expect(replayRes.body.eventId).toBe(capturedEvent.id);
      expect(replayRes.body.deliveriesCreated.length).toBe(1);

      // 5. Inspect deliveries
      const deliveriesRes = await request(app)
        .get('/api/v1/deliveries')
        .set('Authorization', `Bearer ${bearerToken}`);

      expect(deliveriesRes.status).toBe(200);
      expect(deliveriesRes.body.object).toBe('list');
      expect(deliveriesRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
