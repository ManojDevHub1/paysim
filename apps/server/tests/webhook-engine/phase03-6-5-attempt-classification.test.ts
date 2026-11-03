import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import {
  evaluateRetry,
  getManualAttemptsCount,
  getAutomaticAttemptsCount,
  getRemainingManualRetries,
  isManualRetryEligible,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_MANUAL_RETRIES,
} from '../../src/webhook-engine/retry-policy.js';
import { computeHmacSha256 } from '@paysim/crypto';
import type { DeliveryAttempt } from '@paysim/contracts';

describe('Phase 03.6.5 — Manual Retry Classification & Counter Integrity', () => {
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

  describe('Task 1 — Normative Retry Policy & Unit Classification', () => {
    it('verifies PRD normative boundaries: max 3 auto attempts and max 3 manual retries', () => {
      expect(MAX_AUTOMATIC_ATTEMPTS).toBe(3);
      expect(MAX_MANUAL_RETRIES).toBe(3);
    });

    it('accurately counts manual vs automatic attempts using initiator metadata and legacy fallback', () => {
      // 1. Attempts with explicit initiator metadata
      const mixedAttempts: DeliveryAttempt[] = [
        {
          attemptNumber: 1,
          statusCode: 500,
          durationMs: 12,
          outcome: 'http_error',
          executedAt: new Date().toISOString(),
          initiator: 'automatic',
        } as unknown as DeliveryAttempt,
        {
          attemptNumber: 2,
          statusCode: 500,
          durationMs: 14,
          outcome: 'http_error',
          executedAt: new Date().toISOString(),
          initiator: 'manual',
        } as unknown as DeliveryAttempt,
      ];

      expect(getAutomaticAttemptsCount(mixedAttempts)).toBe(1);
      expect(getManualAttemptsCount(mixedAttempts)).toBe(1);
      expect(getRemainingManualRetries(mixedAttempts)).toBe(2);

      // 2. Legacy attempts without initiator metadata (fallback math)
      const legacyAttempts: DeliveryAttempt[] = [
        { attemptNumber: 1, statusCode: 500, durationMs: 10, outcome: 'http_error', executedAt: new Date().toISOString() },
        { attemptNumber: 2, statusCode: 500, durationMs: 10, outcome: 'http_error', executedAt: new Date().toISOString() },
        { attemptNumber: 3, statusCode: 500, durationMs: 10, outcome: 'http_error', executedAt: new Date().toISOString() },
        { attemptNumber: 4, statusCode: 500, durationMs: 10, outcome: 'http_error', executedAt: new Date().toISOString() },
      ];

      expect(getAutomaticAttemptsCount(legacyAttempts)).toBe(3);
      expect(getManualAttemptsCount(legacyAttempts)).toBe(1);
      expect(getRemainingManualRetries(legacyAttempts)).toBe(2);
    });

    it('evaluates manual attempt retry: never schedules automatic backoff timer per PRD §5.8 and §11.9', () => {
      // Automatic attempt 1 failing -> schedules backoff retry
      const autoEval = evaluateRetry(1, 3, 'http_error', 500, false);
      expect(autoEval.shouldRetry).toBe(true);
      expect(autoEval.delayMs).toBe(500);

      // Manual attempt failing (even as attempt #2) -> NEVER schedules automatic backoff retry
      const manualEval = evaluateRetry(2, 3, 'http_error', 500, true);
      expect(manualEval.shouldRetry).toBe(false);
      expect(manualEval.delayMs).toBe(0);
      expect(manualEval.terminalStatus).toBe('failed');
      expect(manualEval.isRetryableError).toBe(true);
    });

    it('enforces manual retry eligibility statuses', () => {
      expect(isManualRetryEligible('failed', 0).eligible).toBe(true);
      expect(isManualRetryEligible('exhausted', 0).eligible).toBe(true);
      expect(isManualRetryEligible('in_progress', 0).eligible).toBe(false);
      expect(isManualRetryEligible('pending', 0).eligible).toBe(false);
      expect(isManualRetryEligible('succeeded', 0).eligible).toBe(false);
      expect(isManualRetryEligible('rejected', 0).eligible).toBe(false);
      expect(isManualRetryEligible('interrupted', 0).eligible).toBe(false);
      expect(isManualRetryEligible('failed', 3).eligible).toBe(false);
      expect(isManualRetryEligible('exhausted', 3).eligible).toBe(false);
    });
  });

  describe('Task 2 — Manual Retry During Automatic Backoff', () => {
    it('accurately classifies superseded manual attempt, cancels timer, and avoids automatic retry loop', async () => {
      responseStatusCode = 500;
      const app = createApplicationContext({ autoStartEngine: true });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-backoff-supersede`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      expect(delivery).toBeDefined();

      // Step 1: Wait for Attempt 1 to execute and fail
      const waitForCondition = async (predicate: (d: ReturnType<typeof app.webhooks.getDelivery>) => boolean, timeoutMs = 6000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const d = app.webhooks.getDelivery(delivery.id);
          if (predicate(d)) return d;
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        const last = app.webhooks.getDelivery(delivery.id);
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for condition in Task 2. ` +
          `Observed state: status='${last.status}', attempts=${last.attempts.length}, ` +
          `nextRetryAt=${last.nextRetryAt}, pendingInitiator=${last.pendingInitiator}`
        );
      };

      // Wait until Attempt 1 fails and auto timer is set
      const afterAttempt1 = await waitForCondition(
        (d) => d.attempts.length === 1 && d.status === 'failed' && Boolean(d.nextRetryAt)
      );

      expect(afterAttempt1.attempts.length).toBe(1);
      expect(afterAttempt1.status).toBe('failed');
      expect(afterAttempt1.nextRetryAt).not.toBeNull();
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(true);
      expect((afterAttempt1.attempts[0] as { initiator?: string }).initiator).toBe('automatic');

      // Step 2 & 3: Before 500ms timer fires, user issues a manual retry
      const retryRes = await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      expect(retryRes.status).toBe('pending');
      expect(retryRes.attemptNumber).toBe(2);

      // Step 4: Scheduled automatic retry timer must be immediately cancelled
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(false);

      // Step 5: Wait for manual retry (Attempt 2) to execute and fail
      const afterManual1 = await waitForCondition(
        (d) => d.attempts.length === 2 && d.status !== 'in_progress' && d.status !== 'pending'
      );

      // Verify Attempt Classification & Counter Integrity:
      expect(afterManual1.attempts.length).toBe(2);
      expect((afterManual1.attempts[0] as { initiator?: string }).initiator).toBe('automatic');
      expect((afterManual1.attempts[1] as { initiator?: string }).initiator).toBe('manual');

      // Counters check
      expect(getAutomaticAttemptsCount(afterManual1.attempts)).toBe(1);
      expect(getManualAttemptsCount(afterManual1.attempts)).toBe(1);
      expect(getRemainingManualRetries(afterManual1.attempts)).toBe(2);

      // Cancelled timer did not consume an attempt; no automatic retry was scheduled
      expect(afterManual1.nextRetryAt).toBeNull();
      expect(app.engine.hasScheduledRetry(delivery.id)).toBe(false);
      expect(afterManual1.status).toBe('failed');

      // Wait 1.5 seconds to prove that NO automatic retry timer fires or creates a 3rd attempt!
      await new Promise<void>((r) => setTimeout(r, 1500));
      const untouched = app.webhooks.getDelivery(delivery.id);
      expect(untouched.attempts.length).toBe(2);
      expect(untouched.status).toBe('failed');

      // Step 6: User triggers Manual Retry #2 (Attempt 3)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const afterManual2 = await waitForCondition(
        (d) => d.attempts.length === 3 && d.status !== 'in_progress' && d.status !== 'pending'
      );
      expect(afterManual2.attempts.length).toBe(3);
      expect((afterManual2.attempts[2] as { initiator?: string }).initiator).toBe('manual');
      expect(getAutomaticAttemptsCount(afterManual2.attempts)).toBe(1);
      expect(getManualAttemptsCount(afterManual2.attempts)).toBe(2);
      expect(getRemainingManualRetries(afterManual2.attempts)).toBe(1);
      expect(afterManual2.status).toBe('failed');

      // Step 7: User triggers Manual Retry #3 (Attempt 4)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const afterManual3 = await waitForCondition(
        (d) => d.attempts.length === 4 && d.status !== 'in_progress' && d.status !== 'pending'
      );
      expect(afterManual3.attempts.length).toBe(4);
      expect((afterManual3.attempts[3] as { initiator?: string }).initiator).toBe('manual');
      expect(getAutomaticAttemptsCount(afterManual3.attempts)).toBe(1);
      expect(getManualAttemptsCount(afterManual3.attempts)).toBe(3);
      expect(getRemainingManualRetries(afterManual3.attempts)).toBe(0);
      expect(afterManual3.status).toBe('exhausted');

      // Step 8: User triggers Manual Retry #4 (Attempt 5) -> Must be rejected because 3 manual retries are exhausted
      await expect(
        app.webhooks.retryDelivery({ deliveryId: delivery.id })
      ).rejects.toThrow(/Maximum manual retries \(3\) exhausted/);

      await app.engine.stop();
    });
  });

  describe('Task 3 — Counter and Queue Consistency', () => {
    it('accepts concurrent manual retry requests exactly once, rejecting duplicate request', async () => {
      responseStatusCode = 500;
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-concurrency`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Simulate a failed attempt to make delivery eligible for manual retry
      await app.coordinator.transaction({ locks: [`delivery:${delivery.id}`] }, async (ctx) => {
        ctx.deliveries.update({
          ...delivery,
          status: 'failed',
          attempts: [
            {
              attemptNumber: 1,
              statusCode: 500,
              durationMs: 15,
              outcome: 'http_error',
              executedAt: new Date().toISOString(),
              initiator: 'automatic',
            } as unknown as DeliveryAttempt,
          ],
          updatedAt: new Date().toISOString(),
        });
      });

      // Issue 2 concurrent retryDelivery calls
      const [res1, res2] = await Promise.allSettled([
        app.webhooks.retryDelivery({ deliveryId: delivery.id }),
        app.webhooks.retryDelivery({ deliveryId: delivery.id }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason.message).toMatch(/already pending in the queue|invalid state transition/i);
      }

      await app.engine.stop();
    });

    it('does not decrement manual allowance without executing when queue is saturated', async () => {
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-saturated`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 12000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Mark delivery as failed with 1 automatic attempt
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
            } as unknown as DeliveryAttempt,
          ],
          updatedAt: new Date().toISOString(),
        });
      });

      // Saturate delivery queue up to max capacity (100)
      while (app.engine.queue.size < app.engine.queue.capacity) {
        app.engine.queue.enqueue(`dummy_del_${app.engine.queue.size}`);
      }
      expect(app.engine.queue.size).toBe(app.engine.queue.capacity);

      // Attempt manual retry when queue is saturated
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });

      // Delivery is in pending state in RootState awaiting queue capacity
      const pendingDelivery = app.webhooks.getDelivery(delivery.id);
      expect(pendingDelivery.status).toBe('pending');

      // Crucial: attempts array has NOT executed or changed!
      expect(pendingDelivery.attempts.length).toBe(1);
      // Manual allowance is NOT consumed!
      expect(getRemainingManualRetries(pendingDelivery.attempts)).toBe(3);

      await app.engine.stop();
    });

    it('rolls back delivery state cleanly if transaction fails', async () => {
      const app = createApplicationContext({ autoStartEngine: false });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-rollback`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 13000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const events = app.coordinator.events.list();
      await app.engine.processCommittedEvents(events);

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Execute a failing transaction attempting to mutate delivery
      await expect(
        app.coordinator.transaction({ locks: [`delivery:${delivery.id}`] }, async (ctx) => {
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
              },
            ],
            updatedAt: new Date().toISOString(),
          });
          throw new Error('Simulated transactional failure');
        })
      ).rejects.toThrow('Simulated transactional failure');

      // Verify that delivery state and attempts array remain unmutated
      const unchanged = app.webhooks.getDelivery(delivery.id);
      expect(unchanged.status).toBe('pending');
      expect(unchanged.attempts.length).toBe(0);

      await app.engine.stop();
    });
  });

  describe('Task 4 — Maximum Retry Enforcement (3 Auto + 3 Manual = 6 Attempts)', () => {
    it('enforces 3 auto + 3 manual = 6 total attempts, rejects 4th manual retry, and verifies identical payload bytes and signatures', async () => {
      responseStatusCode = 500;
      const app = createApplicationContext({ autoStartEngine: true });

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-max-retry`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 25000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      const initialBody = app.bodyVault.getBody(delivery.id);
      expect(initialBody).not.toBeNull();

      const waitForAttemptCount = async (count: number) => {
        const start = Date.now();
        while (Date.now() - start < 10000) {
          const d = app.webhooks.getDelivery(delivery.id);
          if (
            d.attempts.length >= count &&
            d.status === 'exhausted' &&
            d.status !== 'in_progress' &&
            d.status !== 'pending'
          ) {
            return d;
          }
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        const last = app.webhooks.getDelivery(delivery.id);
        const autoCount = getAutomaticAttemptsCount(last.attempts);
        const manualCount = getManualAttemptsCount(last.attempts);
        throw new Error(
          `Timed out after 10000ms waiting for attempt count >= ${count}. ` +
          `Observed state: status='${last.status}', attempts=${last.attempts.length}, ` +
          `automaticAttempts=${autoCount}, manualAttempts=${manualCount}, ` +
          `nextRetryAt=${last.nextRetryAt}, pendingInitiator=${last.pendingInitiator}, ` +
          `queueSize=${app.engine.queue.size}, isWorkerRunning=${app.engine.isRunning}`
        );
      };

      // 1. Wait for 3 automatic attempts to complete and exhaust
      const afterAuto = await waitForAttemptCount(3);
      expect(afterAuto.attempts.length).toBe(3);
      expect(afterAuto.status).toBe('exhausted');
      expect(getAutomaticAttemptsCount(afterAuto.attempts)).toBe(3);
      expect(getManualAttemptsCount(afterAuto.attempts)).toBe(0);
      expect(getRemainingManualRetries(afterAuto.attempts)).toBe(3);

      // 2. Manual Retry 1 (Attempt 4)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const afterManual1 = await waitForAttemptCount(4);
      expect(afterManual1.attempts.length).toBe(4);
      expect(afterManual1.status).toBe('exhausted');
      expect(getManualAttemptsCount(afterManual1.attempts)).toBe(1);
      expect(getRemainingManualRetries(afterManual1.attempts)).toBe(2);

      // 3. Manual Retry 2 (Attempt 5)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const afterManual2 = await waitForAttemptCount(5);
      expect(afterManual2.attempts.length).toBe(5);
      expect(afterManual2.status).toBe('exhausted');
      expect(getManualAttemptsCount(afterManual2.attempts)).toBe(2);
      expect(getRemainingManualRetries(afterManual2.attempts)).toBe(1);

      // 4. Manual Retry 3 (Attempt 6)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const afterManual3 = await waitForAttemptCount(6);
      expect(afterManual3.attempts.length).toBe(6);
      expect(afterManual3.status).toBe('exhausted');
      expect(getManualAttemptsCount(afterManual3.attempts)).toBe(3);
      expect(getRemainingManualRetries(afterManual3.attempts)).toBe(0);

      // 5. Attempt Manual Retry 4 (Attempt 7) -> Must reject with error
      await expect(
        app.webhooks.retryDelivery({ deliveryId: delivery.id })
      ).rejects.toThrow(/Maximum manual retries \(3\) exhausted/);

      // Verify that rejected 4th retry does not mutate attempts or state
      const afterRejected = app.webhooks.getDelivery(delivery.id);
      expect(afterRejected.attempts.length).toBe(6);
      expect(getManualAttemptsCount(afterRejected.attempts)).toBe(3);

      // 6. Verify received requests on the wire
      expect(receivedRequests.length).toBe(6);

      const expectedBodyString = initialBody!.toString('utf8');
      const endpointSecret = app.secretVault.getSecret(endpointRes.endpoint.id, delivery.secretVersion);
      expect(endpointSecret).not.toBeNull();

      for (let i = 0; i < 6; i++) {
        const req = receivedRequests[i];
        // Bit-for-bit identical serialized body bytes
        expect(req.body).toBe(expectedBodyString);

        // Header check: event id and signature
        const sigHeader = req.headers['x-paysim-signature'] as string;
        expect(sigHeader).toBeDefined();

        const expectedSig = computeHmacSha256(endpointSecret!, initialBody!);
        expect(sigHeader).toBe(`sha256=${expectedSig}`);
      }

      // 7. Verify resource retention cleanup after 6th attempt failure (fully exhausted):
      // Stored body snapshot is pruned
      expect(app.bodyVault.hasBody(delivery.id)).toBe(false);

      await app.engine.stop();
    }, 15000);
  });
});
