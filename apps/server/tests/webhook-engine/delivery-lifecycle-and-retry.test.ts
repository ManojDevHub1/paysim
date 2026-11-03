import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createApplicationContext,
  type ApplicationContext,
} from '../../src/application/index.js';
import {
  DeliveryQueue,
  evaluateRetry,
  isManualRetryEligible,
  type Clock,
} from '../../src/webhook-engine/index.js';
import { SecretVersionRetentionTracker } from '@paysim/storage-memory';

describe('Webhook Engine — Delivery Lifecycle, Queue, Workers & Retries (Phase 03.6)', () => {
  let receiverServer: http.Server;
  let receiverPort: number;
  let receivedRequests: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let responseStatusCode = 200;
  let responseDelayMs = 0;

  beforeAll(async () => {
    receiverServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({ headers: req.headers, body });
        if (responseDelayMs > 0) {
          setTimeout(() => {
            res.writeHead(responseStatusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: responseStatusCode }));
          }, responseDelayMs);
        } else {
          res.writeHead(responseStatusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: responseStatusCode }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      receiverServer.listen(0, '127.0.0.1', () => {
        receiverPort = (receiverServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      receiverServer.close(() => resolve());
    });
  });

  beforeEach(() => {
    receivedRequests = [];
    responseStatusCode = 200;
    responseDelayMs = 0;
  });

  describe('1. Bounded Delivery Queue (Max 100 Jobs)', () => {
    it('enforces maximum capacity of 100 waiting jobs and rejects overflow', () => {
      const queue = new DeliveryQueue(100);

      for (let i = 0; i < 100; i++) {
        expect(queue.enqueue(`del_ps_${i}`)).toBe(true);
      }

      expect(queue.size).toBe(100);

      // Attempting to enqueue job 101 throws DeliveryQueueFullError
      expect(() => queue.enqueue('del_ps_101')).toThrow('Webhook delivery queue is full');
      expect(queue.size).toBe(100);
    });

    it('deduplicates identical delivery IDs idempotently', () => {
      const queue = new DeliveryQueue(100);
      expect(queue.enqueue('del_ps_dup')).toBe(true);
      expect(queue.enqueue('del_ps_dup')).toBe(false); // Duplicate ignored
      expect(queue.size).toBe(1);
    });

    it('dequeues in strict FIFO order', () => {
      const queue = new DeliveryQueue(100);
      queue.enqueue('del_first');
      queue.enqueue('del_second');
      queue.enqueue('del_third');

      expect(queue.dequeue()?.deliveryId).toBe('del_first');
      expect(queue.dequeue()?.deliveryId).toBe('del_second');
      expect(queue.dequeue()?.deliveryId).toBe('del_third');
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('2. Retry Policy & Eligibility Evaluation', () => {
    it('evaluates success outcome as terminal succeeded with zero retry', () => {
      const res = evaluateRetry(1, 3, 'success', 200);
      expect(res.shouldRetry).toBe(false);
      expect(res.terminalStatus).toBe('succeeded');
    });

    it('evaluates redirect_rejected as non-retryable rejected per ADR-005', () => {
      const res = evaluateRetry(1, 3, 'redirect_rejected', 302);
      expect(res.shouldRetry).toBe(false);
      expect(res.terminalStatus).toBe('rejected');
    });

    it('evaluates non-retryable 4xx (e.g. 404, 422) as non-retryable failed', () => {
      const res404 = evaluateRetry(1, 3, 'http_error', 404);
      expect(res404.shouldRetry).toBe(false);
      expect(res404.terminalStatus).toBe('failed');

      const res422 = evaluateRetry(1, 3, 'http_error', 422);
      expect(res422.shouldRetry).toBe(false);
      expect(res422.terminalStatus).toBe('failed');
    });

    it('evaluates retryable 500 on attempt 1 with 500ms backoff', () => {
      const res = evaluateRetry(1, 3, 'http_error', 500);
      expect(res.shouldRetry).toBe(true);
      expect(res.delayMs).toBe(500);
      expect(res.isRetryableError).toBe(true);
    });

    it('evaluates retryable 503 on attempt 2 with 2000ms backoff', () => {
      const res = evaluateRetry(2, 3, 'http_error', 503);
      expect(res.shouldRetry).toBe(true);
      expect(res.delayMs).toBe(2000);
      expect(res.isRetryableError).toBe(true);
    });

    it('evaluates retryable network timeout on attempt 3 as exhausted', () => {
      const res = evaluateRetry(3, 3, 'timeout', null);
      expect(res.shouldRetry).toBe(false);
      expect(res.terminalStatus).toBe('exhausted');
    });

    it('validates manual retry eligibility correctly', () => {
      expect(isManualRetryEligible('failed', 0).eligible).toBe(true);
      expect(isManualRetryEligible('exhausted', 1).eligible).toBe(true);
      expect(isManualRetryEligible('in_progress', 0).eligible).toBe(false);
      expect(isManualRetryEligible('succeeded', 0).eligible).toBe(false);
      expect(isManualRetryEligible('rejected', 0).eligible).toBe(false);
      expect(isManualRetryEligible('exhausted', 3).eligible).toBe(false); // Max 3 exhausted
    });
  });

  describe('3. End-to-End Delivery Flow (Event -> Delivery -> Worker -> HTTP Receiver)', () => {
    let app: ApplicationContext;

    beforeEach(() => {
      app = createApplicationContext({ autoStartEngine: true });
    });

    afterAll(async () => {
      if (app) {
        await app.engine.stop();
      }
    });

    it('automatically generates and delivers webhook to local receiver on payment capture', async () => {
      // 1. Register local endpoint targeting test receiver
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/payments`,
          mode: 'native',
          events: ['payment.captured'],
          description: 'Local test receiver',
        },
      });

      // 2. Create order and payment, and simulate success
      const order = await app.orders.createOrder({ request: { amount: 25000 } });
      const payment = await app.payments.createPaymentAttempt({ orderId: order.id });

      // Simulate payment outcome: commits payment.authorized, payment.captured, order.paid
      await app.payments.simulateOutcome({ paymentId: payment.id, request: { outcome: 'success' } });

      // Allow workers to process delivery
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // 3. Verify receiver received HTTP request
      expect(receivedRequests.length).toBeGreaterThanOrEqual(1);
      const req = receivedRequests[0];
      expect(req.headers['x-paysim-signature']).toBeDefined();
      expect(req.headers['x-paysim-event-id']).toBeDefined();

      const parsedBody = JSON.parse(req.body);
      expect(parsedBody.type).toBe('payment.captured');
      expect(parsedBody.data.object.id).toBe(payment.id);

      // 4. Verify Delivery Record in RootState transitioned to 'succeeded'
      const deliveries = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id });
      expect(deliveries.length).toBe(1);
      const del = deliveries[0];

      expect(del.status).toBe('succeeded');
      expect(del.attempts.length).toBe(1);
      expect(del.attempts[0].attemptNumber).toBe(1);
      expect(del.attempts[0].statusCode).toBe(200);
      expect(del.attempts[0].outcome).toBe('success');
      expect(del.bodySnapshotBytes).toBeGreaterThan(0);
    });

    it('preserves exact byte snapshot in DeliveryBodyVault across retries', async () => {
      // Simulate receiver returning 500 error first
      responseStatusCode = 500;

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/failing-hook`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 12000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      // Wait for initial attempt
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const deliveries = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id });
      expect(deliveries.length).toBe(1);
      const del = deliveries[0];

      // Retrieve stored byte buffer
      const storedBody = app.bodyVault.getBody(del.id);
      expect(storedBody).not.toBeNull();

      // Verify that initial attempt received exact byte buffer
      expect(Buffer.from(receivedRequests[0].body, 'utf8')).toEqual(storedBody);
    });

    it('retains historical secret version in vault while delivery is retryable', async () => {
      responseStatusCode = 503; // Failure to keep delivery retryable

      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/retry-secret-test`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 15000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // Rotate secret to version 2
      const rotateRes = await app.webhooks.rotateSecret({
        endpointId: endpointRes.endpoint.id,
      });
      expect(rotateRes.secretVersion).toBe(2);

      // Verify historical version 1 is STILL retained in vault
      expect(app.secretVault.hasSecret(endpointRes.endpoint.id, 1)).toBe(true);

      // Verify retention tracker reports reference is eligible
      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      const isEligible = SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: delivery.status,
        manualRetriesRemaining: 3,
        attemptsCount: delivery.attempts.length,
        maxAttempts: delivery.maxAttempts,
      });
      expect(isEligible).toBe(true);
    });

    it('replays canonical event generating fresh delivery with current mode', async () => {
      responseStatusCode = 200;

      await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/replay-receiver`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 30000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const event = app.webhooks.listEvents()[0];

      // Replay the event
      const replayedDeliveries = await app.webhooks.replayEvent(event.id);
      expect(replayedDeliveries.length).toBe(1);

      // Allow worker to dispatch replayed delivery
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const replayed = app.webhooks.getDelivery(replayedDeliveries[0].id);
      expect(replayed.status).toBe('succeeded');
      expect(replayed.attempts.length).toBe(1);
      expect(replayed.attempts[0].statusCode).toBe(200);
    });
  });

  describe('4. Deterministic Retry Engine with Fake Clock', () => {
    it('executes full 3-attempt backoff schedule (immediate, 500ms, 2000ms) to exhausted status', async () => {
      // Use controlled mock clock for instantaneous backoff testing
      let mockTime = 1000000;
      type MockTimer = { id: number; callback: () => void; triggerTime: number };
      const timers: MockTimer[] = [];
      let nextTimerId = 1;

      const mockClock: Clock = {
        now: () => mockTime,
        setTimeout: (fn, delayMs) => {
          const id = nextTimerId++;
          timers.push({ id, callback: fn, triggerTime: mockTime + delayMs });
          return id;
        },
        clearTimeout: (id) => {
          const idx = timers.findIndex((t) => t.id === id);
          if (idx !== -1) timers.splice(idx, 1);
        },
      };

      const advanceNextTimer = async () => {
        timers.sort((a, b) => a.triggerTime - b.triggerTime);
        if (timers.length > 0) {
          const next = timers.shift()!;
          mockTime = next.triggerTime;
          next.callback();
          // Yield to microtasks
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      };

      // Create app with mock clock
      const app = createApplicationContext();
      const customApp = createApplicationContext({
        clock: mockClock,
        stateHolder: app.stateHolder,
        coordinator: app.coordinator,
      });

      responseStatusCode = 500; // Always fail to trigger full retry progression

      const endpointRes = await customApp.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/full-retry-test`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      // Start engine with custom clock
      customApp.engine.start();

      const order = await customApp.orders.createOrder({ request: { amount: 50000 } });
      await customApp.payments.createPaymentAttempt({ orderId: order.id });

      // Initial attempt (Attempt 1)
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      let del = customApp.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      expect(del.attempts.length).toBe(1);
      expect(del.attempts[0].statusCode).toBe(500);

      // Advance mock clock to trigger 500ms retry (Attempt 2)
      await advanceNextTimer();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      del = customApp.webhooks.getDelivery(del.id);
      expect(del.attempts.length).toBe(2);

      // Advance mock clock to trigger 2000ms retry (Attempt 3)
      await advanceNextTimer();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      del = customApp.webhooks.getDelivery(del.id);
      expect(del.attempts.length).toBe(3);
      // After attempt 3 failure: status becomes 'exhausted'
      expect(del.status).toBe('exhausted');

      await customApp.engine.stop();
    });
  });
});
