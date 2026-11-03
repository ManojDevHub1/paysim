import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import { HttpDispatcher } from '../../src/webhook-engine/http-dispatcher.js';
import { validateDispatchDestination } from '../../src/webhook-engine/dispatcher-security.js';
import { DeliveryQueue } from '../../src/webhook-engine/delivery-queue.js';
import {
  evaluateRetry,
  isRetryableStatusCode,
  isRetryableOutcome,
  isManualRetryEligible,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_MANUAL_RETRIES,
  RETRY_DELAYS_MS,
} from '../../src/webhook-engine/retry-policy.js';
import {
  WebhookDeliveryEntitySchema,
  WebhookDeliveryListResponseSchema,
  RetryDeliveryResponseSchema,
  ReplayEventResponseSchema,
  DeliveryStatusSchema,
  DeliveryAttemptOutcomeSchema,
  type DeliveryStatus,
  type DeliveryAttemptOutcome,
  type WebhookDeliveryEntity,
} from '@paysim/contracts';
import {
  DeliveryBodyVault,
  StorageCapacityError,
} from '@paysim/storage-memory';
import { computeHmacSha256 } from '@paysim/crypto';

describe('Webhook Delivery Engine Integrity & Security Audit (Phase 03.6.1)', () => {
  // ===========================================================================
  // TASK 1: Dynamic Listener-Port Confinement
  // ===========================================================================
  describe('Task 1 — Dynamic Listener-Port Confinement', () => {
    it('blocks the configured PAYSIM listener port across multiple different runtime ports', () => {
      // Test Port 1: 9898
      const config1 = { backendPort: 9898, frontendPort: 5173 };
      const res1Backend = validateDispatchDestination('http://127.0.0.1:9898/api/v1', config1);
      expect(res1Backend.valid).toBe(false);
      expect(res1Backend.error).toContain('matches the active backend listener port');

      // Test Port 2: 9199
      const config2 = { backendPort: 9199, frontendPort: 5173 };
      const res2Backend = validateDispatchDestination('http://127.0.0.1:9199/webhook', config2);
      expect(res2Backend.valid).toBe(false);
      expect(res2Backend.error).toContain('matches the active backend listener port');

      // Allowed unprivileged ports outside backend listener
      expect(validateDispatchDestination('http://127.0.0.1:9898/api/v1', config2).valid).toBe(true);
      expect(validateDispatchDestination('http://127.0.0.1:9199/webhook', config1).valid).toBe(true);
    });

    it('enforces Vite frontend development port (5173) and additional restricted ports', () => {
      const config = {
        backendPort: 8787,
        frontendPort: 5173,
        additionalRestrictedPorts: [9990, 9991],
      };

      const resFrontend = validateDispatchDestination('http://127.0.0.1:5173/', config);
      expect(resFrontend.valid).toBe(false);
      expect(resFrontend.error).toContain('frontend UI listener port');

      const resAdd1 = validateDispatchDestination('http://127.0.0.1:9990/hook', config);
      expect(resAdd1.valid).toBe(false);
      expect(resAdd1.error).toContain('designated as an internal restricted port');

      const resAdd2 = validateDispatchDestination('http://127.0.0.1:9991/hook', config);
      expect(resAdd2.valid).toBe(false);
      expect(resAdd2.error).toContain('designated as an internal restricted port');
    });

    it('preserves static prohibited ports (8787, 2375, 2376, 4243, 5000) regardless of runtime config', () => {
      const customConfig = { backendPort: 9555, frontendPort: 5175 };

      // Default PAYSIM port 8787 is statically blocked to prevent delivery loops
      expect(validateDispatchDestination('http://127.0.0.1:8787/api/v1', customConfig).valid).toBe(false);
      // Docker & internal sensitive daemons
      expect(validateDispatchDestination('http://127.0.0.1:2375/v1.40/containers', customConfig).valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:2376/v1.40/info', customConfig).valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:4243/services', customConfig).valid).toBe(false);
      expect(validateDispatchDestination('http://127.0.0.1:5000/v2/_catalog', customConfig).valid).toBe(false);
    });

    it('rejects endpoint creation and dispatch targeting the active runtime listener port in WebhookService', async () => {
      const runtimeConfig = { backendPort: 9444, frontendPort: 5173 };
      const app = createApplicationContext({ runtimeConfig });

      // Attempt creating endpoint targeting 9444 (active backend)
      await expect(
        app.webhooks.createEndpoint({
          request: {
            url: 'http://127.0.0.1:9444/api/v1/webhook',
            mode: 'native',
            events: ['payment.captured'],
          },
        })
      ).rejects.toThrow(/matches the active backend listener port/);

      // Successfully create valid endpoint on non-conflicting port
      const created = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:9555/receiver',
          mode: 'native',
          events: ['payment.captured'],
        },
      });
      expect(created.endpoint.id).toBeDefined();

      // Attempt updating endpoint to target 9444
      await expect(
        app.webhooks.updateEndpoint(created.endpoint.id, {
          url: 'http://127.0.0.1:9444/receiver',
        })
      ).rejects.toThrow(/matches the active backend listener port/);

      // Verify HttpDispatcher also rejects targeting active port with redirect_rejected outcome
      const dispatcher = new HttpDispatcher();
      const dispatchRes = await dispatcher.dispatch({
        url: 'http://127.0.0.1:9444/receiver',
        mode: 'native',
        eventId: 'evt_ps_test',
        deliveryId: 'del_ps_test',
        secretVersion: 1,
        secret: 'whsec_test',
        rawBody: Buffer.from('{}', 'utf8'),
        runtimeConfig,
      });
      expect(dispatchRes.outcome).toBe('redirect_rejected');
      expect(dispatchRes.errorMessage).toContain('matches the active backend listener port');
    });
  });

  // ===========================================================================
  // TASK 2: Commit-to-Queue Consistency & Pending Delivery Refill
  // ===========================================================================
  describe('Task 2 — Commit-to-Queue Consistency', () => {
    it('preserves committed RootState delivery when queue is saturated and automatically reconciles when drained', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const engine = app.engine;

      // 1. Register endpoint targeting local receiver
      const endpoint = await app.webhooks.createEndpoint({
        request: {
          url: 'http://127.0.0.1:9099/wh',
          mode: 'native',
          events: ['payment.created'],
        },
      });

      // 2. Fill the waiting queue to its max capacity (100 jobs)
      for (let i = 0; i < 100; i++) {
        const enqueued = engine.queue.enqueue(`del_ps_dummy_${i}`);
        expect(enqueued).toBe(true);
      }
      expect(engine.queue.size).toBe(100);

      // 3. Commit another delivery via order and payment creation
      // Queue is full -> enqueue in processCommittedEvents catches error, delivery is stored as pending
      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const allDeliveries = app.webhooks.listDeliveries({ endpointId: endpoint.endpoint.id });
      expect(allDeliveries.length).toBe(1);
      const delivery = allDeliveries[0];
      expect(delivery.status).toBe('pending');

      // Verify the 101st delivery is NOT in the saturated queue yet
      expect(engine.queue.has(delivery.id)).toBe(false);
      expect(engine.queue.size).toBe(100);

      // 4. Drain 5 jobs from the queue to create room
      for (let i = 0; i < 5; i++) {
        engine.queue.dequeue();
      }
      expect(engine.queue.size).toBe(95);

      // 5. Trigger pending-delivery reconciliation
      const reconciledCount = engine.reconcilePendingDeliveries();
      expect(reconciledCount).toBe(1);

      // 6. Verify the committed delivery is now scheduled in the queue
      expect(engine.queue.has(delivery.id)).toBe(true);
      expect(engine.queue.size).toBe(96);

      // 7. Verify deduplication: calling reconcile again enqueues 0 duplicate jobs
      const duplicateReconcile = engine.reconcilePendingDeliveries();
      expect(duplicateReconcile).toBe(0);
      expect(engine.queue.size).toBe(96);

      await app.engine.stop();
    });

    it('guarantees commit succeeds and is not rolled back if onCommit listener throws', async () => {
      const app = createApplicationContext();

      // Register an onCommit listener that throws an intentional exception
      app.coordinator.onCommit(() => {
        throw new Error('Forced onCommit listener failure');
      });

      // Commit a transaction
      const order = await app.orders.createOrder({ request: { amount: 20000 } });
      expect(order.id).toBeDefined();

      // Verify order is committed in RootState despite listener throwing
      const fetched = app.orders.getOrder(order.id);
      expect(fetched.id).toBe(order.id);
      expect(fetched.status).toBe('created');
    });

    it('enforces queue capacity bounds and worker concurrency limits', () => {
      const queue = new DeliveryQueue(5);
      expect(queue.capacity).toBe(5);

      for (let i = 0; i < 5; i++) {
        queue.enqueue(`del_${i}`);
      }
      expect(queue.size).toBe(5);

      // 6th item must throw DeliveryQueueFullError
      expect(() => queue.enqueue('del_overflow')).toThrow(/queue is full/);
      expect(queue.size).toBe(5);

      // Enqueueing existing item returns false (idempotent deduplication)
      expect(queue.enqueue('del_0')).toBe(false);
      expect(queue.size).toBe(5);
    });
  });

  // ===========================================================================
  // TASK 3: Secret-Version Retention & Lifecycle Tracking
  // ===========================================================================
  describe('Task 3 — Secret-Version Retention', () => {
    let mockReceiver: http.Server;
    let receiverPort: number;
    let lastReceivedSignature = '';
    let lastReceivedSecretVersion = '';
    let lastReceivedBody = '';
    let responseStatus = 200;

    beforeEach(async () => {
      responseStatus = 200;
      lastReceivedBody = '';
      mockReceiver = http.createServer((req, res) => {
        lastReceivedSignature = (req.headers['x-paysim-signature'] as string) || '';
        lastReceivedSecretVersion = (req.headers['x-paysim-secret-version'] as string) || '';

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          lastReceivedBody = body;
          res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: responseStatus === 200 ? 'ok' : 'error' }));
        });
      });

      await new Promise<void>((resolve) => {
        mockReceiver.listen(0, '127.0.0.1', () => {
          receiverPort = (mockReceiver.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        mockReceiver.close(() => resolve());
      });
    });

    it('preserves secret version 1 across retries after rotating to version 2, and uses version 2 for new replays', async () => {
      // 1. Create Webhook Endpoint using secret version 1
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh`,
          mode: 'native',
          events: ['payment.created'],
        },
      });
      const endpointId = endpointRes.endpoint.id;
      const secretV1 = endpointRes.secret;
      expect(endpointRes.endpoint.secretVersion).toBe(1);

      // 2. Set receiver to fail with 500 so delivery 1 fails
      responseStatus = 500;

      // Create an order and payment attempt -> creates delivery referencing version 1
      const order = await app.orders.createOrder({ request: { amount: 50000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      // Wait for attempt 1 to execute and fail
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const deliveries = app.webhooks.listDeliveries({ endpointId });
      expect(deliveries.length).toBe(1);
      const delivery1 = deliveries[0];
      expect(delivery1.secretVersion).toBe(1);
      expect(delivery1.status).toBe('failed');
      expect(delivery1.attempts.length).toBe(1);
      expect(delivery1.attempts[0].statusCode).toBe(500);

      // Verify version 1 signature was computed with secretV1
      const rawBody = app.bodyVault.getBody(delivery1.id);
      expect(rawBody).not.toBeNull();
      const expectedSigV1 = `sha256=${computeHmacSha256(secretV1, rawBody!)}`;
      expect(lastReceivedSignature).toBe(expectedSigV1);
      expect(lastReceivedSecretVersion).toBe('1');

      // 4. Rotate endpoint secret to version 2
      const rotationRes = await app.webhooks.rotateSecret({ endpointId });
      expect(rotationRes.secretVersion).toBe(2);
      const secretV2 = rotationRes.secret;
      expect(secretV1).not.toBe(secretV2);

      // Verify WebhookSecretVault retains BOTH secret versions
      expect(app.secretVault.hasSecret(endpointId, 1)).toBe(true);
      expect(app.secretVault.hasSecret(endpointId, 2)).toBe(true);

      // 5. Make receiver succeed and retry original delivery
      responseStatus = 200;
      await app.webhooks.retryDelivery({ deliveryId: delivery1.id });

      // Wait for worker to execute retry
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const retriedDel1 = app.webhooks.getDelivery(delivery1.id);
      expect(retriedDel1.status).toBe('succeeded');
      expect(retriedDel1.attempts.length).toBe(2);

      // 6. Verify the retry reused secret version 1, NOT version 2!
      expect(lastReceivedSecretVersion).toBe('1');
      expect(lastReceivedSignature).toBe(expectedSigV1);

      // 7. Create a new event replay
      const event = app.webhooks.listEvents()[0];
      const replayRes = await app.webhooks.replayEvent(event.id);
      expect(replayRes.length).toBe(1);
      const replayDelivery = replayRes[0];

      // 8. Verify the new replay delivery uses secret version 2!
      expect(replayDelivery.secretVersion).toBe(2);

      // Wait for worker to dispatch replay delivery
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const replayedDel = app.webhooks.getDelivery(replayDelivery.id);
      expect(replayedDel.status).toBe('succeeded');

      // Verify the received signature matches HMAC-SHA256 computed with secretV2 over received body
      expect(lastReceivedBody).not.toBe('');
      const expectedSigV2 = `sha256=${computeHmacSha256(secretV2, Buffer.from(lastReceivedBody, 'utf8'))}`;
      expect(lastReceivedSecretVersion).toBe('2');
      expect(lastReceivedSignature).toBe(expectedSigV2);

      // Verify cleanup semantics: succeeded delivery's body was pruned from DeliveryBodyVault
      expect(app.bodyVault.hasBody(replayDelivery.id)).toBe(false);

      await app.engine.stop();
    });

    it('verifies DeliveryBodyVault memory bounds and cleanup semantics', () => {
      const vault = new DeliveryBodyVault(3);
      expect(vault.capacity).toBe(3);

      const buf = Buffer.from('{"test":true}', 'utf8');
      vault.storeBody('del_1', buf);
      vault.storeBody('del_2', buf);
      vault.storeBody('del_3', buf);
      expect(vault.size).toBe(3);

      // Exceeding capacity throws StorageCapacityError
      expect(() => vault.storeBody('del_4', buf)).toThrow(StorageCapacityError);
      expect(vault.size).toBe(3);

      // Prune terminal bodies cleans up succeeded and rejected
      const deliveries = [
        { id: 'del_1', status: 'succeeded' as DeliveryStatus },
        { id: 'del_2', status: 'pending' as DeliveryStatus },
        { id: 'del_3', status: 'rejected' as DeliveryStatus },
      ];
      const pruned = vault.pruneTerminalBodies(deliveries);
      expect(pruned).toBe(2);
      expect(vault.hasBody('del_1')).toBe(false);
      expect(vault.hasBody('del_2')).toBe(true);
      expect(vault.hasBody('del_3')).toBe(false);
      expect(vault.size).toBe(1);
    });
  });

  // ===========================================================================
  // TASK 4: Delivery Contract Compatibility
  // ===========================================================================
  describe('Task 4 — Delivery Contract Compatibility', () => {
    it('verifies all 7 normative DeliveryStatus values strictly validate against DeliveryStatusSchema', () => {
      const allStatuses: DeliveryStatus[] = [
        'pending',
        'in_progress',
        'succeeded',
        'failed',
        'exhausted',
        'rejected',
        'interrupted',
      ];

      for (const status of allStatuses) {
        expect(() => DeliveryStatusSchema.parse(status)).not.toThrow();
      }

      // Prohibited / undocumented enums fail
      expect(() => DeliveryStatusSchema.parse('completed')).toThrow();
      expect(() => DeliveryStatusSchema.parse('delivered')).toThrow();
      expect(() => DeliveryStatusSchema.parse('queued')).toThrow();
    });

    it('verifies all 7 normative DeliveryAttemptOutcome values strictly validate against DeliveryAttemptOutcomeSchema', () => {
      const allOutcomes: DeliveryAttemptOutcome[] = [
        'success',
        'http_error',
        'timeout',
        'connection_refused',
        'redirect_rejected',
        'payload_too_large',
        'interrupted_unknown',
      ];

      for (const outcome of allOutcomes) {
        expect(() => DeliveryAttemptOutcomeSchema.parse(outcome)).not.toThrow();
      }

      // Prohibited / undocumented outcome fails
      expect(() => DeliveryAttemptOutcomeSchema.parse('redirected')).toThrow();
      expect(() => DeliveryAttemptOutcomeSchema.parse('error')).toThrow();
    });

    it('validates WebhookDeliveryEntitySchema across every visible status', () => {
      const baseEntity: WebhookDeliveryEntity = {
        id: 'del_ps_test_comp_001',
        endpointId: 'we_ps_test_001',
        eventId: 'evt_ps_test_001',
        orderId: 'ord_ps_test_001',
        paymentId: 'pay_ps_test_001',
        mode: 'native',
        status: 'pending',
        attempts: [
          {
            attemptNumber: 1,
            statusCode: 500,
            durationMs: 42,
            outcome: 'http_error',
            errorMessage: 'Internal Server Error',
            executedAt: '2026-11-03T12:00:00.000Z',
          },
        ],
        maxAttempts: 3,
        secretVersion: 1,
        bodySnapshotBytes: 256,
        nextRetryAt: '2026-11-03T12:00:00.500Z',
        createdAt: '2026-11-03T12:00:00.000Z',
        updatedAt: '2026-11-03T12:00:00.000Z',
      };

      const statuses: DeliveryStatus[] = [
        'pending',
        'in_progress',
        'succeeded',
        'failed',
        'exhausted',
        'rejected',
        'interrupted',
      ];

      for (const status of statuses) {
        const entity = { ...baseEntity, status };
        const parsed = WebhookDeliveryEntitySchema.safeParse(entity);
        expect(parsed.success).toBe(true);
      }

      // Validates WebhookDeliveryListResponseSchema
      const listEnvelope = {
        object: 'list',
        data: [baseEntity],
        hasMore: false,
        totalCount: 1,
      };
      expect(() => WebhookDeliveryListResponseSchema.parse(listEnvelope)).not.toThrow();
    });

    it('validates RetryDeliveryResponseSchema and ReplayEventResponseSchema', () => {
      const retryResponse = {
        deliveryId: 'del_ps_test_001',
        status: 'pending',
        attemptNumber: 2,
        scheduledAt: '2026-11-03T12:00:00.000Z',
      };
      expect(() => RetryDeliveryResponseSchema.parse(retryResponse)).not.toThrow();

      const replayResponse = {
        eventId: 'evt_ps_test_001',
        deliveriesCreated: [
          {
            deliveryId: 'del_ps_rep_001',
            endpointId: 'we_ps_test_001',
            mode: 'native',
          },
        ],
      };
      expect(() => ReplayEventResponseSchema.parse(replayResponse)).not.toThrow();
    });
  });

  // ===========================================================================
  // TASK 5: Retry Policy & HMAC Specification Compliance
  // ===========================================================================
  describe('Task 5 — Retry and Signature Compliance', () => {
    it('verifies exact PRD retry policy constants and backoff intervals', () => {
      expect(MAX_AUTOMATIC_ATTEMPTS).toBe(3);
      expect(MAX_MANUAL_RETRIES).toBe(3);
      expect(RETRY_DELAYS_MS[0]).toBe(0);     // Attempt 1: immediate
      expect(RETRY_DELAYS_MS[1]).toBe(500);   // Attempt 2: 500ms
      expect(RETRY_DELAYS_MS[2]).toBe(2000);  // Attempt 3: 2000ms
    });

    it('verifies retryable HTTP statuses (408, 425, 429, 5xx) vs non-retryable (3xx, 4xx)', () => {
      // Retryable statuses
      expect(isRetryableStatusCode(408)).toBe(true);
      expect(isRetryableStatusCode(425)).toBe(true);
      expect(isRetryableStatusCode(429)).toBe(true);
      expect(isRetryableStatusCode(500)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
      expect(isRetryableStatusCode(504)).toBe(true);
      expect(isRetryableStatusCode(599)).toBe(true);

      // Non-retryable statuses
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(301)).toBe(false);
      expect(isRetryableStatusCode(302)).toBe(false);
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(403)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
      expect(isRetryableStatusCode(422)).toBe(false);
    });

    it('verifies retryable outcomes: timeout and connection_refused are always retryable', () => {
      expect(isRetryableOutcome('timeout')).toBe(true);
      expect(isRetryableOutcome('connection_refused')).toBe(true);
      expect(isRetryableOutcome('redirect_rejected')).toBe(false);
      expect(isRetryableOutcome('payload_too_large')).toBe(false);
      expect(isRetryableOutcome('success')).toBe(false);
    });

    it('verifies evaluateRetry transitions and max attempts', () => {
      // Attempt 1 fails with 500 -> should retry after 500ms
      const eval1 = evaluateRetry(1, 3, 'http_error', 500);
      expect(eval1.shouldRetry).toBe(true);
      expect(eval1.delayMs).toBe(500);
      expect(eval1.terminalStatus).toBe('failed');

      // Attempt 2 fails with 500 -> should retry after 2000ms
      const eval2 = evaluateRetry(2, 3, 'http_error', 500);
      expect(eval2.shouldRetry).toBe(true);
      expect(eval2.delayMs).toBe(2000);
      expect(eval2.terminalStatus).toBe('failed');

      // Attempt 3 fails with 500 -> exhausted
      const eval3 = evaluateRetry(3, 3, 'http_error', 500);
      expect(eval3.shouldRetry).toBe(false);
      expect(eval3.delayMs).toBe(0);
      expect(eval3.terminalStatus).toBe('exhausted');

      // 3xx redirect -> non-retryable rejected
      const evalRedirect = evaluateRetry(1, 3, 'redirect_rejected', 302);
      expect(evalRedirect.shouldRetry).toBe(false);
      expect(evalRedirect.terminalStatus).toBe('rejected');

      // 400 Bad Request -> non-retryable failed
      const eval400 = evaluateRetry(1, 3, 'http_error', 400);
      expect(eval400.shouldRetry).toBe(false);
      expect(eval400.terminalStatus).toBe('failed');
    });

    it('verifies manual retry eligibility criteria and budget of 3', () => {
      // Eligible: failed or exhausted with manualRetriesCount < 3
      expect(isManualRetryEligible('failed', 0).eligible).toBe(true);
      expect(isManualRetryEligible('failed', 2).eligible).toBe(true);
      expect(isManualRetryEligible('exhausted', 0).eligible).toBe(true);
      expect(isManualRetryEligible('exhausted', 2).eligible).toBe(true);

      // Ineligible: max manual retries (3) reached
      expect(isManualRetryEligible('failed', 3).eligible).toBe(false);
      expect(isManualRetryEligible('exhausted', 3).eligible).toBe(false);

      // Ineligible states
      expect(isManualRetryEligible('succeeded', 0).eligible).toBe(false);
      expect(isManualRetryEligible('pending', 0).eligible).toBe(false);
      expect(isManualRetryEligible('in_progress', 0).eligible).toBe(false);
      expect(isManualRetryEligible('rejected', 0).eligible).toBe(false);
      expect(isManualRetryEligible('interrupted', 0).eligible).toBe(false);
    });

    it('computes exact HMAC-SHA256 signature over raw serialized body bytes', () => {
      const secret = 'whsec_99a8b7c6d5e4f321';
      const bodyString = '{"amount":10000,"currency":"INR","id":"pay_ps_001","status":"captured"}';
      const bodyBuffer = Buffer.from(bodyString, 'utf8');

      const expectedHmac = computeHmacSha256(secret, bodyBuffer);
      expect(expectedHmac).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(expectedHmac)).toBe(true);

      // Verify that changing even one character alters signature completely
      const tamperedBuffer = Buffer.from('{"amount":10001,"currency":"INR","id":"pay_ps_001","status":"captured"}', 'utf8');
      const tamperedHmac = computeHmacSha256(secret, tamperedBuffer);
      expect(tamperedHmac).not.toBe(expectedHmac);
    });
  });
});
