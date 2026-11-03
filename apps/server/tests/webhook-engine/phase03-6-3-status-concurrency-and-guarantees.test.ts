import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import {
  evaluateRetry,
  isManualRetryEligible,
} from '../../src/webhook-engine/retry-policy.js';
import {
  DeliveryBodyVault,
  SecretVersionRetentionTracker,
  type DeliveryRetentionReference,
} from '@paysim/storage-memory';
import {
  DeliveryStatusSchema,
  WebhookDeliveryEntitySchema,
} from '@paysim/contracts';

describe('Phase 03.6.3 — Final Delivery Status, Manual Retry & Retention Consistency', () => {
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
        res.end(JSON.stringify({ received: true }));
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

  describe('Task 1 — Public and Internal Delivery Statuses', () => {
    it('verifies DeliveryStatusSchema strictly accepts 7 frozen statuses and rejects retry_pending', () => {
      const validStatuses = [
        'pending',
        'in_progress',
        'succeeded',
        'failed',
        'exhausted',
        'rejected',
        'interrupted',
      ];

      for (const status of validStatuses) {
        expect(DeliveryStatusSchema.safeParse(status).success).toBe(true);
      }

      // retry_pending MUST NOT be in public contracts
      expect(DeliveryStatusSchema.safeParse('retry_pending').success).toBe(false);
    });

    it('verifies public delivery entity schema rejects any object with retry_pending', () => {
      const now = new Date().toISOString();
      const entityWithInvalidStatus = {
        id: 'del_ps_test_01',
        endpointId: 'we_ps_01',
        eventId: 'evt_ps_01',
        orderId: 'order_ps_01',
        mode: 'native',
        status: 'retry_pending', // Non-normative status
        attempts: [],
        maxAttempts: 3,
        secretVersion: 1,
        bodySnapshotBytes: 128,
        createdAt: now,
        updatedAt: now,
      };

      const result = WebhookDeliveryEntitySchema.safeParse(entityWithInvalidStatus);
      expect(result.success).toBe(false);
    });

    it('evaluates retry for interrupted_unknown outcome, mapping directly to interrupted status without retries', () => {
      const evalResult = evaluateRetry(1, 3, 'interrupted_unknown', null);
      expect(evalResult.shouldRetry).toBe(false);
      expect(evalResult.terminalStatus).toBe('interrupted');
      expect(evalResult.isRetryableError).toBe(false);
    });

    it('verifies in-flight dispatch aborted by signal transitions to interrupted and permanently terminates', async () => {
      const app = createApplicationContext({ autoStartEngine: true });

      // Receiver hangs without responding
      responseStatusCode = 200;
      let hangResolver: (() => void) | null = null;
      mockReceiver.removeAllListeners('request');
      mockReceiver.on('request', (_req, _res) => {
        // Do not respond; wait for abort
        new Promise<void>((resolve) => {
          hangResolver = resolve;
        });
      });

      const ep = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/webhook`,
          events: ['payment.created'],
          mode: 'native',
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 1000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveryId = app.webhooks.listDeliveries({ endpointId: ep.endpoint.id })[0].id;

      // Wait until delivery is in_progress
      const waitForInProgress = async () => {
        for (let i = 0; i < 20; i++) {
          const d = app.webhooks.getDelivery(deliveryId);
          if (d.status === 'in_progress') return d;
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        return app.webhooks.getDelivery(deliveryId);
      };

      const inProg = await waitForInProgress();
      expect(inProg.status).toBe('in_progress');

      // Now stop engine with abort signal
      await app.engine.stop(500);

      // Verify delivery transitioned to 'interrupted'
      const finalDel = app.webhooks.getDelivery(deliveryId);
      expect(finalDel.status).toBe('interrupted');
      expect(finalDel.attempts.length).toBe(1);
      expect(finalDel.attempts[0].outcome).toBe('interrupted_unknown');

      // Verify body is cleaned up
      expect(app.bodyVault.hasBody(deliveryId)).toBe(false);

      if (hangResolver) (hangResolver as () => void)();
    });

    it('verifies interrupted delivery is strictly ineligible for manual retry', () => {
      const eligibility = isManualRetryEligible('interrupted', 0);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toContain('Delivery was interrupted');
    });

    it('verifies interrupted delivery is treated as permanently terminal in BodyVault and RetentionTracker', () => {
      const bodyVault = new DeliveryBodyVault();
      bodyVault.storeBody('del_int_01', Buffer.from('test_body_int'));
      expect(bodyVault.hasBody('del_int_01')).toBe(true);

      // Prune treats interrupted as terminal
      const pruned = bodyVault.pruneTerminalBodies([
        { id: 'del_int_01', status: 'interrupted', manualRetriesRemaining: 0 },
      ]);
      expect(pruned).toBe(1);
      expect(bodyVault.hasBody('del_int_01')).toBe(false);

      // Secret retention tracker treats interrupted as ineligible
      const isEligible = SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'interrupted',
        manualRetriesRemaining: 0,
      });
      expect(isEligible).toBe(false);
    });
  });

  describe('Task 2 — Manual Retry Counter & Concurrency Integrity', () => {
    it('rejects concurrent duplicate manual retry calls under pessimistic locking', async () => {
      const app = createApplicationContext({
        autoStartEngine: true,
      });

      // Register endpoint
      const ep = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/webhook`,
          events: ['payment.created'],
          mode: 'native',
        },
      });

      // Trigger event via order and payment creation
      const order = await app.orders.createOrder({
        request: {
          amount: 5000,
          currency: 'INR',
          receipt: 'rcpt_conc_01',
        },
      });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveries = app.webhooks.listDeliveries({ endpointId: ep.endpoint.id });
      expect(deliveries.length).toBe(1);
      const deliveryId = deliveries[0].id;

      // Set delivery status to 'exhausted'
      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({
          ...cur,
          status: 'exhausted',
          attempts: [
            { attemptNumber: 1, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 2, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 3, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
          ],
        });
      });

      // Attempt two concurrent manual retries simultaneously
      const results = await Promise.allSettled([
        app.webhooks.retryDelivery({ deliveryId }),
        app.webhooks.retryDelivery({ deliveryId }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and exactly ONE must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Rejected reason must indicate delivery is already pending or not eligible
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason.message).toMatch(/pending|eligible/);
      }

      await app.engine.stop();
    });

    it('rejects manual retry if delivery is in pending or in_progress status', async () => {
      const app = createApplicationContext({ autoStartEngine: true });

      const ep = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/webhook`,
          events: ['payment.created'],
          mode: 'native',
        },
      });

      const order = await app.orders.createOrder({
        request: {
          amount: 5000,
          currency: 'INR',
          receipt: 'rcpt_pend_01',
        },
      });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveryId = app.webhooks.listDeliveries({ endpointId: ep.endpoint.id })[0].id;

      // Force delivery status to pending without workers picking it up
      await app.engine.stop(); // Stop workers so status stays pending

      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({ ...cur, status: 'pending' });
      });

      // When delivery is pending:
      await expect(
        app.webhooks.retryDelivery({ deliveryId })
      ).rejects.toThrow(/pending/);

      // When delivery is in_progress:
      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({ ...cur, status: 'in_progress' });
      });

      await expect(
        app.webhooks.retryDelivery({ deliveryId })
      ).rejects.toThrow(/in progress/);
    });

    it('queue saturation does not consume additional retry allowances', async () => {
      const app = createApplicationContext({ autoStartEngine: true });

      const ep = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/webhook`,
          events: ['payment.created'],
          mode: 'native',
        },
      });

      const order = await app.orders.createOrder({
        request: {
          amount: 5000,
          currency: 'INR',
          receipt: 'rcpt_sat_01',
        },
      });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const deliveryId = app.webhooks.listDeliveries({ endpointId: ep.endpoint.id })[0].id;

      // Stop workers to avoid auto-processing
      await app.engine.stop();

      // Exhaust auto attempts
      await app.coordinator.transaction({ locks: [`delivery:${deliveryId}`] }, async (ctx) => {
        const cur = ctx.deliveries.get(deliveryId)!;
        ctx.deliveries.update({
          ...cur,
          status: 'exhausted',
          attempts: [
            { attemptNumber: 1, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 2, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
            { attemptNumber: 3, durationMs: 10, outcome: 'http_error', statusCode: 500, executedAt: new Date().toISOString() },
          ],
        });
      });

      // Fill the queue to capacity (100)
      while (app.engine.queue.size < app.engine.queue.capacity) {
        app.engine.queue.enqueue(`dummy_del_${app.engine.queue.size}`);
      }
      expect(app.engine.queue.size).toBe(app.engine.queue.capacity);

      // Manual retry is accepted into RootState as 'pending' even though queue is full
      const res = await app.webhooks.retryDelivery({ deliveryId });
      expect(res.status).toBe('pending');
      expect(res.attemptNumber).toBe(4);

      // The delivery in RootState is 'pending'
      const delivery = app.webhooks.getDelivery(deliveryId);
      expect(delivery.status).toBe('pending');
      // Attempts count is still 3 (not incremented yet because attempt hasn't run)
      expect(delivery.attempts.length).toBe(3);

      // Another retry cannot be triggered while in 'pending' (no double-consumption)
      await expect(
        app.webhooks.retryDelivery({ deliveryId })
      ).rejects.toThrow(/pending/);
    });
  });

  describe('Task 3 — Retention Finality Across All 5 Terminal Statuses', () => {
    it('verifies body and secret retention for succeeded, rejected, interrupted, exhausted, failed', () => {
      const bodyVault = new DeliveryBodyVault();
      bodyVault.storeBody('del_succ', Buffer.from('succ'));
      bodyVault.storeBody('del_rej', Buffer.from('rej'));
      bodyVault.storeBody('del_int', Buffer.from('int'));
      bodyVault.storeBody('del_exh_0', Buffer.from('exh_0'));
      bodyVault.storeBody('del_exh_1', Buffer.from('exh_1')); // Still has 1 manual retry
      bodyVault.storeBody('del_fail_0', Buffer.from('fail_0'));
      bodyVault.storeBody('del_fail_1', Buffer.from('fail_1')); // Still has 1 manual retry

      const deliveries = [
        { id: 'del_succ', status: 'succeeded' as const, manualRetriesRemaining: 0 },
        { id: 'del_rej', status: 'rejected' as const, manualRetriesRemaining: 0 },
        { id: 'del_int', status: 'interrupted' as const, manualRetriesRemaining: 0 },
        { id: 'del_exh_0', status: 'exhausted' as const, manualRetriesRemaining: 0 },
        { id: 'del_exh_1', status: 'exhausted' as const, manualRetriesRemaining: 1 },
        { id: 'del_fail_0', status: 'failed' as const, manualRetriesRemaining: 0 },
        { id: 'del_fail_1', status: 'failed' as const, manualRetriesRemaining: 1 },
      ];

      const pruned = bodyVault.pruneTerminalBodies(deliveries);
      expect(pruned).toBe(5); // succ, rej, int, exh_0, fail_0

      // Terminals pruned:
      expect(bodyVault.hasBody('del_succ')).toBe(false);
      expect(bodyVault.hasBody('del_rej')).toBe(false);
      expect(bodyVault.hasBody('del_int')).toBe(false);
      expect(bodyVault.hasBody('del_exh_0')).toBe(false);
      expect(bodyVault.hasBody('del_fail_0')).toBe(false);

      // Retry-eligible preserved:
      expect(bodyVault.hasBody('del_exh_1')).toBe(true);
      expect(bodyVault.hasBody('del_fail_1')).toBe(true);
    });

    it('verifies SecretVersionRetentionTracker strictly protects old secrets while an eligible delivery still needs it', () => {
      const activeVersion = 2;
      const endpointId = 'ep_ps_ret_01';

      // Eligible delivery referencing v1
      const eligibleDelivery: DeliveryRetentionReference = {
        deliveryId: 'del_ps_v1_active',
        endpointId,
        secretVersion: 1,
        status: 'exhausted',
        manualRetriesRemaining: 1,
        attemptsCount: 3,
        maxAttempts: 3,
      };

      // Version 1 CANNOT be evicted while eligible delivery exists
      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          [eligibleDelivery]
        )
      ).toBe(false);

      // Once manual retries reach 0, version 1 CAN be evicted
      const exhaustedDelivery: DeliveryRetentionReference = {
        ...eligibleDelivery,
        manualRetriesRemaining: 0,
        attemptsCount: 6,
      };

      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          [exhaustedDelivery]
        )
      ).toBe(true);
    });
  });
});
