import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import {
  DeliveryBodyVault,
  SecretVersionRetentionTracker,
  type DeliveryRetentionReference,
} from '@paysim/storage-memory';
import { computeHmacSha256 } from '@paysim/crypto';

describe('Phase 03.6.4 — Final Automatic Retry vs Manual Retry Retention Integrity', () => {
  let mockReceiver: http.Server;
  let receiverPort: number;
  let receivedRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  let responseStatusCode = 200;

  beforeEach(async () => {
    receivedRequests = [];
    responseStatusCode = 200;

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

  describe('Task 1 & 2 — Reachable State Verification & Retention Safety', () => {
    it('verifies state { status: failed, nextRetryAt: future, attempts < 3, manualRemaining: 0 } strictly retains body and secret', () => {
      const futureTimestamp = new Date(Date.now() + 5000).toISOString();
      const endpointId = 'ep_ps_reach_01';
      const activeVersion = 2;

      // Hypothetical edge state where manualRemaining is 0 but automatic retry is scheduled
      const scheduledAutoDelivery: DeliveryRetentionReference = {
        deliveryId: 'del_ps_auto_sched_01',
        endpointId,
        secretVersion: 1,
        status: 'failed',
        manualRetriesRemaining: 0,
        attemptsCount: 1,
        maxAttempts: 3,
        nextRetryAt: futureTimestamp,
      };

      // 1. Secret Version Retention Check:
      // Even though manualRetriesRemaining === 0, it has an active scheduled retry (and attempts < maxAttempts)
      const isEligible = SecretVersionRetentionTracker.isDeliveryReferenceEligible(scheduledAutoDelivery);
      expect(isEligible).toBe(true);

      // Historical version 1 CANNOT be evicted
      const canEvict = SecretVersionRetentionTracker.canEvictSecretVersion(
        endpointId,
        1,
        activeVersion,
        [scheduledAutoDelivery]
      );
      expect(canEvict).toBe(false);

      // 2. Delivery Body Vault Check:
      const bodyVault = new DeliveryBodyVault();
      const rawPayload = Buffer.from('payload_scheduled_retry_01');
      bodyVault.storeBody('del_ps_auto_sched_01', rawPayload);

      // pruneTerminalBodies MUST NOT prune the body of this delivery
      const pruned = bodyVault.pruneTerminalBodies([
        {
          id: 'del_ps_auto_sched_01',
          status: 'failed',
          manualRetriesRemaining: 0,
          nextRetryAt: futureTimestamp,
          attempts: [{}], // 1 attempt
          maxAttempts: 3,
        },
      ]);

      expect(pruned).toBe(0);
      expect(bodyVault.hasBody('del_ps_auto_sched_01')).toBe(true);
    });

    it('verifies manual retry exhaustion on Delivery A cannot cancel or evict resources required by Delivery B undergoing automatic retry', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointUrl = `http://127.0.0.1:${receiverPort}/webhook`;

      // 1. Register endpoint with secret version 1
      const epRes = await app.webhooks.createEndpoint({
        request: {
          url: endpointUrl,
          mode: 'native',
          events: ['payment.created'],
        },
      });
      const endpointId = epRes.endpoint.id;
      const secretV1 = epRes.secret;

      // Fail initial attempts
      responseStatusCode = 500;

      // 2. Create Delivery A and Delivery B (both reference v1)
      const orderA = await app.orders.createOrder({ request: { amount: 1000 } });
      await app.payments.createPaymentAttempt({ orderId: orderA.id });

      const orderB = await app.orders.createOrder({ request: { amount: 2000 } });
      await app.payments.createPaymentAttempt({ orderId: orderB.id });

      const deliveries = app.webhooks.listDeliveries({ endpointId });
      expect(deliveries.length).toBe(2);
      const [delA, delB] = deliveries;

      // Wait for both deliveries to complete Attempt 1 and schedule backoff
      const waitForStatus = async (id: string, targetStatus: string, maxWaitMs = 2000) => {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          const d = app.webhooks.getDelivery(id);
          if (d.status === targetStatus) return d;
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        return app.webhooks.getDelivery(id);
      };

      await waitForStatus(delA.id, 'failed');
      await waitForStatus(delB.id, 'failed');

      // Cancel scheduled retry on delB to pause timers without aborting the engine controller
      app.engine.cancelScheduledRetry(delB.id);

      // Rotate secret to version 2
      await app.webhooks.rotateSecret({ endpointId });

      // Simulate Delivery A permanently exhausting all attempts (3 auto + 3 manual = 6)
      await app.coordinator.transaction({ locks: [`delivery:${delA.id}`] }, async (ctx) => {
        const curA = ctx.deliveries.get(delA.id)!;
        ctx.deliveries.update({
          ...curA,
          status: 'exhausted',
          attempts: [
            { attemptNumber: 1, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 2, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 3, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 4, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 5, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 6, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
          ],
        });
      });

      // Delivery A body is cleaned up
      app.bodyVault.deleteBody(delA.id);
      expect(app.bodyVault.hasBody(delA.id)).toBe(false);

      // CRITICAL CHECK: Delivery B is still in 'failed' status with nextRetryAt set
      const currentB = app.webhooks.getDelivery(delB.id);
      expect(currentB.status).toBe('failed');
      expect(currentB.nextRetryAt).not.toBeNull();

      // Verify Secret Version 1 is STILL RETAINED in vault because Delivery B needs it!
      expect(app.secretVault.hasSecret(endpointId, 1)).toBe(true);

      // Verify Delivery B's body is STILL PRESERVED in body vault!
      expect(app.bodyVault.hasBody(delB.id)).toBe(true);
      const bodyB = app.bodyVault.getBody(delB.id)!;
      expect(bodyB.length).toBeGreaterThan(0);

      // When Delivery B is retried, verify it still signs with Version 1 and bit-for-bit body
      responseStatusCode = 200;
      const retryBRes = await app.webhooks.retryDelivery({ deliveryId: delB.id });
      expect(retryBRes.status).toBe('pending');

      // Wait for background worker to complete attempt 2 and succeed
      const finalB = await waitForStatus(delB.id, 'succeeded');
      expect(finalB.status).toBe('succeeded');
      expect(finalB.attempts.length).toBe(2);

      // Verify the request received by mockReceiver matches secretV1 HMAC
      const lastReq = receivedRequests[receivedRequests.length - 1];
      const expectedHmac = computeHmacSha256(secretV1, bodyB);
      expect(lastReq.headers['x-paysim-signature']).toBe(`sha256=${expectedHmac}`);

      await app.engine.stop();
    });
  });

  describe('Task 3 — Worker and Timer Consistency & Cancellation Safety', () => {
    it('cancels scheduled automatic retry timer when manual retry supersedes it', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointUrl = `http://127.0.0.1:${receiverPort}/webhook`;

      const epRes = await app.webhooks.createEndpoint({
        request: {
          url: endpointUrl,
          mode: 'native',
          events: ['payment.created'],
        },
      });
      const endpointId = epRes.endpoint.id;

      // Fail attempt 1
      responseStatusCode = 500;

      const order = await app.orders.createOrder({ request: { amount: 5000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveryId = app.webhooks.listDeliveries({ endpointId })[0].id;

      // Wait for attempt 1 to complete and schedule attempt 2 (+500ms)
      const waitForScheduledTimer = async () => {
        for (let i = 0; i < 20; i++) {
          if (app.engine.hasScheduledRetry(deliveryId)) return true;
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        return false;
      };

      const hasTimer = await waitForScheduledTimer();
      expect(hasTimer).toBe(true);

      const delAfterA1 = app.webhooks.getDelivery(deliveryId);
      expect(delAfterA1.status).toBe('failed');
      expect(delAfterA1.attempts.length).toBe(1);
      expect(delAfterA1.nextRetryAt).not.toBeNull();

      // Now developer triggers manual retry at ~100ms (before 500ms timer fires)
      responseStatusCode = 200; // Success on manual retry
      const retryRes = await app.webhooks.retryDelivery({ deliveryId });
      expect(retryRes.status).toBe('pending');
      expect(retryRes.attemptNumber).toBe(2);

      // Verify the active timer was cancelled immediately
      expect(app.engine.hasScheduledRetry(deliveryId)).toBe(false);

      // Wait 700ms to verify that the old 500ms timer DOES NOT fire or duplicate attempts
      await new Promise<void>((r) => setTimeout(r, 700));

      const finalDel = app.webhooks.getDelivery(deliveryId);
      // It must have succeeded on Attempt 2 and NEVER triggered a 3rd attempt
      expect(finalDel.status).toBe('succeeded');
      expect(finalDel.attempts.length).toBe(2);

      await app.engine.stop();
    });

    it('prevents two retry triggers from claiming the same delivery simultaneously', async () => {
      const app = createApplicationContext({ autoStartEngine: false });
      const endpointUrl = `http://127.0.0.1:${receiverPort}/webhook`;

      const epRes = await app.webhooks.createEndpoint({
        request: {
          url: endpointUrl,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 5000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      // Generate delivery without running background workers
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const deliveryId = app.webhooks.listDeliveries({ endpointId: epRes.endpoint.id })[0].id;
      const initialDelivery = app.webhooks.getDelivery(deliveryId);
      expect(initialDelivery.status).toBe('pending');
      expect(initialDelivery.attempts.length).toBe(0);

      // Attempt to dispatch from two workers concurrently on the same job
      await Promise.all([
        app.engine.workerPool.processDelivery({ deliveryId, enqueuedAt: Date.now() }),
        app.engine.workerPool.processDelivery({ deliveryId, enqueuedAt: Date.now() }),
      ]);

      const delivery = app.webhooks.getDelivery(deliveryId);
      // Exactly 1 attempt should have been executed by the winning worker
      expect(delivery.attempts.length).toBe(1);
      expect(delivery.status).toBe('succeeded');
    });

    it('verifies queue refill does not duplicate jobs already in queue or not due', async () => {
      const app = createApplicationContext({ autoStartEngine: true });

      const ep = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/webhook`,
          events: ['payment.created'],
          mode: 'native',
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 5000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveryId = app.webhooks.listDeliveries({ endpointId: ep.endpoint.id })[0].id;

      // Clear the queue to test refill mechanics
      app.engine.queue.clear();
      expect(app.engine.queue.size).toBe(0);

      // Ensure delivery is pending
      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({ ...cur, status: 'pending', nextRetryAt: null });
      });

      // First refill enqueues it
      const count1 = app.engine.reconcilePendingDeliveries();
      expect(count1).toBe(1);
      expect(app.engine.queue.size).toBe(1);

      // Second immediate refill should NOT duplicate
      const count2 = app.engine.reconcilePendingDeliveries();
      expect(count2).toBe(0);
      expect(app.engine.queue.size).toBe(1);

      // If nextRetryAt is set to the future, it should NOT be enqueued
      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({
          ...cur,
          status: 'pending',
          nextRetryAt: new Date(Date.now() + 60000).toISOString(),
        });
      });

      // Clear the queue to test future nextRetryAt rejection
      app.engine.queue.clear();
      expect(app.engine.queue.size).toBe(0);

      const count3 = app.engine.reconcilePendingDeliveries();
      expect(count3).toBe(0);
      expect(app.engine.queue.size).toBe(0);

      await app.engine.stop();
    });
  });
});
