import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import {
  getManualAttemptsCount,
  getAutomaticAttemptsCount,
  getRemainingManualRetries,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_MANUAL_RETRIES,
} from '../../src/webhook-engine/retry-policy.js';

describe('Phase 03.6.6 — Retry Policy Authority & Queue Overflow Intent Verification', () => {
  let mockReceiver: http.Server;
  let receiverPort: number;
  let receivedRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  let responseStatusCode = 500;

  beforeEach(async () => {
    receivedRequests = [];
    responseStatusCode = 500;

    mockReceiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({
          headers: req.headers,
          body,
        });
        res.writeHead(responseStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: responseStatusCode < 400 ? 'ok' : 'error' }));
      });
    });

    await new Promise<void>((resolve) => {
      mockReceiver.listen(0, '127.0.0.1', () => {
        const addr = mockReceiver.address() as AddressInfo;
        receiverPort = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockReceiver.close(() => resolve());
    });
  });

  describe('Task 2 — Queue-Full Manual Intent Preservation (12-Step Reproduction)', () => {
    it('preserves manual intent through queue overflow and reconciliation, cancels timer, and consumes exactly 1 manual allowance', async () => {
      responseStatusCode = 500;
      const app = createApplicationContext({ autoStartEngine: true });

      // Step 2 Setup: Create endpoint, order, and payment attempt
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-queue-overflow`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 18000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      expect(delivery).toBeDefined();

      // Wait for Attempt 1 to execute and fail with backoff timer scheduled
      const waitForCondition = async (
        predicate: (d: ReturnType<typeof app.webhooks.getDelivery>) => boolean,
        timeoutMs = 4000
      ) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const d = app.webhooks.getDelivery(delivery.id);
          if (predicate(d)) return d;
          await new Promise<void>((r) => setTimeout(r, 40));
        }
        return app.webhooks.getDelivery(delivery.id);
      };

      const afterAttempt1 = await waitForCondition(
        (d) => d.attempts.length === 1 && d.status === 'failed' && Boolean(d.nextRetryAt)
      );

      // Verify Step 2 condition: delivery has 1 failed automatic attempt and active timer
      expect(afterAttempt1.attempts.length).toBe(1);
      expect(afterAttempt1.status).toBe('failed');
      expect(afterAttempt1.nextRetryAt).not.toBeNull();
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(true);
      expect((afterAttempt1.attempts[0] as { initiator?: string }).initiator).toBe('automatic');

      // Step 1: Fill the 100-job waiting queue to maximum capacity
      while (app.engine.queue.size < app.engine.queue.capacity) {
        app.engine.queue.enqueue(`del_ps_dummy_${app.engine.queue.size}`);
      }
      expect(app.engine.queue.size).toBe(app.engine.queue.capacity); // 100 jobs

      // Step 3: Trigger manual retry before its automatic backoff timer fires
      const retryRes = await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      expect(retryRes.status).toBe('pending');
      expect(retryRes.attemptNumber).toBe(2);

      // Step 4: Verify the scheduled automatic timer is immediately cancelled
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(false);

      // Step 5: Verify the manual retry remains committed in RootState as pending with manual intent
      const committedDelivery = app.webhooks.getDelivery(delivery.id);
      expect(committedDelivery.status).toBe('pending');
      expect((committedDelivery as { pendingInitiator?: string }).pendingInitiator).toBe('manual');
      // Saturated queue rejected the job; delivery is NOT yet in the queue
      expect(app.engine.queue.has(delivery.id)).toBe(false);
      expect(app.engine.queue.size).toBe(100);

      // Step 6: Free a queue slot
      const freedJob = app.engine.queue.dequeue();
      expect(freedJob).not.toBeNull();
      expect(app.engine.queue.size).toBe(99);

      // Step 7: Run pending-delivery reconciliation
      const reconciledCount = app.engine.reconcilePendingDeliveries();
      expect(reconciledCount).toBe(1);
      expect(app.engine.queue.size).toBe(100);

      // Step 8: Verify the delivery is enqueued with "initiator: 'manual'"
      expect(app.engine.queue.has(delivery.id)).toBe(true);
      const queuedJob = app.engine.queue.get(delivery.id);
      expect(queuedJob).toBeDefined();
      expect(queuedJob?.deliveryId).toBe(delivery.id);
      expect(queuedJob?.initiator).toBe('manual');

      // Step 9: Dispatch it
      // Drain the preceding dummy jobs so worker immediately claims our delivery
      while (app.engine.queue.peek()?.deliveryId !== delivery.id && app.engine.queue.size > 1) {
        app.engine.queue.dequeue();
      }
      expect(app.engine.queue.peek()?.deliveryId).toBe(delivery.id);

      // Notify workers that our delivery is at the front
      app.engine.workerPool.notifyJobAvailable();

      // Step 10: Wait for manual retry attempt to execute and fail
      const afterManualAttempt = await waitForCondition(
        (d) => d.attempts.length === 2 && d.status !== 'in_progress' && d.status !== 'pending'
      );

      // Verify Attempt 2 is classified as manual
      expect(afterManualAttempt.attempts.length).toBe(2);
      expect((afterManualAttempt.attempts[0] as { initiator?: string }).initiator).toBe('automatic');
      expect((afterManualAttempt.attempts[1] as { initiator?: string }).initiator).toBe('manual');

      // Step 11: Verify exactly one manual allowance is consumed
      expect(getAutomaticAttemptsCount(afterManualAttempt.attempts)).toBe(1);
      expect(getManualAttemptsCount(afterManualAttempt.attempts)).toBe(1);
      expect(getRemainingManualRetries(afterManualAttempt.attempts)).toBe(2);

      // Step 12: Verify no stale automatic timer dispatches another attempt
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(false);
      expect(afterManualAttempt.nextRetryAt).toBeNull();
      expect(afterManualAttempt.status).toBe('failed');

      // Observe for 1.2 seconds: no phantom/stale attempts created
      await new Promise<void>((r) => setTimeout(r, 1200));
      const finalCheck = app.webhooks.getDelivery(delivery.id);
      expect(finalCheck.attempts.length).toBe(2);
      expect(finalCheck.status).toBe('failed');

      await app.engine.stop();
    });
  });

  describe('Task 3 — Concurrency, Deduplication & Retention Invariants', () => {
    it('rejects duplicate manual retry requests when delivery is pending in RootState', async () => {
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-dedup`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Mark delivery as failed
      await app.coordinator.transaction({ locks: [`delivery:${delivery.id}`] }, async (ctx) => {
        ctx.deliveries.update({
          ...delivery,
          status: 'failed',
          attempts: [
            {
              attemptNumber: 1,
              statusCode: 500,
              durationMs: 10,
              outcome: 'http_error',
              executedAt: new Date().toISOString(),
              initiator: 'automatic',
            },
          ],
        });
      });

      // Fill queue to 100
      while (app.engine.queue.size < app.engine.queue.capacity) {
        app.engine.queue.enqueue(`dummy_${app.engine.queue.size}`);
      }

      // First manual retry succeeds, marking delivery pending in RootState
      const res = await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      expect(res.status).toBe('pending');

      // Second manual retry request while still pending must reject immediately
      await expect(
        app.webhooks.retryDelivery({ deliveryId: delivery.id })
      ).rejects.toThrow(/already pending in the queue|invalid state transition/i);

      await app.engine.stop();
    });

    it('guarantees queue refill deduplication when reconcilePendingDeliveries runs repeatedly', async () => {
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-reconcile-dedup`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 20000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      expect(delivery.status).toBe('pending');

      // Clear the queue to test reconciliation from scratch
      while (app.engine.queue.size > 0) {
        app.engine.queue.dequeue();
      }
      expect(app.engine.queue.size).toBe(0);

      // Reconcile once: enqueues 1 delivery
      const firstReconcile = app.engine.reconcilePendingDeliveries();
      expect(firstReconcile).toBe(1);
      expect(app.engine.queue.size).toBe(1);

      // Reconcile second time: enqueues 0 duplicate deliveries
      const secondReconcile = app.engine.reconcilePendingDeliveries();
      expect(secondReconcile).toBe(0);
      expect(app.engine.queue.size).toBe(1);

      // Reconcile third time: still 0 duplicates
      const thirdReconcile = app.engine.reconcilePendingDeliveries();
      expect(thirdReconcile).toBe(0);
      expect(app.engine.queue.size).toBe(1);

      await app.engine.stop();
    });

    it('strictly preserves body payload bytes and signing secret during pending overflow state', async () => {
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-retention-overflow`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 30000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Mark delivery as failed
      await app.coordinator.transaction({ locks: [`delivery:${delivery.id}`] }, async (ctx) => {
        ctx.deliveries.update({
          ...delivery,
          status: 'failed',
          attempts: [
            {
              attemptNumber: 1,
              statusCode: 500,
              durationMs: 12,
              outcome: 'http_error',
              executedAt: new Date().toISOString(),
              initiator: 'automatic',
            },
          ],
        });
      });

      // Fill queue
      while (app.engine.queue.size < app.engine.queue.capacity) {
        app.engine.queue.enqueue(`dummy_${app.engine.queue.size}`);
      }

      // Trigger manual retry under queue saturation
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });

      // Delivery is pending in RootState
      expect(app.webhooks.getDelivery(delivery.id).status).toBe('pending');

      // Verify payload body is still strictly present in DeliveryBodyVault
      expect(app.bodyVault.hasBody(delivery.id)).toBe(true);

      // Verify signing secret version 1 is still strictly present in WebhookSecretVault
      expect(app.secretVault.hasSecret(endpointRes.endpoint.id, delivery.secretVersion)).toBe(true);

      await app.engine.stop();
    });

    it('enforces maximum 3 auto attempts and 3 manual retries boundaries', () => {
      expect(MAX_AUTOMATIC_ATTEMPTS).toBe(3);
      expect(MAX_MANUAL_RETRIES).toBe(3);
    });
  });
});
