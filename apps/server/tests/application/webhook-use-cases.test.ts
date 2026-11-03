import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext,
  ApplicationError,
} from '../../src/application/index.js';

describe('Application Service Layer — Webhook Use Cases (Phase 03.3.3)', () => {
  let app: ApplicationContext;

  beforeEach(() => {
    app = createApplicationContext();
  });

  describe('1. Create Webhook Endpoint Use Case', () => {
    it('creates an endpoint targeting loopback URL, stores secret in vault, and assigns secretVersion 1', async () => {
      const res = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:9000/webhook',
          mode: 'native',
          events: ['payment.created', 'payment.captured'],
          description: 'Local test receiver',
        },
      });

      expect(res.endpoint.id).toMatch(/^we_ps_/);
      expect(res.endpoint.url).toBe('http://127.0.0.1:9000/webhook');
      expect(res.endpoint.mode).toBe('native');
      expect(res.endpoint.secretVersion).toBe(1);
      expect(res.endpoint.configVersion).toBe(1);
      expect(res.secret).toMatch(/^whsec_/);

      // Verify raw secret Buffer is safely stored in WebhookSecretVault
      const vaultSecret = app.secretVault.getSecret(res.endpoint.id, 1);
      expect(vaultSecret).toBeDefined();
      expect(vaultSecret?.toString('utf8')).toBe(res.secret);

      // Verify endpoint is retrievable via repository facade
      const stored = app.webhooks.getEndpoint(res.endpoint.id);
      expect(stored.id).toBe(res.endpoint.id);
    });

    it('rejects non-loopback URLs per PRD Section 10.1 (rejection of remote destinations & DNS)', async () => {
      await expect(
        app.webhooks.createEndpoint({
          request: {
            url: 'https://example.com/webhook',
            mode: 'native',
            events: ['payment.captured'],
          },
        })
      ).rejects.toThrow(ApplicationError);

      await expect(
        app.webhooks.createEndpoint({
          request: {
            url: 'http://169.254.169.254/metadata',
            mode: 'native',
            events: ['payment.captured'],
          },
        })
      ).rejects.toThrow(ApplicationError);
    });

    it('rejects empty events array', async () => {
      await expect(
        app.webhooks.createEndpoint({
          request: {
            url: 'http://127.0.0.1:8080/hook',
            mode: 'native',
            // @ts-expect-error Intentionally empty events
            events: [],
          },
        })
      ).rejects.toThrow(ApplicationError);
    });
  });

  describe('2. Update and Retrieve Endpoint Use Cases', () => {
    it('updates endpoint URL and events list, incrementing configVersion', async () => {
      const created = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:4000/v1',
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const updated = await app.webhooks.updateEndpoint(created.endpoint.id, {
        url: 'http://127.0.0.1:4000/v2',
        events: ['payment.created', 'payment.captured', 'order.paid'],
      });

      expect(updated.url).toBe('http://127.0.0.1:4000/v2');
      expect(updated.events.length).toBe(3);
      expect(updated.configVersion).toBe(2);
      expect(updated.secretVersion).toBe(1); // Unchanged
    });

    it('throws NOT_FOUND when updating non-existent endpoint', async () => {
      await expect(
        app.webhooks.updateEndpoint('we_ps_nonexistent', {
          url: 'http://127.0.0.1:4500/hook',
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
    });

    it('lists all endpoints', async () => {
      await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:4001/hook', mode: 'native', events: ['*'] },
      });
      await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:4002/hook', mode: 'compatibility', events: ['order.paid'] },
      });

      const list = app.webhooks.listEndpoints();
      expect(list.length).toBe(2);
    });
  });

  describe('3. Webhook Secret Rotation Use Case', () => {
    it('rotates secret, increments secretVersion, and stores new secret in vault', async () => {
      const created = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:8000/hook',
          mode: 'native',
          events: ['payment.captured'],
        },
      });

      const rotated = await app.webhooks.rotateSecret({
        endpointId: created.endpoint.id,
        request: { reason: 'Scheduled rotation' },
      });

      expect(rotated.endpointId).toBe(created.endpoint.id);
      expect(rotated.secretVersion).toBe(2);
      expect(rotated.secret).toMatch(/^whsec_/);
      expect(rotated.secret).not.toBe(created.secret);

      // Verify both v1 and v2 exist in secret vault
      expect(app.secretVault.hasSecret(created.endpoint.id, 1)).toBe(true);
      expect(app.secretVault.hasSecret(created.endpoint.id, 2)).toBe(true);
    });

    it('handles idempotent secret rotation replay with 60s disclosure window', async () => {
      const created = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:8000/hook',
          mode: 'native',
          events: ['payment.captured'],
        },
      });

      const rotate1 = await app.webhooks.rotateSecret({
        endpointId: created.endpoint.id,
        idempotencyKey: 'idem-rotate-001',
      });

      // Immediate identical replay within 60s
      const rotate2 = await app.webhooks.rotateSecret({
        endpointId: created.endpoint.id,
        idempotencyKey: 'idem-rotate-001',
      });

      expect(rotate1.secretVersion).toBe(rotate2.secretVersion);
      expect(rotate1.secret).toBe(rotate2.secret);
      expect(app.secretVault.storedSecretCount).toBe(2); // 1 initial + 1 rotation
    });
  });

  describe('4. Deliveries and Event Replay Use Cases', () => {
    it('replays an event across all active subscribed endpoints', async () => {
      // Create native endpoint subscribed to payment.captured
      const ep1 = await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:7001/native', mode: 'native', events: ['payment.captured'] },
      });

      // Create compat endpoint subscribed to payment.captured
      const ep2 = await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:7002/compat', mode: 'compatibility', events: ['payment.captured'] },
      });

      // Endpoint not subscribed
      await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:7003/other', mode: 'native', events: ['payment.created'] },
      });

      // Trigger a payment captured flow to produce canonical event
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });
      await app.payments.simulateOutcome({ paymentId: pay.id, request: { outcome: 'success' } });

      const allEvents = app.webhooks.listEvents();
      const capturedEvent = allEvents.find((e) => e.type === 'payment.captured')!;
      expect(capturedEvent).toBeDefined();

      // Replay the event
      const deliveries = await app.webhooks.replayEvent(capturedEvent.id);
      expect(deliveries.length).toBe(2);
      expect(deliveries.some((d) => d.endpointId === ep1.endpoint.id)).toBe(true);
      expect(deliveries.some((d) => d.endpointId === ep2.endpoint.id)).toBe(true);
      expect(deliveries[0].status).toBe('pending');
    });

    it('retries a delivery, resetting status to pending and scheduling nextRetryAt', async () => {
      // Seed endpoint, event, delivery
      await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:7001/native', mode: 'native', events: ['*'] },
      });

      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });
      await app.payments.simulateOutcome({ paymentId: pay.id, request: { outcome: 'success' } });
      const event = app.webhooks.listEvents().find((e) => e.type === 'payment.captured')!;

      const deliveries = await app.webhooks.replayEvent(event.id);
      expect(deliveries.length).toBeGreaterThan(0);
      const delivery = deliveries[0];

      // Simulate a failed attempt on delivery
      await app.coordinator.transaction({}, async (ctx) => {
        const d = ctx.deliveries.get(delivery.id)!;
        ctx.deliveries.update({
          ...d,
          status: 'failed',
          attempts: [
            {
              attemptNumber: 1,
              statusCode: 500,
              durationMs: 45,
              outcome: 'http_error',
              errorMessage: 'Internal Server Error',
              executedAt: new Date().toISOString(),
            },
          ],
        });
      });

      // Retry delivery
      const retryRes = await app.webhooks.retryDelivery({
        deliveryId: delivery.id,
      });

      expect(retryRes.status).toBe('pending');
      expect(retryRes.attemptNumber).toBe(2);
      expect(app.webhooks.getDelivery(delivery.id).status).toBe('pending');
    });

    it('rejects retrying a delivery that is currently in_progress (409 INVALID_STATE_TRANSITION)', async () => {
      await app.webhooks.createEndpoint({
        request: { url: 'http://127.0.0.1:7001/native', mode: 'native', events: ['*'] },
      });

      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const event = app.webhooks.listEvents()[0];
      const deliveries = await app.webhooks.replayEvent(event.id);

      // Simulate in_progress
      await app.coordinator.transaction({}, async (ctx) => {
        const d = ctx.deliveries.get(deliveries[0].id)!;
        ctx.deliveries.update({ ...d, status: 'in_progress' });
      });

      await expect(
        app.webhooks.retryDelivery({ deliveryId: deliveries[0].id })
      ).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        httpStatus: 409,
      });
    });
  });
});
